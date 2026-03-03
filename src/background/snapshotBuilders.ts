import { SNAPSHOT_SCHEMA_VERSION } from "@/shared/constants";
import type {
  GroupSnapshot,
  SessionSnapshot,
  TabSnapshot,
  WindowSnapshot,
} from "@/shared/types";

export function buildGroupKey(windowId: number, groupId: number): string {
  return `${windowId}:${groupId}`;
}

export function sortTabsByIndex(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return [...tabs].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
}

export function buildWindowSnapshot(
  window: chrome.windows.Window,
  groups: chrome.tabGroups.TabGroup[],
): WindowSnapshot {
  const windowId = window.id ?? -1;
  const tabs = sortTabsByIndex(window.tabs ?? []);

  const tabSnapshots: TabSnapshot[] = tabs.map((tab) => ({
    url: tab.url ?? null,
    title: tab.title ?? tab.pendingUrl ?? "Tab sin título",
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    index: tab.index ?? 0,
    originalGroupKey:
      typeof tab.groupId === "number" && tab.groupId >= 0
        ? buildGroupKey(windowId, tab.groupId)
        : null,
    favIconUrl: tab.favIconUrl,
  }));

  const groupSnapshots: GroupSnapshot[] = groups
    .map((group) => {
      const key = buildGroupKey(windowId, group.id);
      const tabIndexes = tabSnapshots
        .filter((tab) => tab.originalGroupKey === key)
        .map((tab) => tab.index)
        .sort((left, right) => left - right);

      return {
        key,
        title: group.title ?? "",
        color: group.color,
        collapsed: Boolean(group.collapsed),
        tabIndexes,
      };
    })
    .filter((group) => group.tabIndexes.length > 0)
    .sort((left, right) => left.tabIndexes[0] - right.tabIndexes[0]);

  return {
    originalWindowId: windowId,
    focused: Boolean(window.focused),
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height,
    state: window.state,
    tabs: tabSnapshots,
    groups: groupSnapshots,
  };
}

export function buildSessionSnapshot(
  windows: chrome.windows.Window[],
  groupsByWindowId: Map<number, chrome.tabGroups.TabGroup[]>,
  targetWindowId: number,
): SessionSnapshot {
  const windowSnapshots = windows.map((window) =>
    buildWindowSnapshot(window, groupsByWindowId.get(window.id ?? -1) ?? []),
  );

  return {
    id: crypto.randomUUID(),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    action: "merge_all_windows",
    targetWindowId,
    windowCount: windowSnapshots.length,
    tabCount: windowSnapshots.reduce((total, window) => total + window.tabs.length, 0),
    windows: windowSnapshots,
    skippedOnRestore: [],
  };
}
