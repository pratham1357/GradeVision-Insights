import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { assessmentRoom, authenticateSocket, sessionRoom } from "./io.js";

// A valid session is covered end-to-end in io.integration.test.ts.
describe("authenticateSocket", () => {
  it("rejects a missing / non-string token and an absent cookie", async () => {
    expect(await authenticateSocket(undefined)).toBeNull();
    expect(await authenticateSocket("")).toBeNull();
    expect(await authenticateSocket(123)).toBeNull();
    expect(await authenticateSocket(undefined, "other=1; theme=dark")).toBeNull();
  });

  it("rejects an unknown or malformed session token", async () => {
    expect(await authenticateSocket(randomBytes(32).toString("base64url"))).toBeNull();
    expect(await authenticateSocket("short")).toBeNull();
    expect(await authenticateSocket("x".repeat(500))).toBeNull();
  });
});

describe("room names", () => {
  it("namespaces rooms by kind", () => {
    expect(sessionRoom("abc")).toBe("session:abc");
    expect(assessmentRoom("abc")).toBe("assessment:abc");
  });
});
