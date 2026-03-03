const BLOCKED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "devtools:",
  "edge:",
]);

export function isRestorableUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  if (url === "about:blank") {
    return true;
  }

  if (url.startsWith("about:srcdoc")) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return !BLOCKED_PROTOCOLS.has(parsed.protocol);
  } catch {
    return !/^chrome:\/\/|^chrome-extension:\/\/|^devtools:\/\/|^edge:\/\//.test(url);
  }
}

export function getDisplayUrl(url: string | null | undefined): string {
  if (!url) {
    return "Sin URL";
  }

  if (url === "about:blank") {
    return url;
  }

  try {
    const parsed = new URL(url);
    return parsed.host || parsed.protocol.replace(":", "");
  } catch {
    return url;
  }
}
