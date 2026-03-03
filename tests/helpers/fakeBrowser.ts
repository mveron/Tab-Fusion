import type { ExtensionBrowser } from "@/background/browser";

interface SeedTab {
  id: number;
  title: string;
  url?: string;
  pinned?: boolean;
  active?: boolean;
  highlighted?: boolean;
  groupId?: number;
  favIconUrl?: string;
}

interface SeedWindow {
  id: number;
  focused?: boolean;
  incognito?: boolean;
  type?: chrome.windows.windowTypeEnum;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  state?: chrome.windows.windowStateEnum;
  tabs: SeedTab[];
}

interface SeedGroup {
  id: number;
  windowId: number;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
  collapsed?: boolean;
}

interface MutableTab extends SeedTab {
  windowId: number;
  index: number;
}

interface MutableWindow extends Omit<SeedWindow, "tabs"> {
  tabs: MutableTab[];
}

interface MutableGroup extends SeedGroup {
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
}

interface FakeBrowserOptions {
  windows: SeedWindow[];
  groups?: SeedGroup[];
  storage?: Record<string, unknown>;
}

function cloneTab(tab: MutableTab): chrome.tabs.Tab {
  return {
    id: tab.id,
    index: tab.index,
    windowId: tab.windowId,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    highlighted: Boolean(tab.highlighted),
    selected: Boolean(tab.highlighted),
    frozen: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    title: tab.title,
    url: tab.url,
    groupId: tab.groupId ?? -1,
    favIconUrl: tab.favIconUrl,
  };
}

function cloneWindow(window: MutableWindow, populate: boolean): chrome.windows.Window {
  return {
    id: window.id,
    focused: Boolean(window.focused),
    incognito: Boolean(window.incognito),
    alwaysOnTop: false,
    type: window.type ?? "normal",
    left: window.left,
    top: window.top,
    width: window.width,
    height: window.height,
    state: window.state ?? "normal",
    tabs: populate ? window.tabs.map(cloneTab) : undefined,
  };
}

