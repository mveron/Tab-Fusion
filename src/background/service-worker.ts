import { RETENTION_ALARM_NAME } from "@/shared/constants";
import { createBackgroundController } from "@/background/controller";
import type { ExtensionMessage } from "@/shared/types";
import type { ExtensionBrowser } from "@/background/browser";

const browser = chrome as unknown as ExtensionBrowser;
const controller = createBackgroundController(browser);

void controller.initialize();

chrome.runtime.onInstalled.addListener(() => {
  void controller.initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void controller.initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETENTION_ALARM_NAME) {
    void controller.pruneSnapshots();
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "consolidate-all-tabs") {
    void controller.mergeAllWindows();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void controller
    .handleMessage(message as ExtensionMessage)
    .then((response) => sendResponse(response))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Error inesperado.",
      }),
    );

  return true;
});
