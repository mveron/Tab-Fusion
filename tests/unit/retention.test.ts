import { pruneSnapshots } from "@/background/retention";
import type { SessionSnapshot } from "@/shared/types";

function buildSnapshot(id: string, createdAt: string): SessionSnapshot {
  return {
    id,
    schemaVersion: 1,
    createdAt,
    action: "merge_all_windows",
    targetWindowId: 1,
    windowCount: 1,
    tabCount: 1,
    windows: [],
    skippedOnRestore: [],
  };
}

describe("snapshot retention", () => {
  it("drops old snapshots and enforces max count", () => {
    const now = new Date("2026-03-02T12:00:00.000Z");
    const snapshots = [
      buildSnapshot("fresh-a", "2026-03-02T11:00:00.000Z"),
      buildSnapshot("fresh-b", "2026-03-01T10:00:00.000Z"),
      buildSnapshot("old", "2025-01-01T00:00:00.000Z"),
    ];

    const pruned = pruneSnapshots(snapshots, {
      now,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      maxCount: 1,
    });

    expect(pruned).toHaveLength(1);
    expect(pruned[0].id).toBe("fresh-a");
  });
});
