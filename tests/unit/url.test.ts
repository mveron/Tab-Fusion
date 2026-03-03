import { getDisplayUrl, isRestorableUrl } from "@/shared/url";

describe("url helpers", () => {
  it("accepts standard web urls and about:blank", () => {
    expect(isRestorableUrl("https://openai.com")).toBe(true);
    expect(isRestorableUrl("about:blank")).toBe(true);
  });

  it("blocks browser internal urls", () => {
    expect(isRestorableUrl("chrome://settings")).toBe(false);
    expect(isRestorableUrl("chrome-extension://abcdef/page.html")).toBe(false);
    expect(isRestorableUrl(null)).toBe(false);
  });

  it("formats display urls for the UI", () => {
    expect(getDisplayUrl("https://docs.example.com/page")).toBe("docs.example.com");
    expect(getDisplayUrl(null)).toBe("Sin URL");
  });
});