export function createFakeBrowser(
  options: FakeBrowserOptions,
): {
  browser: ExtensionBrowser;
  getWindows(): chrome.windows.Window[];
  getGroups(): chrome.tabGroups.TabGroup[];
  getStorage(): Record<string, unknown>;
} {
  const windows = new Map<number, MutableWindow>();
  const groups = new Map<number, MutableGroup>();
  const storage = structuredClone(options.storage ?? {});
  let nextWindowId = Math.max(0, ...options.windows.map((window) => window.id)) + 1;
  let nextTabId =
    Math.max(0, ...options.windows.flatMap((window) => window.tabs.map((tab) => tab.id))) + 1;
  let nextGroupId = Math.max(0, ...(options.groups ?? []).map((group) => group.id)) + 1;

  function syncWindow(windowId: number): void {
    const window = windows.get(windowId);

    if (!window) {
      return;
    }

    window.tabs = window.tabs
      .sort((left, right) => left.index - right.index)
      .map((tab, index) => ({
        ...tab,
        index,
        windowId,
      }));

    if (!window.tabs.some((tab) => tab.active) && window.tabs[0]) {
      window.tabs[0].active = true;
    }
  }

  function removeWindowIfEmpty(windowId: number): void {
    const window = windows.get(windowId);

    if (window && window.tabs.length === 0) {
      windows.delete(windowId);
    }
  }

  function findTab(tabId: number): { window: MutableWindow; tab: MutableTab } {
    for (const window of windows.values()) {
      const tab = window.tabs.find((candidate) => candidate.id === tabId);

      if (tab) {
        return { window, tab };
      }
    }

    throw new Error(`Tab ${tabId} no encontrada en fake browser.`);
  }

  function insertTab(windowId: number, tab: MutableTab, index?: number): void {
    const window = windows.get(windowId);

    if (!window) {
      throw new Error(`Ventana ${windowId} no encontrada en fake browser.`);
    }

    const insertionIndex =
      typeof index === "number"
        ? Math.max(0, Math.min(index, window.tabs.length))
        : window.tabs.length;

    window.tabs.splice(insertionIndex, 0, {
      ...tab,
      windowId,
      index: insertionIndex,
    });

    syncWindow(windowId);
  }

function buildGroup(group: MutableGroup): chrome.tabGroups.TabGroup {
  return {
    id: group.id,
    windowId: group.windowId,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
  };
}

  for (const window of options.windows) {
    windows.set(window.id, {
      ...window,
      type: window.type ?? "normal",
      focused: Boolean(window.focused),
      incognito: Boolean(window.incognito),
      state: window.state ?? "normal",
      tabs: window.tabs.map((tab, index) => ({
        ...tab,
        windowId: window.id,
        index,
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        highlighted: Boolean(tab.highlighted),
        groupId: tab.groupId ?? -1,
      })),
    });
    syncWindow(window.id);
  }

  for (const group of options.groups ?? []) {
    groups.set(group.id, {
      ...group,
      title: group.title ?? "",
      color: group.color ?? "blue",
      collapsed: Boolean(group.collapsed),
    });
  }

  const browser: ExtensionBrowser = {
    windows: {
      async getAll(queryInfo) {
        return [...windows.values()]
          .filter((window) =>
            queryInfo.windowTypes?.length
              ? queryInfo.windowTypes.includes(window.type ?? "normal")
              : true,
          )
          .map((window) => cloneWindow(window, Boolean(queryInfo.populate)));
      },
      async create(createData = {}) {
        const id = nextWindowId;
        nextWindowId += 1;
        const urls = Array.isArray(createData.url)
          ? createData.url
          : [createData.url ?? "about:blank"];
        const nextWindow: MutableWindow = {
          id,
          focused: Boolean(createData.focused),
          incognito: Boolean(createData.incognito),
          type: createData.type ?? "normal",
          left: createData.left,
          top: createData.top,
          width: createData.width,
          height: createData.height,
          state: createData.state ?? "normal",
          tabs: [],
        };

        windows.set(id, nextWindow);

        urls.forEach((url, index) => {
          nextWindow.tabs.push({
            id: nextTabId++,
            title: url,
            url,
            pinned: false,
            active: index === 0,
            highlighted: index === 0,
            groupId: -1,
            windowId: id,
            index,
          });
        });

        syncWindow(id);
        return cloneWindow(nextWindow, true);
      },
      async remove(windowId) {
        windows.delete(windowId);
      },
      async update(windowId, updateInfo) {
        const window = windows.get(windowId);

        if (!window) {
          throw new Error(`Ventana ${windowId} no encontrada.`);
        }

        if (typeof updateInfo.left === "number") {
          window.left = updateInfo.left;
        }

        if (typeof updateInfo.top === "number") {
          window.top = updateInfo.top;
        }

        if (typeof updateInfo.width === "number") {
          window.width = updateInfo.width;
        }

        if (typeof updateInfo.height === "number") {
          window.height = updateInfo.height;
        }

        if (updateInfo.state) {
          window.state = updateInfo.state;
        }

        if (typeof updateInfo.focused === "boolean") {
          for (const candidate of windows.values()) {
            candidate.focused = false;
          }

          window.focused = updateInfo.focused;
        }

        return cloneWindow(window, true);
      },
    },
    tabs: {
      async query(queryInfo) {
        let candidates = [...windows.values()];

        if (typeof queryInfo.windowId === "number") {
          const current = windows.get(queryInfo.windowId);
          candidates = current ? [current] : [];
        }

        if (queryInfo.currentWindow) {
          const focusedWindow = [...windows.values()].find((window) => window.focused);
          candidates = focusedWindow ? [focusedWindow] : [];
        }

        return candidates.flatMap((window) => window.tabs.map(cloneTab));
      },
      async move(tabIds, moveProperties) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        const movedTabs: chrome.tabs.Tab[] = [];
        let offset = 0;

        for (const tabId of ids) {
          const { window: currentWindow, tab } = findTab(tabId);
          const targetWindowId = moveProperties.windowId ?? currentWindow.id;
          currentWindow.tabs = currentWindow.tabs.filter((candidate) => candidate.id !== tabId);
          syncWindow(currentWindow.id);
          removeWindowIfEmpty(currentWindow.id);

          const movedTab: MutableTab = {
            ...tab,
            windowId: targetWindowId,
            groupId:
              targetWindowId !== currentWindow.id && typeof tab.groupId === "number"
                ? -1
                : tab.groupId,
            active: false,
            highlighted: false,
            index: 0,
          };
          insertTab(targetWindowId, movedTab, (moveProperties.index ?? 0) + offset);
          movedTabs.push(cloneTab(findTab(tabId).tab));
          offset += 1;
        }

        return Array.isArray(tabIds) ? movedTabs : movedTabs[0];
      },
      async group(options) {
        const tabIds = (Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds]).filter(
          (tabId): tabId is number => typeof tabId === "number",
        );

        if (tabIds.length === 0) {
          throw new Error("No hay tabs para agrupar.");
        }

        const windowId =
          options.createProperties?.windowId ?? findTab(tabIds[0]).window.id;
        const groupId = nextGroupId++;
        groups.set(groupId, {
          id: groupId,
          windowId,
          title: "",
          color: "blue",
          collapsed: false,
        });

        for (const tabId of tabIds) {
          const { tab } = findTab(tabId);
          tab.groupId = groupId;
        }

        return groupId;
      },
      async create(createProperties) {
        if (typeof createProperties.windowId !== "number") {
          throw new Error("windowId es obligatorio en fake browser.");
        }

        const tab: MutableTab = {
          id: nextTabId++,
          title: createProperties.url ?? "about:blank",
          url: createProperties.url ?? "about:blank",
          pinned: Boolean(createProperties.pinned),
          active: Boolean(createProperties.active),
          highlighted: Boolean(createProperties.active),
          groupId: -1,
          windowId: createProperties.windowId,
          index: 0,
        };

        if (createProperties.active) {
          const window = windows.get(createProperties.windowId);

          if (window) {
            for (const current of window.tabs) {
              current.active = false;
              current.highlighted = false;
            }
          }
        }

        insertTab(createProperties.windowId, tab, createProperties.index);
        return cloneTab(findTab(tab.id).tab);
      },
      async update(tabId, updateProperties) {
        const { window, tab } = findTab(tabId);

        if (typeof updateProperties.pinned === "boolean") {
          tab.pinned = updateProperties.pinned;
        }

        if (typeof updateProperties.active === "boolean") {
          for (const candidate of window.tabs) {
            candidate.active = false;
            candidate.highlighted = false;
          }

          tab.active = updateProperties.active;
          tab.highlighted = updateProperties.active;
        }

        return cloneTab(tab);
      },
      async remove(tabIds) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];

        for (const tabId of ids) {
          const { window } = findTab(tabId);
          window.tabs = window.tabs.filter((tab) => tab.id !== tabId);
          syncWindow(window.id);
          removeWindowIfEmpty(window.id);
        }
      },
    },
    tabGroups: {
      async query(queryInfo) {
        return [...groups.values()]
          .filter((group) =>
            typeof queryInfo.windowId === "number"
              ? group.windowId === queryInfo.windowId
              : true,
          )
          .filter((group) =>
            [...windows.values()].some((window) =>
              window.tabs.some((tab) => tab.groupId === group.id),
            ),
          )
          .map(buildGroup);
      },
      async update(groupId, updateProperties) {
        const group = groups.get(groupId);

        if (!group) {
          throw new Error(`Grupo ${groupId} no encontrado.`);
        }

        if (typeof updateProperties.title === "string") {
          group.title = updateProperties.title;
        }

        if (updateProperties.color) {
          group.color = updateProperties.color;
        }

        if (typeof updateProperties.collapsed === "boolean") {
          group.collapsed = updateProperties.collapsed;
        }

        return buildGroup(group);
      },
    },
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === "string") {
            return { [keys]: storage[keys] };
          }

          if (Array.isArray(keys)) {
            return keys.reduce<Record<string, unknown>>((result, key) => {
              result[key] = storage[key];
              return result;
            }, {});
          }

          if (keys && typeof keys === "object") {
            return Object.keys(keys).reduce<Record<string, unknown>>((result, key) => {
              result[key] = storage[key] ?? keys[key];
              return result;
            }, {});
          }

          return structuredClone(storage);
        },
        async set(items) {
          Object.assign(storage, structuredClone(items));
        },
      },
    },
    alarms: {
      create() {
        return undefined;
      },
    },
  };

  return {
    browser,
    getWindows() {
      return [...windows.values()].map((window) => cloneWindow(window, true));
    },
    getGroups() {
      return [...groups.values()].map(buildGroup);
    },
    getStorage() {
      return structuredClone(storage);
    },
  };
}
