# vandl

A shared spatial graffiti canvas. Click anywhere on the wall to write something, AI transforms it into street art that sprays onto the spot you clicked, and everyone sees the same wall in real time — cursors and all.

```
You click a spot on the wall
     |
     v
 Type "a cat dreaming of fish"
     |
     v
 Llama 3.1 crafts a street-art prompt
     |
     v
 Flux generates the image (~2s)
     |
     v
 All connected browsers see it spray onto the wall at that exact spot
```

Every hour, the wall rotates — a fresh AI-generated background replaces the current one, and the cycle starts again.

## Architecture

```
                            BROWSER (React 19)
                       +--------------------------+
                       |                          |
                       |  useWall() hook          |
                       |    |                     |
                       |    +- pieces[]           |  <-- real-time state
                       |    +- cursors[]          |  <-- 10Hz cursor updates
                       |    +- backgroundImage    |  <-- hourly AI background
                       |    +- contribute(text,   |
                       |    |    ..., posX, posY)  |  --> RPC call with coords
                       |    +- sendCursor(x,y)    |  --> raw WS "C:x,y,name"
                       |                          |
                       |  Components:             |
                       |    Wall (spatial canvas)  |
                       |      +- CanvasPiece      |  absolute-positioned art
                       |      +- RemoteCursor     |  other users' spray cans
                       |      +- PlacementPrompt  |  click-to-place input
                       |    Header (name + count)  |
                       +----------+---------------+
                                  |
                           WebSocket (persistent)
                           via useAgent("graffiti-wall", "wall")
                                  |
                       +----------+---------------+
                       |  Cloudflare Worker        |
                       |  (src/server.ts)          |
                       |                          |
                       |  routeAgentRequest()     |--> routes WS to DO
                       +----------+---------------+
                                  |
               +------------------+--------------------+
               |  GraffitiWall (Durable Object)        |
               |  extends Agent<Env, WallState>         |
               |                                        |
               |  SQLite: graffiti, wall_backgrounds,   |
               |          wall_snapshots, rate_limits    |
               |  State: { totalPieces,                 |
               |           backgroundImage, wallEpoch } |
               |                                        |
               |  Lifecycle:                            |
               |  +-----------------------------------+ |
               |  | onStart()                         | |
               |  |   CREATE/ALTER tables             | |
               |  |   load persisted state            | |
               |  |   start 10Hz cursor broadcast     | |
               |  |   scheduleEvery(3600, rotateWall) | |
               |  +-----------------------------------+ |
               |  | onMessage(conn, msg)              | |
               |  |   "C:x,y,name" -> cursor relay    | |
               |  |   else -> super (SDK RPC)         | |
               |  +-----------------------------------+ |
               |  | onConnect(conn)                   | |
               |  |   send wall_history + background  | |
               |  +-----------------------------------+ |
               |  | contribute(text, ..., posX, posY) | |
               |  |   INSERT with coords              | |
               |  |   broadcast("piece_added")        | |
               |  |   schedule(0, "generateArt")      | |
               |  +-----------------------------------+ |
               |  | generateArt({ id, text })         | |
               |  |   moderation -> art prompt -> Flux | |
               |  |   broadcast("piece_updated")      | |
               |  +-----------------------------------+ |
               |  | rotateWall() [hourly]             | |
               |  |   Flux -> new background          | |
               |  |   broadcast("wall_rotated")       | |
               |  |   cleanup old pieces/backgrounds  | |
               |  +-----------------------------------+ |
               +--------------+------------------------+
                              |
                    +---------+---------+
                    |  Workers AI (free) |
                    |                   |
                    |  @cf/meta/        |
                    |  llama-3.1-8b     |--> moderation + art prompts
                    |  -instruct        |
                    |                   |
                    |  @cf/black-forest |
                    |  -labs/flux-1     |--> base64 PNG images
                    |  -schnell         |    (art + backgrounds)
                    +-------------------+
```

## Data Flow: Click -> Spray -> Rotate

