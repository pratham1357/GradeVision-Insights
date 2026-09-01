import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("produces an Argon2id hash that is not the plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse battery staple");
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("s3cret-password");
    await expect(verifyPassword("s3cret-password", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("s3cret-password");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("returns false (does not throw) for a malformed/legacy hash", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
  });
});
