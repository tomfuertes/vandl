# vandl

A shared wall. Click anywhere, type something, watch it become street art — right where you clicked. Everyone on the wall sees the same thing: your art spraying in, their spray cans moving around, the wall filling up together.

Every hour, someone comes by and repaints it. Fresh wall, new background, the cycle starts again.

## How it works

You click a spot. A prompt appears. You type what you're thinking — could be a phrase, a feeling, a bad joke. AI turns it into a street art piece and sprays it onto the wall for everyone in real time.

Meanwhile, you can see other people's cursors drifting around the wall like spray cans looking for a spot. When they tag something, you watch it appear. When you tag something, they watch yours.

The wall fills up. Art overlaps. People build on top of each other. Then the hour rolls over, the wall gets repainted with a fresh AI-generated surface, and it starts clean again. Last 500 pieces stick around in the archive.

## The experience

- **Click to place** — your art goes exactly where you click
- **Real-time cursors** — see other people's spray cans moving on the wall
- **Spray animation** — art reveals with a radial spray effect, not just a pop-in
- **Hourly rotation** — fresh AI-generated wall backgrounds keep it feeling alive
- **Shared space** — one wall, everyone on it, art can overlap

## Under the hood

Built on Cloudflare Workers with a single Durable Object that holds the entire wall state — SQLite for persistence, WebSockets for real-time. AI pipeline runs through Workers AI: Llama for content moderation and art prompt generation, Flux for image generation.

| Layer | Tech |
|-------|------|
| Runtime | Cloudflare Workers + Durable Objects |
| Real-time | WebSocket via Agents SDK v0.3 |
| AI - Text | Llama 3.1 8B Instruct |
| AI - Image | Flux-1-Schnell |
| Frontend | React 19 + Tailwind v4 |
| Build | Vite 6 + @cloudflare/vite-plugin |
| Storage | SQLite (in DO), images as base64 |

<details>
<summary>Architecture details</summary>

### Single shared wall

Every client connects to the same Durable Object instance: `"wall"`. One shared mural, one source of truth. The DO holds:

- **SQLite** — graffiti pieces with x/y coordinates, wall backgrounds, snapshots, rate limits
- **WebSocket connections** — all active browsers
- **State** — `{ totalPieces, backgroundImage, wallEpoch }`, auto-synced to clients

### Coordinate system

All positions are normalized 0-1 floats stored in the database. The client converts to CSS percentages at render time. A piece at `(0.5, 0.5)` is dead center regardless of screen size. Pieces render at a fixed 200x200px.

### Communication

| Channel | Direction | What |
|---------|-----------|------|
| RPC | Client -> Server | `contribute()`, `getHistory()` |
| Broadcast | Server -> All | piece events, cursor updates, wall rotations |
| Raw WS | Client -> Server | Cursor position `"C:x,y,name"` (10Hz) |

### Data flow

1. Click the wall -> prompt appears at click point
2. Type and submit -> server inserts piece with coordinates, broadcasts to all
3. AI pipeline runs async: moderation -> art prompt -> Flux image gen
4. Image broadcasts back -> client reveals with spray animation
5. Every hour: `rotateWall()` generates a new background, cleans up old pieces

</details>

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
