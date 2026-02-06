# Cloudflare Agents SDK + Vite — Hard-Won Learnings

## Agents SDK v0.3.10

- **`@callable()` doesn't work in Vite dev mode.** TC39 decorators aren't transpiled by Vite's esbuild transform. Use `callable()` imperatively instead:
  ```ts
  const registerCallable = callable();
  // in onStart():
  registerCallable(this.myMethod, { kind: "method", name: "myMethod" } as any);
  ```
- **`useAgent()` untyped overload** doesn't expose `.state` on the return object. Use `onStateUpdate` callback + local React state to track agent state.
- **`schedule(0, "methodName", payload)`** is how to do async background work in DO agents — not `ctx.waitUntil`.
- **`broadcast()`** sends raw string to all WebSocket clients. Use `JSON.stringify()` and parse in `onMessage`.
- **`onConnect(connection, ctx)`** — `ctx: ConnectionContext` has `ctx.request` with the HTTP upgrade request headers (e.g., `CF-Connecting-IP`). Store per-connection data via `connection.setState({ ... })`, retrieve later via `connection.state`.
- **`this.getConnections()`** returns a live iterable of all connected WebSockets. Use this for connection counting — **do not maintain a manual counter**, it drifts on rejected connections and resets on DO hibernation.
- **`getCurrentAgent()`** returns `{ agent, connection, request }`. During WS message handling, `connection` is populated. During HTTP RPC, `request` is populated. During scheduled callbacks, both may be `undefined`.
- **Hibernation is on by default** (`static options` defaults `hibernate: true`). All in-memory class properties reset when the DO is evicted. Only `this.sql` and DO storage survive. Design accordingly.

## Workers AI

- **AI model strings** like `@cf/meta/llama-3.1-8b-instruct` and `@cf/black-forest-labs/flux-1-schnell` aren't in `@cloudflare/workers-types` — cast as `any`.
- **Flux text-to-image returns `{ image: string }`** where `image` is already base64. NOT raw bytes, NOT a ReadableStream. Just do:
  ```ts
  const resp = await env.AI.run("@cf/black-forest-labs/flux-1-schnell" as any, { prompt, steps: 4 });
  const dataUri = `data:image/png;base64,${(resp as any).image}`;
  ```
- **Llama text-gen returns `{ response: string }`**.
- **AI binding in wrangler.jsonc** causes remote proxy session in dev — needs `npx wrangler login` first.

## Vite + Cloudflare Plugin

- **`index.html` must be in project root**, not `public/`. The Cloudflare Vite plugin uses it as client entry point.
- **Vite watches `.wrangler/` by default** — SQLite WAL/SHM writes trigger constant page reloads. Fix:
  ```ts
  server: { watch: { ignored: ["**/.wrangler/**"] } }
  ```
- **Multiple CF accounts**: Set `account_id` in `wrangler.jsonc` or `CLOUDFLARE_ACCOUNT_ID` env var.

## Rate Limiting Pattern

- **SQLite-backed sliding window** in `rate_limits` table. Keys like `ip:write:{ip}`, `ip:read:{ip}`, `global:write`. Timestamps stored as JSON arrays.
- **Always fail open.** The rate limiter is wrapped in try/catch — if SQLite or JSON.parse fails, allow the request and log. Guard rails must never become the outage.
- **Self-healing corruption recovery.** If a `rate_limits` row has malformed JSON, delete it and continue with empty timestamps. No manual DB intervention needed.
- **Stale row cleanup** happens inline: when all timestamps in a row have expired, the row is deleted during the next check. No scheduled job needed.
- **Check order matters** in `contribute()`: global limit first (30/min), then per-IP (3/min). Avoids burning a scarce per-IP slot when the global limit rejects.

## Architecture

- Single Durable Object: `GraffitiWall` — handles WS connections, rate limiting, art generation.
- SQLite tables: `graffiti` (content), `rate_limits` (sliding-window counters).
- Art pipeline: `contribute()` → `schedule(0, "generateArt")` → Llama moderation → Llama prompt crafting → Flux image gen → broadcast update.
- All real-time updates via `this.broadcast()` to connected WS clients.

## Node / Tooling

- Node 22 required (`.node-version` file in root).
- `wrangler@4` recommended.
