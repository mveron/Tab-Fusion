import {
  RETENTION_ALARM_NAME,
  RETENTION_ALARM_PERIOD_MINUTES,
} from "@/shared/constants";
import type { ExtensionBrowser } from "@/background/browser";
import {
  buildGroupKey,
  buildSessionSnapshot,
  sortTabsByIndex,
} from "@/background/snapshotBuilders";
import { buildDuplicateClusters, getColorForGroup, getTabDomain } from "@/background/tabAnalysis";
import type {
  AutoGroupByDomainRequest,
  AutoGroupByDomainResult,
  CloseDuplicateTabsResult,
  CreateGroupRequest,
  CreateGroupResult,
  DeleteSnapshotResult,
  ExtensionMessage,
  ExtensionResponse,
  FindDuplicateTabsResult,
  ImportSnapshotsResult,
  LastMergeState,
  ListSnapshotsResult,
  MergeAllWindowsResult,
  RestoreSnapshotResult,
  SessionSnapshot,
  SkippedTabRecord,
  UndoLastMergeResult,
  WindowSnapshot,
} from "@/shared/types";
import { isRestorableUrl } from "@/shared/url";
import {
  clearLastMergeState,
  deleteSnapshot,
  getLastMergeState,
  getSnapshotById,
  importSnapshots,
  listSnapshots,
  pruneStoredSnapshots,
  saveLastMergeState,
  saveSnapshot,
} from "@/storage/snapshotStore";

interface BackgroundController {
  initialize(): Promise<void>;
  pruneSnapshots(): Promise<void>;
  mergeAllWindows(): Promise<MergeAllWindowsResult>;
  createManualGroup(request: CreateGroupRequest): Promise<CreateGroupResult>;
  autoGroupByDomain(request: AutoGroupByDomainRequest): Promise<AutoGroupByDomainResult>;
  findDuplicateTabs(): Promise<FindDuplicateTabsResult>;
  closeDuplicateTabs(): Promise<CloseDuplicateTabsResult>;
  listSnapshots(): Promise<ListSnapshotsResult>;
  restoreSnapshot(snapshotId: string): Promise<RestoreSnapshotResult>;
  deleteSnapshot(snapshotId: string): Promise<DeleteSnapshotResult>;
  undoLastMerge(): Promise<UndoLastMergeResult>;
  importSnapshots(snapshots: SessionSnapshot[]): Promise<ImportSnapshotsResult>;
  handleMessage(message: ExtensionMessage): Promise<ExtensionResponse>;
}

interface RestoreSnapshotInternalResult extends RestoreSnapshotResult {
  createdWindowIds: number[];
}

function ok<T extends ExtensionResponse>(response: T): T {
  return response;
}

function errorResponse(error: unknown): ExtensionResponse {
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Se produjo un error inesperado.",
  };
}

function requireWindowId(window: chrome.windows.Window): number {
  if (typeof window.id !== "number") {
    throw new Error("No se pudo resolver el identificador de la ventana.");
  }

  return window.id;
}

function requireTabId(tab: chrome.tabs.Tab): number {
  if (typeof tab.id !== "number") {
    throw new Error("No se pudo resolver el identificador de una tab.");
  }

  return tab.id;
}

function getEligibleWindows(windows: chrome.windows.Window[]): chrome.windows.Window[] {
  return windows.filter(
    (window) =>
      !window.incognito &&
      window.type === "normal" &&
      Array.isArray(window.tabs) &&
      window.tabs.length > 0,
  );
}

async function loadGroupsByWindowId(
  browser: ExtensionBrowser,
  windows: chrome.windows.Window[],
): Promise<Map<number, chrome.tabGroups.TabGroup[]>> {
  const entries = await Promise.all(
    windows.map(async (window) => {
      const windowId = requireWindowId(window);
      const groups = await browser.tabGroups.query({ windowId });
      return [windowId, groups] as const;
    }),
  );

  return new Map(entries);
}

