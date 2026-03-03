import type { ExtensionMessage, ExtensionResponse } from "@/shared/types";

export async function sendExtensionMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse;

  if (!response) {
    throw new Error("La extensión no respondió.");
  }

  return response;
}
