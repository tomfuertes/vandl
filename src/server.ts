import { Agent, callable, routeAgentRequest, getCurrentAgent } from "agents";
import type { Connection, ConnectionContext } from "agents";
import type { GraffitiPiece, WallState, WallMessage } from "./types";

interface Env {
  AI: Ai;
  GRAFFITI_WALL: DurableObjectNamespace;
}

// Register methods as callable imperatively (TC39 decorators
// aren't transpiled by Vite's dev-mode esbuild transform)
const registerCallable = callable();

// --- Rate limiting ---
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_PER_IP_WRITE = 3; // per IP per minute (writes)
const RATE_LIMIT_GLOBAL_WRITE = 30; // total across all IPs per minute (writes)
const RATE_LIMIT_PER_IP_READ = 30; // per IP per minute (reads)

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
  initialState: WallState = { totalPieces: 0 };

  private readonly MAX_CONNECTIONS = 100;

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

    this.sql`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      timestamps TEXT NOT NULL DEFAULT '[]'
    )`;

    const row = this.sql<{ count: number }>`SELECT COUNT(*) as count FROM graffiti`[0];
    this.setState({ totalPieces: row?.count ?? 0 });

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

  onConnect(connection: Connection, ctx: ConnectionContext) {
    if (this.getConnectionCount() >= this.MAX_CONNECTIONS) {
      connection.close(1013, "Too many connections");
      return;
    }

    // Store client IP so getClientIp() can retrieve it during WS message handling
    const ip = ctx.request.headers.get("CF-Connecting-IP") ?? "unknown-ip";
    connection.setState({ ip });

    const pieces = this.sql<GraffitiPiece>`
      SELECT id, author_name, original_text, art_prompt, image_data, status, error_message, created_at, completed_at
      FROM graffiti ORDER BY created_at DESC LIMIT 50
    `;
    const msg: WallMessage = {
      type: "wall_history",
      pieces: pieces.reverse(),
      total: this.state.totalPieces,
    };
    connection.send(JSON.stringify(msg));
  }

  async contribute(text: string, authorName?: string) {
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

    const name = sanitizeInput(authorName ?? "").clean.slice(0, 50) || "Anonymous";
    const id = crypto.randomUUID();

    this.sql`INSERT INTO graffiti (id, author_name, original_text, status)
      VALUES (${id}, ${name}, ${cleanText}, 'generating')`;

    const piece = this.sql<GraffitiPiece>`SELECT * FROM graffiti WHERE id = ${id}`[0];
    this.setState({ totalPieces: this.state.totalPieces + 1 });
    this.broadcast(JSON.stringify({ type: "piece_added", piece } satisfies WallMessage));

    // Schedule immediate background art generation (includes content moderation)
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
      SELECT id, author_name, original_text, art_prompt, image_data, status, error_message, created_at, completed_at
      FROM graffiti ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
    `;
    return { pieces: pieces.reverse(), total: this.state.totalPieces };
  }

  async generateArt(payload: { id: string; text: string }) {
    const { id, text } = payload;
    try {
      // Step 1: Content moderation via LLM
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
      if (verdict?.includes("UNSAFE")) {
        this.sql`UPDATE graffiti SET
          status = 'failed',
          error_message = 'Content flagged by moderation'
          WHERE id = ${id}`;
        const piece = this.sql<GraffitiPiece>`SELECT * FROM graffiti WHERE id = ${id}`[0];
        this.broadcast(JSON.stringify({ type: "piece_updated", piece } satisfies WallMessage));
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

      const artPrompt = llmResponse.response?.trim() || `Street art mural of: ${text}`;

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

      const piece = this.sql<GraffitiPiece>`SELECT * FROM graffiti WHERE id = ${id}`[0];
      this.broadcast(JSON.stringify({ type: "piece_updated", piece } satisfies WallMessage));
    } catch (err) {
      console.error("generateArt failed:", err);
      const errorMessage = err instanceof Error ? err.message : "Generation failed";
      this.sql`UPDATE graffiti SET
        status = 'failed',
        error_message = ${errorMessage}
        WHERE id = ${id}`;

      const piece = this.sql<GraffitiPiece>`SELECT * FROM graffiti WHERE id = ${id}`[0];
      this.broadcast(JSON.stringify({ type: "piece_updated", piece } satisfies WallMessage));
    }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
