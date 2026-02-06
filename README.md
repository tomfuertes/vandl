# vandl

A shared digital graffiti wall. Write a sentence, AI transforms it into street art, everyone sees the same wall in real time.

```
You type: "a cat dreaming of fish"
     |
     v
 Llama 3.1 crafts a street-art prompt
     |
     v
 Flux generates the image (~2s)
     |
     v
 All connected browsers see it appear
```

## Architecture

```
                            BROWSER (React 19)
                       ┌─────────────────────────┐
                       │                         │
                       │  useWall() hook         │
                       │    |                    │
                       │    ├─ pieces[]          │  ◄── real-time state
                       │    ├─ contribute()      │  ──► RPC call
                       │    └─ totalPieces       │  ◄── synced via setState
                       │                         │
                       │  Components:            │
                       │    Wall → GraffitiCard  │
                       │    ContributeForm       │
                       │    Header               │
                       └────────┬────────────────┘
                                │
                         WebSocket (persistent)
                         via useAgent("graffiti-wall", "wall")
                                │
                       ┌────────┴────────────────┐
                       │  Cloudflare Worker       │
                       │  (src/server.ts)         │
                       │                         │
                       │  routeAgentRequest()    │──► routes WS to DO
                       └────────┬────────────────┘
                                │
               ┌────────────────┴────────────────────┐
               │  GraffitiWall (Durable Object)      │
               │  extends Agent<Env, WallState>       │
               │                                      │
               │  SQLite: graffiti table              │
               │  State: { totalPieces }              │
               │                                      │
               │  Lifecycle:                          │
               │  ┌─────────────────────────────────┐ │
               │  │ onStart()                       │ │
               │  │   CREATE TABLE, sync count      │ │
               │  │   register callable methods     │ │
               │  ├─────────────────────────────────┤ │
               │  │ onConnect(conn)                 │ │
               │  │   send last 50 pieces           │ │
               │  ├─────────────────────────────────┤ │
               │  │ contribute(text, author?)  [RPC]│ │
               │  │   INSERT placeholder            │ │
               │  │   broadcast("piece_added")      │ │
               │  │   schedule(0, "generateArt")    │ │
               │  │   return { id }                 │ │
               │  ├─────────────────────────────────┤ │
               │  │ generateArt({ id, text })       │ │
               │  │   Llama → art prompt            │ │
               │  │   Flux  → base64 image          │ │
               │  │   UPDATE row                    │ │
               │  │   broadcast("piece_updated")    │ │
               │  └─────────────────────────────────┘ │
               └──────────────┬───────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  Workers AI (free) │
                    │                   │
                    │  @cf/meta/        │
                    │  llama-3.1-8b     │──► "street art of a cat
                    │  -instruct        │    dreaming of koi fish,
                    │                   │    stencil style, neon"
                    │  @cf/black-forest │
                    │  -labs/flux-1     │──► base64 PNG image
                    │  -schnell         │
                    └───────────────────┘
```

## Data Flow: Submit → Image Appears

```
 1. User clicks "Spray it"
    │
 2. useWall().contribute(text)
    │  calls agent.call("contribute", [text])
    │
 3. GraffitiWall.contribute()
    │  INSERT row (status: "generating")
    │  broadcast → all clients get "piece_added"
    │  schedule(0, "generateArt", payload)
    │  return { id } → unblocks client
    │
 4. Client renders placeholder card (pulsing animation)
    │
 5. GraffitiWall.generateArt() runs async via DO alarm
    │  Llama: user text → art prompt
    │  Flux:  art prompt → base64 PNG
    │  UPDATE row (status: "complete", image_data: ...)
    │  broadcast → all clients get "piece_updated"
    │
 6. Client swaps placeholder → image card (fade-in)
```

## How the Pieces Fit Together

### Single Durable Object Instance

Every client connects to the same DO: `name: "wall"`. This is intentional — it's one shared mural. The DO holds:

- **SQLite database** — all graffiti pieces, persisted across restarts
- **WebSocket connections** — all active browsers
- **State** — `{ totalPieces }`, auto-synced to all clients via `setState()`

### Two Communication Channels

| Channel | Direction | What | How |
|---------|-----------|------|-----|
| **RPC** | Client → Server | `contribute()`, `getHistory()` | `agent.call()` → callable methods |
| **Broadcast** | Server → All Clients | piece_added, piece_updated, wall_history | `this.broadcast()` → `onMessage` |

State sync (`totalPieces`) is a third implicit channel — `setState()` on server automatically pushes to all clients via the Agents SDK.

### Why `schedule(0, ...)` Instead of `await`

The `contribute()` method needs to return immediately so the client gets instant feedback. The AI generation takes 2-5 seconds. `schedule(0, "generateArt", payload)` queues the work via the DO's alarm system, letting `contribute()` return the piece ID while image generation happens asynchronously.

## Tech Stack

| Layer | Tech | Why |
|-------|------|-----|
| Runtime | Cloudflare Workers + Durable Objects | Global edge, WebSocket support, SQLite built-in |
| Agent framework | `agents` SDK v0.3 | DO lifecycle, RPC, state sync, scheduling |
| AI - Text | Llama 3.1 8B Instruct | Free tier, crafts art prompts from user text |
| AI - Image | Flux-1-Schnell | Free tier, ~2s generation, good quality |
| Frontend | React 19 | Component model, hooks |
| Styling | Tailwind CSS v4 | Utility-first, dark theme |
| Build | Vite 6 + @cloudflare/vite-plugin | HMR, Workers runtime in dev |
| Storage | SQLite (in DO) | Zero setup, images as base64 (~100KB each) |

## SQL Schema

```sql
CREATE TABLE graffiti (
  id            TEXT PRIMARY KEY,
  author_name   TEXT DEFAULT 'Anonymous',
  original_text TEXT NOT NULL,
  art_prompt    TEXT,                              -- LLM-generated
  image_data    TEXT,                              -- base64 data URI
  status        TEXT NOT NULL DEFAULT 'generating', -- generating|complete|failed
  error_message TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  completed_at  TEXT
);
```

## Development

```bash
npm install
npx wrangler login          # required for AI binding
npx vite dev                # http://localhost:5173
```

## Deploy

```bash
npx vite build && npx wrangler deploy
```