function buildCreateWindowState(
  windowSnapshot: WindowSnapshot,
  firstUrl: string | undefined,
): chrome.windows.CreateData {
  const createData: chrome.windows.CreateData = {
    focused: false,
    url: firstUrl ?? "about:blank",
    type: "normal",
  };

  if (windowSnapshot.state && windowSnapshot.state !== "normal") {
    createData.state = windowSnapshot.state;
    return createData;
  }

  createData.state = "normal";

  if (typeof windowSnapshot.left === "number") {
    createData.left = windowSnapshot.left;
  }

  if (typeof windowSnapshot.top === "number") {
    createData.top = windowSnapshot.top;
  }

  if (typeof windowSnapshot.width === "number") {
    createData.width = windowSnapshot.width;
  }

  if (typeof windowSnapshot.height === "number") {
    createData.height = windowSnapshot.height;
  }

  return createData;
}

async function applyWindowGeometry(
  browser: ExtensionBrowser,
  windowId: number,
  windowSnapshot: WindowSnapshot,
): Promise<void> {
  const updateInfo: chrome.windows.UpdateInfo = {};

  if (windowSnapshot.state && windowSnapshot.state !== "normal") {
    updateInfo.state = windowSnapshot.state;
  } else {
    if (typeof windowSnapshot.left === "number") {
      updateInfo.left = windowSnapshot.left;
    }

    if (typeof windowSnapshot.top === "number") {
      updateInfo.top = windowSnapshot.top;
    }

    if (typeof windowSnapshot.width === "number") {
      updateInfo.width = windowSnapshot.width;
    }

    if (typeof windowSnapshot.height === "number") {
      updateInfo.height = windowSnapshot.height;
    }

    updateInfo.state = "normal";
  }

  if (Object.keys(updateInfo).length > 0) {
    await browser.windows.update(windowId, updateInfo);
  }
}

function toPublicRestoreResult(
  result: RestoreSnapshotInternalResult,
): RestoreSnapshotResult {
  return {
    snapshotId: result.snapshotId,
    restoredWindows: result.restoredWindows,
    restoredTabs: result.restoredTabs,
    skipped: result.skipped,
  };
}

function buildLastMergeState(
  snapshotId: string,
  targetWindowId: number,
  mergedTabIds: number[],
): LastMergeState {
  return {
    snapshotId,
    targetWindowId,
    mergedTabIds,
    createdAt: new Date().toISOString(),
  };
}

