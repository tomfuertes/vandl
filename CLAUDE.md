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

## Architecture — `src/server.ts`

- **Single Durable Object class `GraffitiWall`** handles all state: SQLite for persistence, WebSocket broadcast for real-time updates, and `schedule()` for background AI work.
- **SQLite tables**: `graffiti` (content), `rate_limits` (sliding-window counters).
- **`contribute()` → `schedule(0, "generateArt")`** pipeline: contribute does validation/insert/broadcast synchronously, then defers the 3-step AI pipeline (moderation → prompt gen → image gen) to a scheduled method.
- **Concurrency semaphore** (`pendingGenerations`): incremented in `contribute()` (same synchronous frame as the check), decremented in `generateArt()`'s `finally`. In-memory only — resets on DO eviction. Keep check-and-acquire atomic to avoid TOCTOU races with `schedule()`.
- **Connection limit** (`MAX_CONNECTIONS`): enforced in `onConnect()` using `getConnections()` iterable count. Rejects with WebSocket close code 1013.
- **`failPiece(id, message)`** helper: centralizes the fail-update-broadcast pattern with its own try-catch so SQL/broadcast errors never propagate and hide the original error.
- **Content moderation is two layers**: (1) base64-encoded regex blocklist for obvious terms (no AI cost), (2) Llama LLM check with strict `verdict !== "SAFE"` equality (default-unsafe — anything other than exact "SAFE" is rejected).
- **Field truncation**: `artPrompt` and `errorMessage` are `.slice(0, 500)` before SQLite storage (done inside `failPiece` and inline for artPrompt).
- All real-time updates via `this.broadcast()` to connected WS clients.

## Patterns & Conventions

- **Profanity/blocklist regex** is base64-encoded at module scope to keep slurs out of source. Decoded once via `atob()` at module load.
- **LLM response parsing**: always treat LLM output as untrusted — truncate, trim, and use strict equality rather than substring matching for classification responses.
- **Error handling in `generateArt`**: success-path broadcast is wrapped in its own try-catch so a broadcast failure doesn't overwrite a successful DB update with a failure status.

## Node / Tooling

- Node 22 required (`.node-version` file in root).
- `wrangler@4` recommended.
