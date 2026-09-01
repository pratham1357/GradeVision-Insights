import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../utils/api-error.js";
import { signAccessToken, verifyAccessToken } from "./jwt.js";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

describe("access tokens", () => {
  it("round-trips sub and role", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "INSTRUCTOR" });
    await expect(verifyAccessToken(token)).resolves.toEqual({ sub: "user-1", role: "INSTRUCTOR" });
  });

  it("rejects a tampered token with a generic 401", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "STUDENT" });
    await expect(verifyAccessToken(`${token}x`)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a token signed with a different secret", async () => {
    const foreign = await new SignJWT({ role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("a-completely-different-secret-value-1234"));
    await expect(verifyAccessToken(foreign)).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ role: "STUDENT" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);
    await expect(verifyAccessToken(expired)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token missing a role claim", async () => {
    const noRole = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime("15m")
      .sign(secret);
    await expect(verifyAccessToken(noRole)).rejects.toMatchObject({ status: 401 });
  });
});
