import { useState, useCallback, useRef } from "react";
import type { WallSnapshot, WallHistoryEntry } from "../types";

interface UseWallHistoryOptions {
  agent: { call: <T>(method: string, args?: unknown[]) => Promise<T> };
}

const MAX_CONCURRENT_FETCHES = 2;

export function useWallHistory({ agent }: UseWallHistoryOptions) {
  const [index, setIndex] = useState<WallHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, WallSnapshot>());
  const inFlight = useRef(0);
  const queue = useRef<Array<{ id: string; resolve: (v: WallSnapshot | null) => void }>>([]);

  const processQueue = useCallback(() => {
    while (inFlight.current < MAX_CONCURRENT_FETCHES && queue.current.length > 0) {
      const next = queue.current.shift()!;
      inFlight.current++;
      fetchSnapshot(next.id).then(next.resolve);
    }
  }, []);

  const fetchSnapshot = useCallback(async (id: string): Promise<WallSnapshot | null> => {
    try {
      const resp = await fetch(`/api/wall-history/${encodeURIComponent(id)}`);
      if (!resp.ok) {
        console.error(`Snapshot fetch failed: ${resp.status} for id=${id}`);
        return null;
      }
      const snapshot: WallSnapshot = await resp.json();
      cache.current.set(id, snapshot);
      return snapshot;
    } catch (err) {
      console.error("Failed to fetch wall snapshot:", err);
      return null;
    } finally {
      inFlight.current--;
      processQueue();
    }
  }, [processQueue]);

  const refreshIndex = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const entries = await agent.call<WallHistoryEntry[]>("getWallHistoryIndex");
      setIndex(entries);
    } catch (err) {
      console.error("Failed to fetch wall history index:", err);
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setIsLoading(false);
    }
  }, [agent]);

  const getSnapshot = useCallback(async (id: string): Promise<WallSnapshot | null> => {
    const cached = cache.current.get(id);
    if (cached) return cached;

    if (inFlight.current >= MAX_CONCURRENT_FETCHES) {
      return new Promise((resolve) => {
        queue.current.push({ id, resolve });
      });
    }

    inFlight.current++;
    return fetchSnapshot(id);
  }, [fetchSnapshot]);

  return { index, isLoading, error, refreshIndex, getSnapshot };
}
