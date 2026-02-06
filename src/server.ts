import { Agent, callable, routeAgentRequest, getCurrentAgent } from "agents";
import type { Connection } from "agents";
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
const RATE_LIMIT_PER_CONNECTION = 3; // per connection per minute
const RATE_LIMIT_GLOBAL = 30; // total across all connections per minute
const rateLimitMap = new Map<string, number[]>(); // connectionId -> timestamps
const globalTimestamps: number[] = [];

function checkRateLimit(connectionId: string): string | null {
  const now = Date.now();

  // Global rate limit
  while (globalTimestamps.length && globalTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    globalTimestamps.shift();
  }
  if (globalTimestamps.length >= RATE_LIMIT_GLOBAL) {
    return "The wall is busy. Try again in a moment.";
  }

  // Per-connection rate limit
  let timestamps = rateLimitMap.get(connectionId);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(connectionId, timestamps);
  }
  while (timestamps.length && timestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_PER_CONNECTION) {
    return "Slow down — max 3 per minute.";
  }

  timestamps.push(now);
  globalTimestamps.push(now);
  return null;
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
  initialState: WallState = { totalPieces: 0 };

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

    const row = this.sql<{ count: number }>`SELECT COUNT(*) as count FROM graffiti`[0];
    this.setState({ totalPieces: row?.count ?? 0 });

    // Mark methods as callable for RPC from useAgent().call()
    registerCallable(this.contribute, { kind: "method", name: "contribute" } as any);
    registerCallable(this.getHistory, { kind: "method", name: "getHistory" } as any);
  }

  onConnect(connection: Connection) {
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

  onClose(connection: Connection) {
    rateLimitMap.delete(connection.id);
  }

  async contribute(text: string, authorName?: string) {
    // Rate limit check
    const { connection } = getCurrentAgent();
    const rateLimitError = checkRateLimit(connection?.id ?? "unknown");
    if (rateLimitError) {
      throw new Error(rateLimitError);
    }

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
    const clampedLimit = Math.min(limit, 100);
    const pieces = this.sql<GraffitiPiece>`
      SELECT id, author_name, original_text, art_prompt, image_data, status, error_message, created_at, completed_at
      FROM graffiti ORDER BY created_at DESC LIMIT ${clampedLimit} OFFSET ${offset}
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
