import type { StorageAreaLike } from "@/storage/snapshotStore";

export interface ExtensionBrowser {
  windows: {
    getAll(getInfo: chrome.windows.QueryOptions): Promise<chrome.windows.Window[]>;
    create(createData?: chrome.windows.CreateData): Promise<chrome.windows.Window>;
    remove(windowId: number): Promise<void>;
    update(
      windowId: number,
      updateInfo: chrome.windows.UpdateInfo,
    ): Promise<chrome.windows.Window>;
  };
  tabs: {
    query(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]>;
    move(
      tabIds: number | number[],
      moveProperties: chrome.tabs.MoveProperties,
    ): Promise<chrome.tabs.Tab | chrome.tabs.Tab[]>;
    group(options: chrome.tabs.GroupOptions): Promise<number>;
    create(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
    update(
      tabId: number,
      updateProperties: chrome.tabs.UpdateProperties,
    ): Promise<chrome.tabs.Tab>;
    remove(tabIds: number | number[]): Promise<void>;
  };
  tabGroups: {
    query(queryInfo: chrome.tabGroups.QueryInfo): Promise<chrome.tabGroups.TabGroup[]>;
    update(
      groupId: number,
      updateProperties: chrome.tabGroups.UpdateProperties,
    ): Promise<chrome.tabGroups.TabGroup>;
  };
  storage: {
    local: StorageAreaLike;
  };
  alarms: {
    create(name: string, alarmInfo?: chrome.alarms.AlarmCreateInfo): void;
  };
}