export function createBackgroundController(
  browser: ExtensionBrowser,
): BackgroundController {
  async function initialize(): Promise<void> {
    browser.alarms.create(RETENTION_ALARM_NAME, {
      periodInMinutes: RETENTION_ALARM_PERIOD_MINUTES,
    });

    await pruneStoredSnapshots(browser.storage.local);
  }

  async function pruneSnapshots(): Promise<void> {
    await pruneStoredSnapshots(browser.storage.local);
  }

  async function mergeAllWindows(): Promise<MergeAllWindowsResult> {
    const allWindows = await browser.windows.getAll({
      populate: true,
      windowTypes: ["normal"],
    });
    const eligibleWindows = getEligibleWindows(allWindows);

    if (eligibleWindows.length < 2) {
      return {
        status: "noop",
        reason: "single_window",
        totalWindows: eligibleWindows.length,
        windowsMerged: 0,
        tabsMoved: 0,
      };
    }

    const targetWindow =
      eligibleWindows.find((window) => window.focused) ?? eligibleWindows[0];
    const targetWindowId = requireWindowId(targetWindow);
    const groupsByWindowId = await loadGroupsByWindowId(browser, eligibleWindows);
    const snapshot = buildSessionSnapshot(
      eligibleWindows,
      groupsByWindowId,
      targetWindowId,
    );

    await saveSnapshot(browser.storage.local, snapshot);

    const sourceWindows = eligibleWindows.filter(
      (window) => requireWindowId(window) !== targetWindowId,
    );
    const targetTabs = sortTabsByIndex(targetWindow.tabs ?? []);
    let pinnedInsertIndex = targetTabs.filter((tab) => tab.pinned).length;
    let unpinnedInsertIndex = targetTabs.length;
    let movedTabCount = 0;

    const groupTabIdsByKey = new Map<string, number[]>();

    for (const sourceWindow of sourceWindows) {
      const windowId = requireWindowId(sourceWindow);
      const tabs = sortTabsByIndex(sourceWindow.tabs ?? []);
      const pinnedTabs = tabs.filter((tab) => tab.pinned);
      const unpinnedTabs = tabs.filter((tab) => !tab.pinned);

      for (const tab of tabs) {
        if (typeof tab.groupId === "number" && tab.groupId >= 0 && typeof tab.id === "number") {
          const key = buildGroupKey(windowId, tab.groupId);
          const existing = groupTabIdsByKey.get(key) ?? [];
          existing.push(tab.id);
          groupTabIdsByKey.set(key, existing);
        }
      }

      for (const tab of pinnedTabs) {
        const tabId = requireTabId(tab);
        await browser.tabs.move(tabId, {
          windowId: targetWindowId,
          index: pinnedInsertIndex,
        });
        pinnedInsertIndex += 1;
        unpinnedInsertIndex += 1;
        movedTabCount += 1;
      }

      for (const tab of unpinnedTabs) {
        const tabId = requireTabId(tab);
        await browser.tabs.move(tabId, {
          windowId: targetWindowId,
          index: unpinnedInsertIndex,
        });
        unpinnedInsertIndex += 1;
        movedTabCount += 1;
      }
    }

    for (const sourceWindow of snapshot.windows) {
      if (sourceWindow.originalWindowId === targetWindowId) {
        continue;
      }

      for (const group of sourceWindow.groups) {
        const tabIds = groupTabIdsByKey.get(group.key) ?? [];

        if (tabIds.length === 0) {
          continue;
        }

        const groupId = await browser.tabs.group({
          createProperties: { windowId: targetWindowId },
          tabIds,
        });

        await browser.tabGroups.update(groupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed,
        });
      }
    }

    const mergedTabs = await browser.tabs.query({ windowId: targetWindowId });
    const mergedTabIds = sortTabsByIndex(mergedTabs)
      .map((tab) => tab.id)
      .filter((tabId): tabId is number => typeof tabId === "number");

    await saveLastMergeState(
      browser.storage.local,
      buildLastMergeState(snapshot.id, targetWindowId, mergedTabIds),
    );

    return {
      status: "merged",
      snapshotId: snapshot.id,
      targetWindowId,
      totalWindows: eligibleWindows.length,
      windowsMerged: sourceWindows.length,
      tabsMoved: movedTabCount,
    };
  }

  async function createManualGroup(
    request: CreateGroupRequest,
  ): Promise<CreateGroupResult> {
    const title = request.title.trim();

    if (!title) {
      throw new Error("El grupo necesita un nombre.");
    }

    const uniqueTabIds = [...new Set(request.tabIds)].filter((tabId) => Number.isInteger(tabId));

    if (uniqueTabIds.length < 2) {
      throw new Error("Selecciona al menos dos tabs para crear un grupo.");
    }

    const currentTabs = await browser.tabs.query({ windowId: request.windowId });
    const selectedTabs = sortTabsByIndex(
      currentTabs.filter((tab) => uniqueTabIds.includes(tab.id ?? -1)),
    );

    if (selectedTabs.length < 2) {
      throw new Error("Las tabs seleccionadas ya no están disponibles en esa ventana.");
    }

    const groupId = await browser.tabs.group({
      tabIds: selectedTabs.map((tab) => requireTabId(tab)),
      createProperties: {
        windowId: request.windowId,
      },
    });

    await browser.tabGroups.update(groupId, {
      title,
      color: request.color,
      collapsed: false,
    });

    return {
      groupId,
      windowId: request.windowId,
      title,
      color: request.color,
      tabCount: selectedTabs.length,
    };
  }

  async function autoGroupByDomain(
    request: AutoGroupByDomainRequest,
  ): Promise<AutoGroupByDomainResult> {
    const allWindows = await browser.windows.getAll({
      populate: true,
      windowTypes: ["normal"],
    });
    const eligibleWindows = getEligibleWindows(allWindows);
    const targetWindows =
      request.scope === "current_window"
        ? eligibleWindows.filter((window) => requireWindowId(window) === request.windowId)
        : eligibleWindows;

    if (targetWindows.length === 0) {
      throw new Error("No se encontró una ventana válida para agrupar por dominio.");
    }

    let createdGroups = 0;
    let groupedTabs = 0;
    let skippedTabs = 0;

    for (const window of targetWindows) {
      const tabs = sortTabsByIndex(window.tabs ?? []);
      const tabIdsByDomain = new Map<string, number[]>();

      for (const tab of tabs) {
        if (tab.pinned || typeof tab.id !== "number") {
          skippedTabs += 1;
          continue;
        }

        const domain = getTabDomain(tab);

        if (!domain) {
          skippedTabs += 1;
          continue;
        }

        const current = tabIdsByDomain.get(domain) ?? [];
        current.push(tab.id);
        tabIdsByDomain.set(domain, current);
      }

      let domainIndex = 0;

      for (const [domain, tabIds] of tabIdsByDomain.entries()) {
        if (tabIds.length < 2) {
          skippedTabs += tabIds.length;
          continue;
        }

        const groupId = await browser.tabs.group({
          createProperties: { windowId: requireWindowId(window) },
          tabIds,
        });

        await browser.tabGroups.update(groupId, {
          title: domain,
          color: getColorForGroup(domainIndex),
          collapsed: false,
        });

        createdGroups += 1;
        groupedTabs += tabIds.length;
        domainIndex += 1;
      }
    }

    return {
      createdGroups,
      groupedTabs,
      skippedTabs,
      processedWindows: targetWindows.length,
    };
  }

  async function findDuplicateTabs(): Promise<FindDuplicateTabsResult> {
    const allWindows = await browser.windows.getAll({
      populate: true,
      windowTypes: ["normal"],
    });
    const clusters = buildDuplicateClusters(getEligibleWindows(allWindows));

    return {
      clusterCount: clusters.length,
      duplicateTabCount: clusters.reduce(
        (total, cluster) => total + cluster.duplicateTabIds.length,
        0,
      ),
      clusters,
    };
  }

  async function closeDuplicateTabs(): Promise<CloseDuplicateTabsResult> {
    const duplicates = await findDuplicateTabs();
    const tabIdsToClose = duplicates.clusters.flatMap((cluster) => cluster.duplicateTabIds);

    if (tabIdsToClose.length > 0) {
      await browser.tabs.remove(tabIdsToClose);
    }

    return {
      clusterCount: duplicates.clusterCount,
      closedTabCount: tabIdsToClose.length,
      closedTabIds: tabIdsToClose,
    };
  }

  async function restoreSnapshotInternal(
    snapshotId: string,
  ): Promise<RestoreSnapshotInternalResult> {
    const snapshot = await getSnapshotById(browser.storage.local, snapshotId);

    if (!snapshot) {
      throw new Error("No se encontró el snapshot solicitado.");
    }

    let restoredWindows = 0;
    let restoredTabs = 0;
    const skipped: SkippedTabRecord[] = [];
    const createdWindowIds: number[] = [];

    for (const windowSnapshot of snapshot.windows) {
      const restorableTabs = windowSnapshot.tabs.filter((tab) => isRestorableUrl(tab.url));
      const skippedTabs = windowSnapshot.tabs
        .filter((tab) => !isRestorableUrl(tab.url))
        .map<SkippedTabRecord>((tab) => ({
          title: tab.title,
          url: tab.url,
          reason: tab.url ? "non_restorable_url" : "missing_url",
        }));

      skipped.push(...skippedTabs);

      const firstUrl = restorableTabs[0]?.url ?? undefined;
      const createdWindow = await browser.windows.create(
        buildCreateWindowState(windowSnapshot, firstUrl),
      );
      const createdWindowId = requireWindowId(createdWindow);
      createdWindowIds.push(createdWindowId);

      restoredWindows += 1;

      await applyWindowGeometry(browser, createdWindowId, windowSnapshot);

      if (restorableTabs.length === 0) {
        continue;
      }

      const createdTabRecords: Array<{
        snapshotKey: string | null;
        tabId: number;
        active: boolean;
      }> = [];
      const firstCreatedTab = createdWindow.tabs?.[0];

      if (!firstCreatedTab) {
        throw new Error("Chrome no devolvió la primera tab de la ventana restaurada.");
      }

      await browser.tabs.update(requireTabId(firstCreatedTab), {
        pinned: restorableTabs[0].pinned,
        active: false,
      });

      createdTabRecords.push({
        snapshotKey: restorableTabs[0].originalGroupKey,
        tabId: requireTabId(firstCreatedTab),
        active: restorableTabs[0].active,
      });

      for (let index = 1; index < restorableTabs.length; index += 1) {
        const tabSnapshot = restorableTabs[index];
        const createdTab = await browser.tabs.create({
          windowId: createdWindowId,
          url: tabSnapshot.url ?? "about:blank",
          active: false,
          pinned: tabSnapshot.pinned,
          index,
        });

        createdTabRecords.push({
          snapshotKey: tabSnapshot.originalGroupKey,
          tabId: requireTabId(createdTab),
          active: tabSnapshot.active,
        });
      }

      const groupTabIdsByKey = new Map<string, number[]>();

      for (const record of createdTabRecords) {
        if (!record.snapshotKey) {
          continue;
        }

        const existing = groupTabIdsByKey.get(record.snapshotKey) ?? [];
        existing.push(record.tabId);
        groupTabIdsByKey.set(record.snapshotKey, existing);
      }

      for (const group of windowSnapshot.groups) {
        const tabIds = groupTabIdsByKey.get(group.key) ?? [];

        if (tabIds.length === 0) {
          continue;
        }

        const groupId = await browser.tabs.group({
          createProperties: { windowId: createdWindowId },
          tabIds,
        });

        await browser.tabGroups.update(groupId, {
          title: group.title,
          color: group.color,
          collapsed: group.collapsed,
        });
      }

      const activeTab =
        createdTabRecords.find((record) => record.active) ?? createdTabRecords[0];

      await browser.tabs.update(activeTab.tabId, { active: true });
      restoredTabs += createdTabRecords.length;
    }

    return {
      snapshotId: snapshot.id,
      restoredWindows,
      restoredTabs,
      skipped,
      createdWindowIds,
    };
  }

  async function restoreSnapshot(snapshotId: string): Promise<RestoreSnapshotResult> {
    return toPublicRestoreResult(await restoreSnapshotInternal(snapshotId));
  }

  async function listSnapshotsAction(): Promise<ListSnapshotsResult> {
    return {
      snapshots: await listSnapshots(browser.storage.local),
    };
  }

  async function deleteSnapshotAction(
    snapshotId: string,
  ): Promise<DeleteSnapshotResult> {
    await deleteSnapshot(browser.storage.local, snapshotId);

    return {
      snapshotId,
    };
  }

  async function undoLastMerge(): Promise<UndoLastMergeResult> {
    const lastMerge = await getLastMergeState(browser.storage.local);

    if (!lastMerge) {
      return {
        status: "unavailable",
        reason: "no_merge",
        restoredWindows: 0,
        restoredTabs: 0,
        skipped: [],
        closedTabCount: 0,
      };
    }

    const snapshot = await getSnapshotById(browser.storage.local, lastMerge.snapshotId);

    if (!snapshot) {
      return {
        status: "unavailable",
        reason: "snapshot_missing",
        snapshotId: lastMerge.snapshotId,
        restoredWindows: 0,
        restoredTabs: 0,
        skipped: [],
        closedTabCount: 0,
      };
    }

    const restored = await restoreSnapshotInternal(snapshot.id);
    const currentWindows = await browser.windows.getAll({
      populate: true,
      windowTypes: ["normal"],
    });
    const targetWindow = currentWindows.find(
      (window) => window.id === lastMerge.targetWindowId,
    );

    if (!targetWindow) {
      await clearLastMergeState(browser.storage.local);

      return {
        status: "restored_only",
        reason: "target_missing",
        snapshotId: snapshot.id,
        restoredWindows: restored.restoredWindows,
        restoredTabs: restored.restoredTabs,
        skipped: restored.skipped,
        closedTabCount: 0,
      };
    }

    const currentTargetTabIds = new Set(
      (targetWindow.tabs ?? [])
        .map((tab) => tab.id)
        .filter((tabId): tabId is number => typeof tabId === "number"),
    );
    const canRemoveMergedTabs = lastMerge.mergedTabIds.every((tabId) =>
      currentTargetTabIds.has(tabId),
    );

    if (!canRemoveMergedTabs) {
      return {
        status: "restored_only",
        reason: "window_changed",
        snapshotId: snapshot.id,
        restoredWindows: restored.restoredWindows,
        restoredTabs: restored.restoredTabs,
        skipped: restored.skipped,
        closedTabCount: 0,
      };
    }

    await browser.tabs.remove(lastMerge.mergedTabIds);
    await clearLastMergeState(browser.storage.local);

    return {
      status: "undone",
      snapshotId: snapshot.id,
      restoredWindows: restored.restoredWindows,
      restoredTabs: restored.restoredTabs,
      skipped: restored.skipped,
      closedTabCount: lastMerge.mergedTabIds.length,
    };
  }

  async function importSnapshotsAction(
    snapshots: SessionSnapshot[],
  ): Promise<ImportSnapshotsResult> {
    const imported = await importSnapshots(browser.storage.local, snapshots);

    return {
      importedCount: imported.importedCount,
      skippedCount: imported.skippedCount,
      totalSnapshots: imported.snapshots.length,
    };
  }

  async function handleMessage(
    message: ExtensionMessage,
  ): Promise<ExtensionResponse> {
    try {
      switch (message.type) {
        case "MERGE_ALL_WINDOWS":
          return ok({
            ok: true,
            type: "MERGE_ALL_WINDOWS_RESULT",
            data: await mergeAllWindows(),
          });
        case "CREATE_MANUAL_GROUP":
          return ok({
            ok: true,
            type: "CREATE_MANUAL_GROUP_RESULT",
            data: await createManualGroup(message.payload),
          });
        case "AUTO_GROUP_BY_DOMAIN":
          return ok({
            ok: true,
            type: "AUTO_GROUP_BY_DOMAIN_RESULT",
            data: await autoGroupByDomain(message.payload),
          });
        case "FIND_DUPLICATE_TABS":
          return ok({
            ok: true,
            type: "FIND_DUPLICATE_TABS_RESULT",
            data: await findDuplicateTabs(),
          });
        case "CLOSE_DUPLICATE_TABS":
          return ok({
            ok: true,
            type: "CLOSE_DUPLICATE_TABS_RESULT",
            data: await closeDuplicateTabs(),
          });
        case "LIST_SNAPSHOTS":
          return ok({
            ok: true,
            type: "LIST_SNAPSHOTS_RESULT",
            data: await listSnapshotsAction(),
          });
        case "RESTORE_SNAPSHOT":
          return ok({
            ok: true,
            type: "RESTORE_SNAPSHOT_RESULT",
            data: await restoreSnapshot(message.payload.snapshotId),
          });
        case "DELETE_SNAPSHOT":
          return ok({
            ok: true,
            type: "DELETE_SNAPSHOT_RESULT",
            data: await deleteSnapshotAction(message.payload.snapshotId),
          });
        case "UNDO_LAST_MERGE":
          return ok({
            ok: true,
            type: "UNDO_LAST_MERGE_RESULT",
            data: await undoLastMerge(),
          });
        case "IMPORT_SNAPSHOTS":
          return ok({
            ok: true,
            type: "IMPORT_SNAPSHOTS_RESULT",
            data: await importSnapshotsAction(message.payload.snapshots),
          });
        default:
          throw new Error("Mensaje no soportado.");
      }
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    initialize,
    pruneSnapshots,
    mergeAllWindows,
    createManualGroup,
    autoGroupByDomain,
    findDuplicateTabs,
    closeDuplicateTabs,
    listSnapshots: listSnapshotsAction,
    restoreSnapshot,
    deleteSnapshot: deleteSnapshotAction,
    undoLastMerge,
    importSnapshots: importSnapshotsAction,
    handleMessage,
  };
}
