import { describe, expect, it } from "vitest";

import { afterLoginPath, homeFor } from "./auth-redirect";

describe("afterLoginPath", () => {
  it("returns a remembered page in the signed-in role's own area", () => {
    expect(afterLoginPath("/student/exam/abc", "STUDENT")).toBe("/student/exam/abc");
    expect(afterLoginPath("/assessments/x/results", "INSTRUCTOR")).toBe("/assessments/x/results");
  });

  it("never sends one role to another role's page", () => {
    expect(afterLoginPath("/assessments/x/results", "STUDENT")).toBe("/student");
    expect(afterLoginPath("/student/exam/abc", "INSTRUCTOR")).toBe("/dashboard");
    expect(afterLoginPath("/dashboard", "ADMIN")).toBe("/admin");
  });

  it("falls back to the role's home", () => {
    expect(afterLoginPath(undefined, "STUDENT")).toBe("/student");
    expect(afterLoginPath("/", "INSTRUCTOR")).toBe("/dashboard");
    expect(afterLoginPath("/login", "ADMIN")).toBe(homeFor("ADMIN"));
  });
});
