import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Worker } from "@playwright/test";

interface LoadedExtension {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  cleanup(): Promise<void>;
}

const extensionPath = resolve(process.cwd(), "dist");

async function launchExtension(): Promise<LoadedExtension> {
  const userDataDir = await mkdtemp(resolve(tmpdir(), "tab-fusion-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let worker = context.serviceWorkers()[0];

  if (!worker) {
    worker = await context.waitForEvent("serviceworker");
  }

  const extensionId = worker.url().split("/")[2];

  return {
    context,
    extensionId,
    worker,
    async cleanup() {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

async function resetBrowserState(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    const normalWindows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ["normal"],
    });

    await Promise.all(
      normalWindows
        .map((window) => window.id)
        .filter((windowId): windowId is number => typeof windowId === "number")
        .map((windowId) => chrome.windows.remove(windowId)),
    );
  });
}

async function openExtensionPage(
  context: BrowserContext,
  worker: Worker,
  extensionPathname: "popup.html" | "dashboard.html",
): Promise<import("@playwright/test").Page> {
  const targetUrl = await worker.evaluate(async (pathname) => {
    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ["normal"],
    });
    const focusedWindow = windows.find((window) => window.focused) ?? windows[0];

    const targetWindow = focusedWindow?.id
      ? focusedWindow
      : await chrome.windows.create({ url: "about:blank" });

    if (!targetWindow.id) {
      throw new Error("No se pudo resolver una ventana para abrir la UI.");
    }

    await chrome.tabs.create({
      windowId: targetWindow.id,
      url: chrome.runtime.getURL(pathname),
      active: true,
    });
    return chrome.runtime.getURL(pathname);
  }, extensionPathname);

  const timeoutAt = Date.now() + 10_000;

  while (Date.now() < timeoutAt) {
    const page = context.pages().find((candidate) => candidate.url() === targetUrl);

    if (page) {
      await page.waitForLoadState("domcontentloaded");
      return page;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`No se abrió la página de extensión ${extensionPathname}.`);
}

function buildDataUrl(title: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`,
  )}`;
}

test.describe("Tab Fusion extension", () => {
  let loaded: LoadedExtension | null = null;

  test.afterEach(async () => {
    if (loaded) {
      await loaded.cleanup();
      loaded = null;
    }
  });

  test("merges windows from the popup and shows the snapshot in the dashboard", async () => {
    loaded = await launchExtension();
    await resetBrowserState(loaded.worker);

    await loaded.worker.evaluate(
      async ({ alphaUrl, betaUrl, gammaUrl }) => {
        const firstWindow = await chrome.windows.create({ url: alphaUrl });

        if (!firstWindow.id) {
          throw new Error("No se pudo crear la primera ventana.");
        }

        await chrome.tabs.create({
          windowId: firstWindow.id,
          url: gammaUrl,
          active: false,
        });

        await chrome.windows.create({ url: betaUrl });
      },
      {
        alphaUrl: buildDataUrl("Alpha"),
        betaUrl: buildDataUrl("Beta"),
        gammaUrl: buildDataUrl("Gamma"),
      },
    );

    const popupPage = await openExtensionPage(loaded.context, loaded.worker, "popup.html");

    await expect(popupPage.getByTestId("popup-root")).toBeVisible();
    await popupPage.getByTestId("merge-all-button").click();
    await expect(popupPage.getByText(/Se consolidaron/i)).toBeVisible();

    const mergedWindowCount = await loaded.worker.evaluate(async () => {
      const windows = await chrome.windows.getAll({
        populate: true,
        windowTypes: ["normal"],
      });
      return windows.length;
    });

    expect(mergedWindowCount).toBe(1);

    const dashboardPage = await openExtensionPage(
      loaded.context,
      loaded.worker,
      "dashboard.html",
    );
    await expect(dashboardPage.getByTestId("snapshot-card")).toHaveCount(1);
    await expect(dashboardPage.getByTestId("dashboard-search")).toBeVisible();
  });

  test("creates a manual tab group from the popup", async () => {
    loaded = await launchExtension();
    await resetBrowserState(loaded.worker);

    await loaded.worker.evaluate(
      async ({ alphaUrl, betaUrl }) => {
        const window = await chrome.windows.create({ url: alphaUrl });

        if (!window.id) {
          throw new Error("No se pudo crear la ventana base.");
        }

        await chrome.tabs.create({
          windowId: window.id,
          url: betaUrl,
          active: false,
        });

        await chrome.windows.update(window.id, { focused: true });
      },
      {
        alphaUrl: buildDataUrl("Trabajo Alpha"),
        betaUrl: buildDataUrl("Trabajo Beta"),
      },
    );

    const popupPage = await openExtensionPage(loaded.context, loaded.worker, "popup.html");

    await popupPage.getByTestId("group-title-input").fill("Sprint actual");
    await popupPage.locator('.tab-item input[type="checkbox"]').nth(0).setChecked(true);
    await popupPage.locator('.tab-item input[type="checkbox"]').nth(1).setChecked(true);

    await popupPage.getByTestId("create-group-button").click();
    await expect(popupPage.getByText(/Grupo "Sprint actual" creado/i)).toBeVisible();

    const groups = await loaded.worker.evaluate(async () => {
      const groups = await chrome.tabGroups.query({});
      return groups.map((group) => ({
        title: group.title,
        color: group.color,
      }));
    });

    expect(groups).toEqual([
      {
        title: "Sprint actual",
        color: "blue",
      },
    ]);
  });

  test("groups by domain and closes duplicates from the automation actions", async () => {
    loaded = await launchExtension();
    await resetBrowserState(loaded.worker);

    await loaded.worker.evaluate(async () => {
      const window = await chrome.windows.create({ url: "https://example.com/a" });

      if (!window.id) {
        throw new Error("No se pudo crear la ventana base.");
      }

      await chrome.tabs.create({
        windowId: window.id,
        url: "https://example.com/b",
        active: false,
      });
      await chrome.tabs.create({
        windowId: window.id,
        url: "https://dup.example.com/item",
        active: false,
      });
      await chrome.tabs.create({
        windowId: window.id,
        url: "https://dup.example.com/item#hash",
        active: false,
      });

      await chrome.windows.update(window.id, { focused: true });
    });

    const popupPage = await openExtensionPage(loaded.context, loaded.worker, "popup.html");

    await popupPage.getByTestId("group-by-domain-button").click();
    await expect(popupPage.getByText(/grupos automáticos/i)).toBeVisible();

    await popupPage.getByTestId("scan-duplicates-button").click();
    await expect(popupPage.getByTestId("duplicates-summary")).toContainText("tabs duplicadas");

    await popupPage.getByTestId("close-duplicates-button").click();
    await expect(popupPage.getByText(/Se cerraron 1 tabs duplicadas/i)).toBeVisible();

    const result = await loaded.worker.evaluate(async () => {
      const groups = await chrome.tabGroups.query({});
      const windows = await chrome.windows.getAll({
        populate: true,
        windowTypes: ["normal"],
      });
      const httpTabs = windows
        .flatMap((window) => window.tabs ?? [])
        .filter((tab) => (tab.url ?? "").startsWith("http"));

      return {
        groupTitles: groups.map((group) => group.title).sort(),
        httpTabCount: httpTabs.length,
      };
    });

    expect(result.groupTitles).toEqual(["dup.example.com", "example.com"]);
    expect(result.httpTabCount).toBe(3);
  });
});
