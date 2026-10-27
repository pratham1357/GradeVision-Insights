import { describe, expect, it } from "vitest";

import { resolveApiOrigin } from "./api-origin";

describe("resolveApiOrigin", () => {
  it("uses the configured origin, without a trailing slash", () => {
    expect(resolveApiOrigin("https://api.example.edu/", false)).toBe("https://api.example.edu");
    expect(resolveApiOrigin(" https://api.example.edu ", true)).toBe("https://api.example.edu");
  });

  it("falls back to the local API only in development", () => {
    expect(resolveApiOrigin(undefined, true)).toBe("http://localhost:4000");
    expect(resolveApiOrigin("", true)).toBe("http://localhost:4000");
  });

  it("never points a production build at localhost when nothing is configured", () => {
    expect(resolveApiOrigin(undefined, false)).toBeNull();
    expect(resolveApiOrigin("   ", false)).toBeNull();
  });
});
