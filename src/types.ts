export interface GraffitiPiece {
  id: string;
  author_name: string;
  original_text: string;
  art_prompt: string | null;
  image_data: string | null;
  status: "generating" | "complete" | "failed";
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface WallState {
  totalPieces: number;
}

export type WallMessage =
  | { type: "wall_history"; pieces: GraffitiPiece[]; total: number; turnstileSiteKey?: string }
  | { type: "piece_added"; piece: GraffitiPiece }
  | { type: "piece_updated"; piece: GraffitiPiece };
