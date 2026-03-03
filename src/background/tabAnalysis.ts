import { TAB_GROUP_COLORS } from "@/shared/constants";
import type {
  DuplicateTabCluster,
  DuplicateTabItem,
} from "@/shared/types";
import { getDisplayUrl, isRestorableUrl } from "@/shared/url";

function getTabUrl(tab: chrome.tabs.Tab): string | null {
  return tab.pendingUrl ?? tab.url ?? null;
}

export function getTabDomain(tab: chrome.tabs.Tab): string | null {
  const url = getTabUrl(tab);

  if (!isRestorableUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url ?? "");
    return parsed.host || null;
  } catch {
    return null;
  }
}

export function normalizeUrlForDuplicates(url: string | null): string | null {
  if (!isRestorableUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url ?? "");
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function buildDuplicateClusters(
  windows: chrome.windows.Window[],
): DuplicateTabCluster[] {
  const groupedTabs = new Map<string, DuplicateTabItem[]>();

  for (const window of windows) {
    const windowId = window.id;

    if (typeof windowId !== "number") {
      continue;
    }

    for (const tab of window.tabs ?? []) {
      const url = getTabUrl(tab);
      const normalizedUrl = normalizeUrlForDuplicates(url);
      const tabId = tab.id;

      if (!normalizedUrl || typeof tabId !== "number") {
        continue;
      }

      const currentTabs = groupedTabs.get(normalizedUrl) ?? [];
      currentTabs.push({
        tabId,
        windowId,
        title: tab.title ?? url ?? "Tab sin título",
        url: url ?? "",
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        index: tab.index ?? 0,
      });
      groupedTabs.set(normalizedUrl, currentTabs);
    }
  }

  return [...groupedTabs.entries()]
    .map(([normalizedUrl, tabs]) => {
      const sortedTabs = [...tabs].sort((left, right) => {
        if (left.pinned !== right.pinned) {
          return left.pinned ? -1 : 1;
        }

        if (left.active !== right.active) {
          return left.active ? -1 : 1;
        }

        if (left.windowId !== right.windowId) {
          return left.windowId - right.windowId;
        }

        return left.index - right.index;
      });

      return {
        normalizedUrl,
        displayUrl: getDisplayUrl(sortedTabs[0]?.url),
        tabCount: sortedTabs.length,
        duplicateTabIds: sortedTabs.slice(1).map((tab) => tab.tabId),
        tabs: sortedTabs,
      };
    })
    .filter((cluster) => cluster.tabCount > 1)
    .sort((left, right) => right.tabCount - left.tabCount);
}

export function getColorForGroup(index: number): chrome.tabGroups.ColorEnum {
  return TAB_GROUP_COLORS[index % TAB_GROUP_COLORS.length];
}
