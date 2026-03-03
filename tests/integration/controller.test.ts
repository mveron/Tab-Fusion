import { createBackgroundController } from "@/background/controller";
import { LAST_MERGE_STORAGE_KEY, SNAPSHOTS_STORAGE_KEY } from "@/shared/constants";
import { createFakeBrowser } from "../helpers/fakeBrowser";

describe("background controller", () => {
  it("merges windows, stores a snapshot, restores it, and skips non-restorable urls", async () => {
    const fake = createFakeBrowser({
      windows: [
        {
          id: 1,
          focused: true,
          tabs: [
            { id: 11, title: "Inbox", url: "https://mail.example.com", pinned: true, active: true },
            { id: 12, title: "Docs", url: "https://docs.example.com" },
          ],
        },
        {
          id: 2,
          tabs: [
            { id: 21, title: "Board", url: "https://jira.example.com", groupId: 100 },
            { id: 22, title: "PR", url: "https://github.com/example/repo/pull/1", groupId: 100 },
          ],
        },
        {
          id: 3,
          tabs: [
            { id: 31, title: "Settings", url: "chrome://settings" },
            { id: 32, title: "Calendar", url: "https://calendar.example.com" },
          ],
        },
      ],
      groups: [
        {
          id: 100,
          windowId: 2,
          title: "Trabajo",
          color: "green",
          collapsed: false,
        },
      ],
    });
    const controller = createBackgroundController(fake.browser);

    const mergeResponse = await controller.handleMessage({ type: "MERGE_ALL_WINDOWS" });

    expect(mergeResponse.ok).toBe(true);

    if (!mergeResponse.ok || mergeResponse.type !== "MERGE_ALL_WINDOWS_RESULT") {
      throw new Error("La respuesta de merge no fue la esperada.");
    }

    expect(mergeResponse.data.status).toBe("merged");
    expect(fake.getWindows()).toHaveLength(1);

    const storedSnapshots = fake.getStorage()[SNAPSHOTS_STORAGE_KEY] as Array<{ id: string }>;
    expect(storedSnapshots).toHaveLength(1);

    const targetGroups = await fake.browser.tabGroups.query({ windowId: 1 });
    expect(targetGroups.some((group: chrome.tabGroups.TabGroup) => group.title === "Trabajo")).toBe(
      true,
    );

    const restoreResponse = await controller.handleMessage({
      type: "RESTORE_SNAPSHOT",
      payload: { snapshotId: storedSnapshots[0].id },
    });

    expect(restoreResponse.ok).toBe(true);

    if (!restoreResponse.ok || restoreResponse.type !== "RESTORE_SNAPSHOT_RESULT") {
      throw new Error("La respuesta de restore no fue la esperada.");
    }

    expect(restoreResponse.data.restoredWindows).toBe(3);
    expect(restoreResponse.data.restoredTabs).toBe(5);
    expect(restoreResponse.data.skipped).toHaveLength(1);
    expect(fake.getWindows()).toHaveLength(4);
  });

  it("creates a manual group from selected tabs", async () => {
    const fake = createFakeBrowser({
      windows: [
        {
          id: 8,
          focused: true,
          tabs: [
            { id: 81, title: "A", url: "https://a.example.com" },
            { id: 82, title: "B", url: "https://b.example.com" },
            { id: 83, title: "C", url: "https://c.example.com" },
          ],
        },
      ],
    });
    const controller = createBackgroundController(fake.browser);

    const response = await controller.handleMessage({
      type: "CREATE_MANUAL_GROUP",
      payload: {
        windowId: 8,
        tabIds: [81, 83],
        title: "Contexto",
        color: "purple",
      },
    });

    expect(response.ok).toBe(true);

    if (!response.ok || response.type !== "CREATE_MANUAL_GROUP_RESULT") {
      throw new Error("La respuesta de grouping no fue la esperada.");
    }

    expect(response.data.title).toBe("Contexto");

    const groups = await fake.browser.tabGroups.query({ windowId: 8 });
    expect(groups).toHaveLength(1);
    expect(groups[0].color).toBe("purple");
  });

  it("groups tabs by domain in the current window", async () => {
    const fake = createFakeBrowser({
      windows: [
        {
          id: 15,
          focused: true,
          tabs: [
            { id: 151, title: "Docs 1", url: "https://docs.example.com/a" },
            { id: 152, title: "Docs 2", url: "https://docs.example.com/b" },
            { id: 153, title: "Mail", url: "https://mail.example.com" },
            { id: 154, title: "Pinned", url: "https://docs.example.com/c", pinned: true },
          ],
        },
      ],
    });
    const controller = createBackgroundController(fake.browser);

    const response = await controller.handleMessage({
      type: "AUTO_GROUP_BY_DOMAIN",
      payload: {
        scope: "current_window",
        windowId: 15,
      },
    });

    expect(response.ok).toBe(true);

    if (!response.ok || response.type !== "AUTO_GROUP_BY_DOMAIN_RESULT") {
      throw new Error("La respuesta de auto-group no fue la esperada.");
    }

    expect(response.data.createdGroups).toBe(1);
    expect(response.data.groupedTabs).toBe(2);

    const groups = await fake.browser.tabGroups.query({ windowId: 15 });
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("docs.example.com");
  });

  it("detects and closes duplicate tabs", async () => {
    const fake = createFakeBrowser({
      windows: [
        {
          id: 20,
          focused: true,
          tabs: [
            { id: 201, title: "Repo A", url: "https://github.com/example/repo" },
            { id: 202, title: "Repo B", url: "https://github.com/example/repo#files" },
            { id: 203, title: "Docs", url: "https://docs.example.com" },
          ],
        },
        {
          id: 21,
          tabs: [{ id: 211, title: "Repo C", url: "https://github.com/example/repo" }],
        },
      ],
    });
    const controller = createBackgroundController(fake.browser);

    const scanResponse = await controller.handleMessage({ type: "FIND_DUPLICATE_TABS" });

    expect(scanResponse.ok).toBe(true);

    if (!scanResponse.ok || scanResponse.type !== "FIND_DUPLICATE_TABS_RESULT") {
      throw new Error("La respuesta de duplicate scan no fue la esperada.");
    }

    expect(scanResponse.data.clusterCount).toBe(1);
    expect(scanResponse.data.duplicateTabCount).toBe(2);

    const closeResponse = await controller.handleMessage({ type: "CLOSE_DUPLICATE_TABS" });

    expect(closeResponse.ok).toBe(true);

    if (!closeResponse.ok || closeResponse.type !== "CLOSE_DUPLICATE_TABS_RESULT") {
      throw new Error("La respuesta de duplicate close no fue la esperada.");
    }

    expect(closeResponse.data.closedTabCount).toBe(2);
    const remainingTabs = fake.getWindows().flatMap((window) => window.tabs ?? []);
    expect(remainingTabs).toHaveLength(2);
  });

  it("undoes the last merge when the merged tabs are still intact", async () => {
    const fake = createFakeBrowser({
      windows: [
        {
          id: 30,
          focused: true,
          tabs: [{ id: 301, title: "Alpha", url: "https://alpha.example.com" }],
        },
        {
          id: 31,
          tabs: [{ id: 311, title: "Beta", url: "https://beta.example.com" }],
        },
      ],
    });
    const controller = createBackgroundController(fake.browser);

    const mergeResponse = await controller.handleMessage({ type: "MERGE_ALL_WINDOWS" });

    expect(mergeResponse.ok).toBe(true);
    expect(fake.getWindows()).toHaveLength(1);
    expect(fake.getStorage()[LAST_MERGE_STORAGE_KEY]).toBeTruthy();

    const undoResponse = await controller.handleMessage({ type: "UNDO_LAST_MERGE" });

    expect(undoResponse.ok).toBe(true);

    if (!undoResponse.ok || undoResponse.type !== "UNDO_LAST_MERGE_RESULT") {
      throw new Error("La respuesta de undo no fue la esperada.");
    }

    expect(undoResponse.data.status).toBe("undone");
    expect(undoResponse.data.closedTabCount).toBe(2);
    expect(fake.getWindows()).toHaveLength(2);
  });

  it("imports snapshots and skips duplicate ids", async () => {
    const fake = createFakeBrowser({
      windows: [
        {
          id: 40,
          focused: true,
          tabs: [{ id: 401, title: "Only", url: "https://example.com" }],
        },
      ],
    });
    const controller = createBackgroundController(fake.browser);
    const importedSnapshot = {
      id: "imported-1",
      schemaVersion: 1,
      createdAt: "2026-03-02T12:00:00.000Z",
      action: "merge_all_windows" as const,
      targetWindowId: 40,
      windowCount: 1,
      tabCount: 1,
      windows: [
        {
          originalWindowId: 40,
          focused: true,
          state: "normal" as const,
          tabs: [
            {
              url: "https://example.com",
              title: "Only",
              pinned: false,
              active: true,
              index: 0,
              originalGroupKey: null,
            },
          ],
          groups: [],
        },
      ],
      skippedOnRestore: [],
    };

    const firstImport = await controller.handleMessage({
      type: "IMPORT_SNAPSHOTS",
      payload: { snapshots: [importedSnapshot] },
    });

    expect(firstImport.ok).toBe(true);

    if (!firstImport.ok || firstImport.type !== "IMPORT_SNAPSHOTS_RESULT") {
      throw new Error("La primera importación no respondió como se esperaba.");
    }

    expect(firstImport.data.importedCount).toBe(1);

    const secondImport = await controller.handleMessage({
      type: "IMPORT_SNAPSHOTS",
      payload: { snapshots: [importedSnapshot] },
    });

    expect(secondImport.ok).toBe(true);

    if (!secondImport.ok || secondImport.type !== "IMPORT_SNAPSHOTS_RESULT") {
      throw new Error("La segunda importación no respondió como se esperaba.");
    }

    expect(secondImport.data.importedCount).toBe(0);
    expect(secondImport.data.skippedCount).toBe(1);
  });
});
