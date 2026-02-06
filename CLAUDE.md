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

## Architecture — `src/server.ts`

- **Single Durable Object class `GraffitiWall`** handles all state: SQLite for persistence, WebSocket broadcast for real-time updates, and `schedule()` for background AI work.
- **`contribute()` → `schedule(0, "generateArt")`** pipeline: contribute does validation/insert/broadcast synchronously, then defers the 3-step AI pipeline (moderation → prompt gen → image gen) to a scheduled method.
- **Concurrency semaphore** (`pendingGenerations`): incremented in `contribute()` (same synchronous frame as the check), decremented in `generateArt()`'s `finally`. In-memory only — resets on DO eviction. Keep check-and-acquire atomic to avoid TOCTOU races with `schedule()`.
- **`failPiece(id, message)`** helper: centralizes the fail-update-broadcast pattern with its own try-catch so SQL/broadcast errors never propagate and hide the original error.
- **Content moderation is two layers**: (1) base64-encoded regex blocklist for obvious terms (no AI cost), (2) Llama LLM check with strict `verdict !== "SAFE"` equality (default-unsafe — anything other than exact "SAFE" is rejected).
- **Field truncation**: `artPrompt` and `errorMessage` are `.slice(0, 500)` before SQLite storage (done inside `failPiece` and inline for artPrompt).
- **Rate limiting** is module-scoped (not on the class): per-connection and global maps with sliding window timestamps.

## Patterns & Conventions

- **Profanity/blocklist regex** is base64-encoded at module scope to keep slurs out of source. Decoded once via `atob()` at module load.
- **LLM response parsing**: always treat LLM output as untrusted — truncate, trim, and use strict equality rather than substring matching for classification responses.
- **Error handling in `generateArt`**: success-path broadcast is wrapped in its own try-catch so a broadcast failure doesn't overwrite a successful DB update with a failure status.

## Node / Tooling

- Node 22 required (`.node-version` file in root).
- `wrangler@4` recommended.
