export type SnapshotAction = "merge_all_windows";

export interface LastMergeState {
  snapshotId: string;
  targetWindowId: number;
  mergedTabIds: number[];
  createdAt: string;
}

export interface SkippedTabRecord {
  title: string;
  url: string | null;
  reason: "non_restorable_url" | "missing_url";
}

export interface GroupSnapshot {
  key: string;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
  tabIndexes: number[];
}

export interface TabSnapshot {
  url: string | null;
  title: string;
  pinned: boolean;
  active: boolean;
  index: number;
  originalGroupKey: string | null;
  favIconUrl?: string;
}

export interface WindowSnapshot {
  originalWindowId: number;
  focused: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  state?: chrome.windows.windowStateEnum;
  tabs: TabSnapshot[];
  groups: GroupSnapshot[];
}

export interface SessionSnapshot {
  id: string;
  schemaVersion: number;
  createdAt: string;
  action: SnapshotAction;
  targetWindowId: number;
  windowCount: number;
  tabCount: number;
  windows: WindowSnapshot[];
  skippedOnRestore: SkippedTabRecord[];
}

export interface MergeAllWindowsResult {
  status: "merged" | "noop";
  reason?: "single_window";
  snapshotId?: string;
  targetWindowId?: number;
  totalWindows: number;
  windowsMerged: number;
  tabsMoved: number;
}

export interface CreateGroupRequest {
  windowId: number;
  tabIds: number[];
  title: string;
  color: chrome.tabGroups.ColorEnum;
}

export interface CreateGroupResult {
  groupId: number;
  windowId: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  tabCount: number;
}

export interface AutoGroupByDomainRequest {
  scope: "current_window" | "all_windows";
  windowId?: number;
}

export interface AutoGroupByDomainResult {
  createdGroups: number;
  groupedTabs: number;
  skippedTabs: number;
  processedWindows: number;
}

export interface DuplicateTabItem {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  index: number;
}

export interface DuplicateTabCluster {
  normalizedUrl: string;
  displayUrl: string;
  tabCount: number;
  duplicateTabIds: number[];
  tabs: DuplicateTabItem[];
}

export interface FindDuplicateTabsResult {
  clusterCount: number;
  duplicateTabCount: number;
  clusters: DuplicateTabCluster[];
}

export interface CloseDuplicateTabsResult {
  clusterCount: number;
  closedTabCount: number;
  closedTabIds: number[];
}

export interface ListSnapshotsResult {
  snapshots: SessionSnapshot[];
}

export interface RestoreSnapshotResult {
  snapshotId: string;
  restoredWindows: number;
  restoredTabs: number;
  skipped: SkippedTabRecord[];
}

export interface DeleteSnapshotResult {
  snapshotId: string;
}

export interface UndoLastMergeResult {
  status: "undone" | "restored_only" | "unavailable";
  reason?: "no_merge" | "snapshot_missing" | "window_changed" | "target_missing";
  snapshotId?: string;
  restoredWindows: number;
  restoredTabs: number;
  skipped: SkippedTabRecord[];
  closedTabCount: number;
}

export interface ImportSnapshotsResult {
  importedCount: number;
  skippedCount: number;
  totalSnapshots: number;
}

export type ExtensionMessage =
  | { type: "MERGE_ALL_WINDOWS" }
  | { type: "CREATE_MANUAL_GROUP"; payload: CreateGroupRequest }
  | { type: "AUTO_GROUP_BY_DOMAIN"; payload: AutoGroupByDomainRequest }
  | { type: "FIND_DUPLICATE_TABS" }
  | { type: "CLOSE_DUPLICATE_TABS" }
  | { type: "LIST_SNAPSHOTS" }
  | { type: "RESTORE_SNAPSHOT"; payload: { snapshotId: string } }
  | { type: "DELETE_SNAPSHOT"; payload: { snapshotId: string } }
  | { type: "UNDO_LAST_MERGE" }
  | { type: "IMPORT_SNAPSHOTS"; payload: { snapshots: SessionSnapshot[] } };

export type ExtensionSuccessResponse =
  | { ok: true; type: "MERGE_ALL_WINDOWS_RESULT"; data: MergeAllWindowsResult }
  | { ok: true; type: "CREATE_MANUAL_GROUP_RESULT"; data: CreateGroupResult }
  | { ok: true; type: "AUTO_GROUP_BY_DOMAIN_RESULT"; data: AutoGroupByDomainResult }
  | { ok: true; type: "FIND_DUPLICATE_TABS_RESULT"; data: FindDuplicateTabsResult }
  | { ok: true; type: "CLOSE_DUPLICATE_TABS_RESULT"; data: CloseDuplicateTabsResult }
  | { ok: true; type: "LIST_SNAPSHOTS_RESULT"; data: ListSnapshotsResult }
  | { ok: true; type: "RESTORE_SNAPSHOT_RESULT"; data: RestoreSnapshotResult }
  | { ok: true; type: "DELETE_SNAPSHOT_RESULT"; data: DeleteSnapshotResult }
  | { ok: true; type: "UNDO_LAST_MERGE_RESULT"; data: UndoLastMergeResult }
  | { ok: true; type: "IMPORT_SNAPSHOTS_RESULT"; data: ImportSnapshotsResult };

export interface ExtensionErrorResponse {
  ok: false;
  error: string;
}

export type ExtensionResponse = ExtensionSuccessResponse | ExtensionErrorResponse;
