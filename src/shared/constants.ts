export const APP_NAME = "Tab Fusion";
export const SNAPSHOTS_STORAGE_KEY = "tab-fusion.snapshots";
export const LAST_MERGE_STORAGE_KEY = "tab-fusion.last-merge";
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_SNAPSHOT_COUNT = 50;
export const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RETENTION_ALARM_NAME = "tab-fusion.snapshot-retention";
export const RETENTION_ALARM_PERIOD_MINUTES = 12 * 60;

export const TAB_GROUP_COLORS: chrome.tabGroups.ColorEnum[] = [
  "blue",
  "cyan",
  "green",
  "grey",
  "orange",
  "pink",
  "purple",
  "red",
  "yellow",
];
