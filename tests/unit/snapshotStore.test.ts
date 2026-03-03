import { normalizeStoredSnapshots } from "@/storage/snapshotStore";

describe("snapshot store", () => {
  it("normalizes persisted snapshots and filters incompatible payloads", () => {
    const normalized = normalizeStoredSnapshots([
      {
        id: "valid",
        schemaVersion: 1,
        createdAt: "2026-03-02T10:00:00.000Z",
        action: "merge_all_windows",
        targetWindowId: 1,
        windowCount: 2,
        tabCount: 4,
        windows: [],
        skippedOnRestore: [],
      },
      {
        id: "invalid-schema",
        schemaVersion: 2,
        createdAt: "2026-03-02T09:00:00.000Z",
        targetWindowId: 1,
        windowCount: 1,
        tabCount: 1,
        windows: [],
      },
      {
        foo: "bar",
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe("valid");
  });
});
