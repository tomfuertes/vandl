export interface GraffitiPiece {
  id: string;
  author_name: string;
  original_text: string;
  art_prompt: string | null;
  image_data: string | null;
  status: "generating" | "complete" | "failed";
  error_message: string | null;
  style: string | null;
  pos_x: number;
  pos_y: number;
  created_at: string;
  completed_at: string | null;
}

export interface WallState {
  totalPieces: number;
  backgroundImage: string | null;
  wallEpoch: number;
}

export interface CursorPosition {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface SnapshotPiece {
  id: string;
  image_data: string;
  pos_x: number;
  pos_y: number;
  author_name: string;
  art_prompt: string | null;
}

export interface WallSnapshot {
  id: string;
  epoch: number;
  backgroundImage: string;
  pieces: SnapshotPiece[];
  pieceCount: number;
  createdAt: string;
}

export interface WallHistoryEntry {
  id: string;
  epoch: number;
  pieceCount: number;
  createdAt: string;
}

export type WallMessage =
  | {
      type: "wall_history";
      pieces: GraffitiPiece[];
      total: number;
      turnstileSiteKey?: string;
      backgroundImage: string | null;
      wallEpoch: number;
    }
  | { type: "piece_added"; piece: GraffitiPiece }
  | { type: "piece_updated"; piece: GraffitiPiece }
  | { type: "cursor_update"; cursors: CursorPosition[] }
  | { type: "wall_rotated"; backgroundImage: string; wallEpoch: number }
  | { type: "wall_history_updated" };
