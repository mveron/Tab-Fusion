import type { SessionSnapshot } from "@/shared/types";

interface PruneOptions {
  maxCount: number;
  maxAgeMs: number;
  now?: Date;
}

export function pruneSnapshots(
  snapshots: SessionSnapshot[],
  options: PruneOptions,
): SessionSnapshot[] {
  const now = options.now ?? new Date();
  const minimumTimestamp = now.getTime() - options.maxAgeMs;

  return [...snapshots]
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )
    .filter((snapshot) => new Date(snapshot.createdAt).getTime() >= minimumTimestamp)
    .slice(0, options.maxCount);
}
