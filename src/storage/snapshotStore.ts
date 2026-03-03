import {
  LAST_MERGE_STORAGE_KEY,
  MAX_SNAPSHOT_AGE_MS,
  MAX_SNAPSHOT_COUNT,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOTS_STORAGE_KEY,
} from "@/shared/constants";
import type { LastMergeState, SessionSnapshot } from "@/shared/types";
import { pruneSnapshots } from "@/background/retention";

export interface StorageAreaLike {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<SessionSnapshot>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.targetWindowId === "number" &&
    typeof candidate.windowCount === "number" &&
    typeof candidate.tabCount === "number" &&
    Array.isArray(candidate.windows) &&
    typeof candidate.schemaVersion === "number"
  );
}

export function normalizeStoredSnapshots(raw: unknown): SessionSnapshot[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(isSessionSnapshot)
    .filter((snapshot) => snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION)
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
}

function isLastMergeState(value: unknown): value is LastMergeState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LastMergeState>;
  return (
    typeof candidate.snapshotId === "string" &&
    typeof candidate.targetWindowId === "number" &&
    Array.isArray(candidate.mergedTabIds) &&
    typeof candidate.createdAt === "string"
  );
}

export async function listSnapshots(storage: StorageAreaLike): Promise<SessionSnapshot[]> {
  const stored = await storage.get(SNAPSHOTS_STORAGE_KEY);
  return normalizeStoredSnapshots(stored[SNAPSHOTS_STORAGE_KEY]);
}

export async function saveSnapshot(
  storage: StorageAreaLike,
  snapshot: SessionSnapshot,
): Promise<SessionSnapshot[]> {
  const existing = await listSnapshots(storage);
  const pruned = pruneSnapshots([snapshot, ...existing], {
    maxAgeMs: MAX_SNAPSHOT_AGE_MS,
    maxCount: MAX_SNAPSHOT_COUNT,
  });

  await storage.set({
    [SNAPSHOTS_STORAGE_KEY]: pruned,
  });

  return pruned;
}

export async function getSnapshotById(
  storage: StorageAreaLike,
  snapshotId: string,
): Promise<SessionSnapshot | undefined> {
  const snapshots = await listSnapshots(storage);
  return snapshots.find((snapshot) => snapshot.id === snapshotId);
}

export async function deleteSnapshot(
  storage: StorageAreaLike,
  snapshotId: string,
): Promise<SessionSnapshot[]> {
  const snapshots = await listSnapshots(storage);
  const nextSnapshots = snapshots.filter((snapshot) => snapshot.id !== snapshotId);

  await storage.set({
    [SNAPSHOTS_STORAGE_KEY]: nextSnapshots,
  });

  return nextSnapshots;
}

export async function pruneStoredSnapshots(
  storage: StorageAreaLike,
): Promise<SessionSnapshot[]> {
  const snapshots = await listSnapshots(storage);
  const pruned = pruneSnapshots(snapshots, {
    maxAgeMs: MAX_SNAPSHOT_AGE_MS,
    maxCount: MAX_SNAPSHOT_COUNT,
  });

  if (pruned.length !== snapshots.length) {
    await storage.set({
      [SNAPSHOTS_STORAGE_KEY]: pruned,
    });
  }

  return pruned;
}

export async function importSnapshots(
  storage: StorageAreaLike,
  importedSnapshots: SessionSnapshot[],
): Promise<{ importedCount: number; skippedCount: number; snapshots: SessionSnapshot[] }> {
  const existing = await listSnapshots(storage);
  const normalizedImported = normalizeStoredSnapshots(importedSnapshots);
  const knownIds = new Set(existing.map((snapshot) => snapshot.id));
  const acceptedImports = normalizedImported.filter((snapshot) => !knownIds.has(snapshot.id));
  const pruned = pruneSnapshots([...acceptedImports, ...existing], {
    maxAgeMs: MAX_SNAPSHOT_AGE_MS,
    maxCount: MAX_SNAPSHOT_COUNT,
  });

  await storage.set({
    [SNAPSHOTS_STORAGE_KEY]: pruned,
  });

  return {
    importedCount: acceptedImports.length,
    skippedCount: importedSnapshots.length - acceptedImports.length,
    snapshots: pruned,
  };
}

export async function getLastMergeState(
  storage: StorageAreaLike,
): Promise<LastMergeState | undefined> {
  const stored = await storage.get(LAST_MERGE_STORAGE_KEY);
  const candidate = stored[LAST_MERGE_STORAGE_KEY];
  return isLastMergeState(candidate) ? candidate : undefined;
}

export async function saveLastMergeState(
  storage: StorageAreaLike,
  state: LastMergeState,
): Promise<void> {
  await storage.set({
    [LAST_MERGE_STORAGE_KEY]: state,
  });
}

export async function clearLastMergeState(storage: StorageAreaLike): Promise<void> {
  await storage.set({
    [LAST_MERGE_STORAGE_KEY]: null,
  });
}
