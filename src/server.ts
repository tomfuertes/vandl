import { Agent, callable, routeAgentRequest, getCurrentAgent } from "agents";
import type { Connection, ConnectionContext } from "agents";
import type { GraffitiPiece, WallState, WallMessage, CursorPosition } from "./types";

interface Env {
  AI: Ai;
  GRAFFITI_WALL: DurableObjectNamespace;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
}

// Register methods as callable imperatively (TC39 decorators
// aren't transpiled by Vite's dev-mode esbuild transform)
const registerCallable = callable();

// --- Rate limiting ---
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_PER_IP_WRITE = 3; // per IP per minute (writes)
const RATE_LIMIT_GLOBAL_WRITE = 30; // total across all IPs per minute (writes)
const RATE_LIMIT_PER_IP_READ = 30; // per IP per minute (reads)

// --- Content pre-filter (fast blocklist before LLM moderation) ---
// Encoded to keep slurs out of source. Decoded once at module load.
const PROFANITY_RE = new RegExp(
  atob("XGIobmlnZyg/OmVyfGEpfGZhZyg/OmdvdCk/fHJldGFyZHxraWtlfHNwaWN8Y2hpbmt8dHJhbm55fGN1bnR8Y29ja1xzKnN1Y2t8Ymxvd1xzKmpvYnxnYW5nXHMqYmFuZ3xjaGlsZFxzKnBvcm58a2lkZGllXHMqcG9ybnxraWxsXHMqKD86eW91cik/c2VsZilcYg=="),
  "i"
);

function containsProfanity(text: string): boolean {
  return PROFANITY_RE.test(text);
}

// --- Input sanitization ---
const HTML_TAG_RE = /<[^>]*>/g;
const SCRIPT_RE = /javascript:|on\w+\s*=|<script|<iframe|<object|<embed/i;
const SQL_INJECT_RE = /(\b(DROP|DELETE|INSERT|UPDATE|ALTER|EXEC|UNION)\b.*\b(TABLE|FROM|INTO|SET)\b)|(--.*)|(;.*\b(DROP|DELETE)\b)/i;

function sanitizeInput(text: string): { clean: string; rejected: string | null } {
  const stripped = text.replace(HTML_TAG_RE, "").trim();

  if (SCRIPT_RE.test(text)) {
    return { clean: "", rejected: "Input contains prohibited content." };
  }
  if (SQL_INJECT_RE.test(text)) {
    return { clean: "", rejected: "Input contains prohibited content." };
  }
  if (stripped.length === 0) {
    return { clean: "", rejected: "Text cannot be empty." };
  }
  if (stripped.length > 500) {
    return { clean: stripped.slice(0, 500), rejected: null };
  }
  return { clean: stripped, rejected: null };
}

export class GraffitiWall extends Agent<Env, WallState> {
  initialState: WallState = { totalPieces: 0, backgroundImage: null, wallEpoch: 0 };

  // Concurrency limit for AI generation pipelines
  private pendingGenerations = 0;
  private readonly MAX_CONCURRENT_GENERATIONS = 3;

  private readonly MAX_CONNECTIONS = 100;

  // 10Hz cursor broadcast interval (ephemeral — resets on DO eviction)
  private cursorBroadcastInterval: ReturnType<typeof setInterval> | null = null;

