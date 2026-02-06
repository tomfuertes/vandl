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
- **`onConnect(connection)`** — send initial state/history here via `connection.send()`.

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

## Node / Tooling

- Node 22 required (`.node-version` file in root).
- `wrangler@4` recommended.