```
 1. User clicks a spot on the canvas
    |
 2. PlacementPrompt appears at click position
    |  User types text, clicks "Spray"
    |
 3. useWall().contribute(text, author, token, posX, posY)
    |  calls agent.call("contribute", [...])
    |
 4. GraffitiWall.contribute()
    |  INSERT row with pos_x, pos_y (status: "generating")
    |  broadcast -> all clients get "piece_added"
    |  schedule(0, "generateArt", payload)
    |  return { id } -> unblocks client
    |
 5. Client renders pulsing placeholder at (posX, posY)
    |
 6. GraffitiWall.generateArt() runs async via DO alarm
    |  Regex blocklist -> Llama moderation -> art prompt -> Flux image
    |  UPDATE row (status: "complete", image_data: ...)
    |  broadcast -> all clients get "piece_updated"
    |
 7. Client reveals image with radial clip-path spray animation (600ms)
    |
 8. Meanwhile: all users see each other's cursors at 10Hz
    |  Mouse movement -> raw "C:x,y,name" WS messages
    |  Server rebroadcasts cursor positions via JSON
    |
 9. Every hour: rotateWall() generates a fresh AI background
    |  Flux creates new wall with random theme
    |  broadcast("wall_rotated") -> all clients swap background
    |  Old pieces cleaned up (keep last 500)
```

## How the Pieces Fit Together

### Single Durable Object Instance

Every client connects to the same DO: `name: "wall"`. This is intentional — it's one shared mural. The DO holds:

- **SQLite database** — graffiti pieces (with x/y coordinates), wall backgrounds, snapshots
- **WebSocket connections** — all active browsers
- **State** — `{ totalPieces, backgroundImage, wallEpoch }`, auto-synced to clients via `setState()`

### Three Communication Channels

| Channel | Direction | What | How |
|---------|-----------|------|-----|
| **RPC** | Client -> Server | `contribute()`, `getHistory()` | `agent.call()` -> callable methods |
| **Broadcast** | Server -> All | piece_added, piece_updated, wall_history, cursor_update, wall_rotated | `this.broadcast()` -> `onMessage` |
| **Raw WS** | Client -> Server | Cursor position `"C:x,y,name"` | `agent.send()` -> `onMessage` prefix check |

State sync (`totalPieces`, `backgroundImage`, `wallEpoch`) is a fourth implicit channel — `setState()` on server automatically pushes to all clients via the Agents SDK.

### Coordinate System

All positions use **normalized 0-1 floats** stored in the database. The client converts to CSS percentages (`* 100%`) at render time. A piece at `(0.5, 0.5)` is always dead center regardless of screen size. Pieces render at a fixed 200x200px.

### Why `schedule(0, ...)` Instead of `await`

The `contribute()` method needs to return immediately so the client gets instant feedback. The AI generation takes 2-5 seconds. `schedule(0, "generateArt", payload)` queues the work via the DO's alarm system, letting `contribute()` return the piece ID while image generation happens asynchronously.

## Tech Stack

| Layer | Tech | Why |
|-------|------|-----|
| Runtime | Cloudflare Workers + Durable Objects | Global edge, WebSocket support, SQLite built-in |
| Agent framework | `agents` SDK v0.3 | DO lifecycle, RPC, state sync, scheduling |
| AI - Text | Llama 3.1 8B Instruct | Free tier, moderation + art prompts |
| AI - Image | Flux-1-Schnell | Free tier, ~2s generation, art + backgrounds |
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
  pos_x         REAL NOT NULL DEFAULT 0.5,         -- normalized 0-1
  pos_y         REAL NOT NULL DEFAULT 0.5,         -- normalized 0-1
  created_at    TEXT DEFAULT (datetime('now')),
  completed_at  TEXT
);

CREATE TABLE wall_backgrounds (
  id          TEXT PRIMARY KEY,
  image_data  TEXT NOT NULL,                       -- base64 data URI
  seed_words  TEXT,                                -- theme used for generation
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE wall_snapshots (
  id            TEXT PRIMARY KEY,
  epoch         INTEGER NOT NULL,                  -- rotation counter
  piece_count   INTEGER NOT NULL,
  background_id TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
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