  private getConnectionCount(): number {
    let count = 0;
    for (const _ of this.getConnections()) count++;
    return count;
  }

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS graffiti (
      id TEXT PRIMARY KEY,
      author_name TEXT DEFAULT 'Anonymous',
      original_text TEXT NOT NULL,
      art_prompt TEXT,
      image_data TEXT,
      status TEXT NOT NULL DEFAULT 'generating',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )`;
    this.sql`CREATE INDEX IF NOT EXISTS idx_graffiti_created_at ON graffiti(created_at DESC)`;

    // Spatial canvas columns (idempotent migration)
    try { this.sql`ALTER TABLE graffiti ADD COLUMN pos_x REAL NOT NULL DEFAULT 0.5`; } catch {}
    try { this.sql`ALTER TABLE graffiti ADD COLUMN pos_y REAL NOT NULL DEFAULT 0.5`; } catch {}

    this.sql`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      timestamps TEXT NOT NULL DEFAULT '[]'
    )`;

    this.sql`CREATE TABLE IF NOT EXISTS wall_backgrounds (
      id TEXT PRIMARY KEY,
      image_data TEXT NOT NULL,
      seed_words TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`;

    this.sql`CREATE TABLE IF NOT EXISTS wall_snapshots (
      id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL,
      piece_count INTEGER NOT NULL,
      background_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`;

    // Load persisted state
    const row = this.sql<{ count: number }>`SELECT COUNT(*) as count FROM graffiti`[0];
    const epochRow = this.sql<{ epoch: number }>`
      SELECT MAX(epoch) as epoch FROM wall_snapshots
    `[0];
    const bgRow = this.sql<{ image_data: string }>`
      SELECT image_data FROM wall_backgrounds ORDER BY created_at DESC LIMIT 1
    `[0];

    this.setState({
      totalPieces: row?.count ?? 0,
      backgroundImage: bgRow?.image_data ?? null,
      wallEpoch: epochRow?.epoch ?? 0,
    });

    // 10Hz cursor broadcast to all connected clients
    this.cursorBroadcastInterval = setInterval(() => {
      const cursors: CursorPosition[] = [];
      for (const conn of this.getConnections()) {
        const state = conn.state as {
          cursorX?: number;
          cursorY?: number;
          cursorName?: string;
        };
        if (state?.cursorX !== undefined) {
          cursors.push({
            id: conn.id,
            name: state.cursorName || "Anonymous",
            x: state.cursorX,
            y: state.cursorY!,
          });
        }
      }
      if (cursors.length > 0) {
        this.broadcast(JSON.stringify({
          type: "cursor_update",
          cursors,
        } satisfies WallMessage));
      }
    }, 100);

    // Hourly wall rotation (idempotent — only register if not already scheduled)
    const existing = this.getSchedules({ type: "interval" });
    const hasRotation = existing.some((s: any) => s.callback === "rotateWall");
    if (!hasRotation) {
      this.scheduleEvery(3600, "rotateWall" as any);
    }

    // Generate initial background if none exists yet
    if (!bgRow) {
      this.schedule(0, "rotateWall" as any);
    }

    // Mark methods as callable for RPC from useAgent().call()
    registerCallable(this.contribute, { kind: "method", name: "contribute" } as any);
    registerCallable(this.getHistory, { kind: "method", name: "getHistory" } as any);
  }

  /** Get client IP from connection state (WS) or request headers (HTTP RPC). */
  private getClientIp(): string {
    const { connection, request } = getCurrentAgent();
    const connIp = (connection?.state as { ip?: string } | null)?.ip;
    if (connIp) return connIp;
    return request?.headers.get("CF-Connecting-IP") ?? "unknown-ip";
  }

  /** Verify a Turnstile token against Cloudflare's siteverify endpoint. */
  private async verifyTurnstile(token: string | undefined) {
    if (!this.env.TURNSTILE_SECRET) return;
    if (!token) {
      throw new Error("Bot verification required.");
    }
    const ip = this.getClientIp();
    const resp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: this.env.TURNSTILE_SECRET,
          response: token,
          remoteip: ip,
        }),
      }
    );
    const result = (await resp.json()) as { success: boolean };
    if (!result.success) {
      throw new Error("Bot verification failed.");
    }
  }

  /**
   * SQLite-backed sliding-window rate limiter. Records a timestamp on success
   * and returns null. Returns an error message if over the limit. Fails open
   * (allows the request) if SQLite or JSON parsing errors occur.
   */
  private checkRateLimit(key: string, limit: number): string | null {
    try {
      const now = Date.now();
      const windowStart = now - RATE_LIMIT_WINDOW_MS;

      const row = this.sql<{ timestamps: string }>`
        SELECT timestamps FROM rate_limits WHERE key = ${key}
      `[0];

      let timestamps: number[];
      if (row) {
        try {
          const parsed = JSON.parse(row.timestamps);
          timestamps = Array.isArray(parsed) ? parsed : [];
        } catch {
          console.error(`Corrupted rate_limits row for key="${key}", resetting`);
          this.sql`DELETE FROM rate_limits WHERE key = ${key}`;
          timestamps = [];
        }
      } else {
        timestamps = [];
      }

      timestamps = timestamps.filter((t) => t > windowStart);

      if (timestamps.length >= limit) {
        const retryIn = Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000);
        // Write back pruned timestamps
        this.sql`INSERT OR REPLACE INTO rate_limits (key, timestamps)
          VALUES (${key}, ${JSON.stringify(timestamps)})`;
        return `Rate limited. Try again in ${retryIn}s`;
      }

      if (timestamps.length === 0 && row) {
        // Clean up stale rows with no active timestamps
        this.sql`DELETE FROM rate_limits WHERE key = ${key}`;
      }

      timestamps.push(now);
      this.sql`INSERT OR REPLACE INTO rate_limits (key, timestamps)
        VALUES (${key}, ${JSON.stringify(timestamps)})`;
      return null;
    } catch (err) {
      console.error(`Rate limiter error for key="${key}":`, err);
      return null; // Fail open: allow the request
    }
  }

  onMessage(connection: Connection, message: string | ArrayBuffer) {
    if (typeof message === "string" && message.startsWith("C:")) {
      // Cursor update: "C:0.45,0.32,PlayerName"
      const parts = message.slice(2).split(",");
      const x = Math.max(0, Math.min(1, parseFloat(parts[0]) || 0));
      const y = Math.max(0, Math.min(1, parseFloat(parts[1]) || 0));
      const name = (parts.slice(2).join(",") || "Anonymous").slice(0, 50);

      connection.setState({
        ...(connection.state as Record<string, unknown>),
        cursorX: x,
        cursorY: y,
        cursorName: name,
      });
      return; // Don't pass to SDK — cursor data is ephemeral
    }

    super.onMessage(connection, message);
  }

  onConnect(connection: Connection, ctx: ConnectionContext) {
    if (this.getConnectionCount() >= this.MAX_CONNECTIONS) {
      connection.close(1013, "Too many connections");
      return;
    }

    // Store client IP so getClientIp() can retrieve it during WS message handling
    const ip = ctx.request.headers.get("CF-Connecting-IP") ?? "unknown-ip";
    connection.setState({ ip });

    const pieces = this.sql<GraffitiPiece>`
      SELECT id, author_name, original_text, art_prompt, image_data, status, error_message, pos_x, pos_y, created_at, completed_at
      FROM graffiti ORDER BY created_at DESC LIMIT 50
    `;
    const msg: WallMessage = {
      type: "wall_history",
      pieces: pieces.reverse(),
      total: this.state.totalPieces,
      turnstileSiteKey: this.env.TURNSTILE_SITE_KEY || undefined,
      backgroundImage: this.state.backgroundImage,
      wallEpoch: this.state.wallEpoch,
    };
    connection.send(JSON.stringify(msg));
  }

  async contribute(text: string, authorName?: string, turnstileToken?: string, posX?: number, posY?: number) {
    // Turnstile bot verification (before rate limiting to avoid burning slots on bots)
    await this.verifyTurnstile(turnstileToken);

    // Rate limit: check global first (avoids burning per-IP slot on global rejection)
    const globalError = this.checkRateLimit("global:write", RATE_LIMIT_GLOBAL_WRITE);
    if (globalError) throw new Error("The wall is busy. Try again in a moment.");
    const ip = this.getClientIp();
    const perIpError = this.checkRateLimit(`ip:write:${ip}`, RATE_LIMIT_PER_IP_WRITE);
    if (perIpError) throw new Error(perIpError);

    // Input sanitization
    const { clean: cleanText, rejected } = sanitizeInput(text);
    if (rejected) {
      throw new Error(rejected);
    }

    // Backpressure: reject before inserting if too many AI pipelines are in-flight
    if (this.pendingGenerations >= this.MAX_CONCURRENT_GENERATIONS) {
      throw new Error("Server busy generating art. Please try again in a moment.");
    }

    const name = sanitizeInput(authorName ?? "").clean.slice(0, 50) || "Anonymous";
    const id = crypto.randomUUID();
    const x = Math.max(0, Math.min(1, Number(posX) || 0.5));
    const y = Math.max(0, Math.min(1, Number(posY) || 0.5));

    this.sql`INSERT INTO graffiti (id, author_name, original_text, status, pos_x, pos_y)
      VALUES (${id}, ${name}, ${cleanText}, 'generating', ${x}, ${y})`;

    const piece = this.sql<GraffitiPiece>`SELECT * FROM graffiti WHERE id = ${id}`[0];
    this.setState({ ...this.state, totalPieces: this.state.totalPieces + 1 });
    this.broadcast(JSON.stringify({ type: "piece_added", piece } satisfies WallMessage));

    // Acquire semaphore slot synchronously with the check (avoids TOCTOU race)
    this.pendingGenerations++;
    this.schedule(0, "generateArt", { id, text: cleanText });

    return { id };
  }

  async getHistory(offset: number = 0, limit: number = 50) {
    // Input validation
    offset = Math.max(0, Math.floor(Number(offset) || 0));
    limit = Math.max(1, Math.min(Math.floor(Number(limit) || 50), 100));

    // Rate limit reads by IP
    const ip = this.getClientIp();
    const readError = this.checkRateLimit(`ip:read:${ip}`, RATE_LIMIT_PER_IP_READ);
    if (readError) throw new Error(readError);

    const pieces = this.sql<GraffitiPiece>`
      SELECT id, author_name, original_text, art_prompt, image_data, status, error_message, pos_x, pos_y, created_at, completed_at
      FROM graffiti ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    return { pieces: pieces.reverse(), total: this.state.totalPieces };
  }

  private failPiece(id: string, errorMessage: string) {
    try {
      this.sql`UPDATE graffiti SET
        status = 'failed',
        error_message = ${errorMessage.slice(0, 500)}
        WHERE id = ${id}`;
      const piece = this.sql<GraffitiPiece>`SELECT * FROM graffiti WHERE id = ${id}`[0];
      if (piece) {
        this.broadcast(JSON.stringify({ type: "piece_updated", piece } satisfies WallMessage));
      }
    } catch (recoverErr) {
      console.error("Failed to record error state for piece", id, ":", recoverErr);
    }
  }

  async generateArt(payload: { id: string; text: string }) {
    const { id, text } = payload;
    try {
      // Step 1a: Fast regex pre-filter for obvious profanity/slurs
      if (containsProfanity(text)) {
        this.failPiece(id, "Content flagged by moderation");
        return;
      }

      // Step 1b: LLM-based content moderation (default-unsafe: only exact "SAFE" passes)
      const moderationResponse = (await this.env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct" as any,
        {
          messages: [
            {
              role: "system",
              content:
                "You are a content moderator. Classify the following user text as SAFE or UNSAFE. UNSAFE means: sexually explicit, violent/gory, illegal activity, hate speech, harassment, self-harm, or content involving minors inappropriately. Respond with ONLY one word: SAFE or UNSAFE.",
            },
            { role: "user", content: text },
          ],
          max_tokens: 5,
        }
      )) as { response?: string };

      const verdict = moderationResponse.response?.trim().toUpperCase();
      if (verdict !== "SAFE") {
        this.failPiece(id, "Content flagged by moderation");
        return;
      }

      // Step 2: Craft a street-art prompt via LLM
      const llmResponse = (await this.env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct" as any,
        {
          messages: [
            {
              role: "system",
              content:
                "You are a street art director. Given a user's sentence, create a vivid, concise image prompt for an AI image generator. The style should evoke urban street art, graffiti murals, stencil art, or wheat-paste posters. Output ONLY the image prompt, nothing else. Keep it under 200 characters.",
            },
            { role: "user", content: text },
          ],
          max_tokens: 100,
        }
      )) as { response?: string };

      const artPrompt = (llmResponse.response?.trim() || `Street art mural of: ${text}`).slice(0, 500);

      // Step 3: Generate image with Flux
      const imageResponse = await this.env.AI.run(
        "@cf/black-forest-labs/flux-1-schnell" as any,
        { prompt: artPrompt, steps: 4 }
      );

      // Workers AI text-to-image returns { image: base64string }
      const resp = imageResponse as any;
      const imageData = `data:image/png;base64,${resp.image}`;

      // Step 4: Update row and broadcast
      this.sql`UPDATE graffiti SET
        art_prompt = ${artPrompt},
        image_data = ${imageData},
        status = 'complete',
        completed_at = datetime('now')
        WHERE id = ${id}`;

      try {
        const piece = this.sql<GraffitiPiece>`SELECT * FROM graffiti WHERE id = ${id}`[0];
        this.broadcast(JSON.stringify({ type: "piece_updated", piece } satisfies WallMessage));
      } catch (broadcastErr) {
        console.error("Broadcast failed after successful generation for piece", id, ":", broadcastErr);
      }
    } catch (err) {
      console.error("generateArt failed:", err);
      this.failPiece(id, err instanceof Error ? err.message : "Generation failed");
    } finally {
      this.pendingGenerations = Math.max(0, this.pendingGenerations - 1);
    }
  }

  async rotateWall() {
    try {
      const epoch = (this.state.wallEpoch ?? 0) + 1;

      const walls = [
        "large blank red brick building wall with a sidewalk in front",
        "empty concrete side of a warehouse, a strip of pavement at the bottom",
        "plain cinderblock wall of a school building, grass below",
        "whitewashed side of a building on a quiet street",
        "big blank stucco wall of an apartment building, narrow sidewalk below",
        "flat plywood construction hoarding along a city street",
        "painted-over side of a corner store, cracked sidewalk",
        "bare concrete retaining wall along a road",
        "blank stone wall of an old factory, weeds at the base",
        "clean side of a parking garage, asphalt below",
      ];
      const wall = walls[Math.floor(Math.random() * walls.length)];
      const seed = `street photography, ${wall}, straight-on view, daytime, no people, no graffiti, no text, the wall takes up most of the frame`;

      const imageResponse = await this.env.AI.run(
        "@cf/black-forest-labs/flux-1-schnell" as any,
        { prompt: seed, steps: 4 }
      );
      const bgImage = `data:image/png;base64,${(imageResponse as any).image}`;

      const bgId = crypto.randomUUID();
      this.sql`INSERT INTO wall_backgrounds (id, image_data, seed_words)
               VALUES (${bgId}, ${bgImage}, ${wall})`;

      // Snapshot current epoch
      const pieceCount = this.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM graffiti
        WHERE created_at > datetime('now', '-1 hour')
      `[0]?.count ?? 0;

      this.sql`INSERT INTO wall_snapshots (id, epoch, piece_count, background_id)
               VALUES (${crypto.randomUUID()}, ${epoch}, ${pieceCount}, ${bgId})`;

      this.setState({
        ...this.state,
        backgroundImage: bgImage,
        wallEpoch: epoch,
      });

      this.broadcast(JSON.stringify({
        type: "wall_rotated",
        backgroundImage: bgImage,
        wallEpoch: epoch,
      } satisfies WallMessage));

      // Cleanup: keep last 24 backgrounds
      this.sql`DELETE FROM wall_backgrounds WHERE id NOT IN (
        SELECT id FROM wall_backgrounds ORDER BY created_at DESC LIMIT 24
      )`;

      // Cleanup: keep last 500 pieces
      this.sql`DELETE FROM graffiti WHERE id NOT IN (
        SELECT id FROM graffiti ORDER BY created_at DESC LIMIT 500
      )`;
    } catch (err) {
      console.error("rotateWall failed:", err);
    }
  }
}

// Prevent callers from addressing arbitrary DO instances via /agents/:class/:name
const ALLOWED_INSTANCE_NAMES = new Set(["wall"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    // data: for base64 AI art, unsafe-inline for Tailwind/Vite styles
    // 'self' covers same-origin wss: in CSP Level 3 (w3c/webappsec-csp#7, Firefox bug 1345615)
    // — no need for blanket wss: which would allow connections to ANY WebSocket origin
    // challenges.cloudflare.com: Turnstile bot verification (script + iframe)
    "default-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; frame-src https://challenges.cloudflare.com",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
} as const;

// Clone response to get mutable headers (Workers responses are often immutable)
function withSecurityHeaders(response: Response): Response {
  // WebSocket upgrades carry a non-standard .webSocket property — re-wrapping destroys it
  if (response.status === 101 || (response as any).webSocket) {
    return response;
  }
  const secured = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    secured.headers.set(key, value);
  }
  return secured;
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      const url = new URL(request.url);

      // Path convention: /agents/<className>/<instanceName>
      const agentMatch = url.pathname.match(/^\/agents\/[^/]+\/([^/]+)/);
      if (agentMatch) {
        const instanceName = decodeURIComponent(agentMatch[1]);
        if (!ALLOWED_INSTANCE_NAMES.has(instanceName)) {
          return withSecurityHeaders(new Response("Not found", { status: 404 }));
        }
      }

      const response =
        (await routeAgentRequest(request, env)) ||
        new Response("Not found", { status: 404 });

      return withSecurityHeaders(response);
    } catch (err) {
      console.error("Unhandled fetch error:", err);
      return new Response("Internal server error", {
        status: 500,
        headers: SECURITY_HEADERS,
      });
    }
  },
} satisfies ExportedHandler<Env>;
