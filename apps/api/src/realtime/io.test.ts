import { describe, expect, it } from "vitest";

import { signAccessToken } from "../modules/auth/jwt.js";
import { assessmentRoom, authenticateSocket, sessionRoom } from "./io.js";

describe("authenticateSocket", () => {
  it("accepts a valid access token and returns the identity", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "STUDENT" });
    const auth = await authenticateSocket(token);
    expect(auth).toEqual({ userId: "user-1", role: "STUDENT" });
  });

  it("rejects a missing / non-string token", async () => {
    expect(await authenticateSocket(undefined)).toBeNull();
    expect(await authenticateSocket("")).toBeNull();
    expect(await authenticateSocket(123)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "INSTRUCTOR" });
    expect(await authenticateSocket(token + "x")).toBeNull();
  });
});

describe("room names", () => {
  it("namespaces rooms by kind", () => {
    expect(sessionRoom("abc")).toBe("session:abc");
    expect(assessmentRoom("abc")).toBe("assessment:abc");
  });
});
