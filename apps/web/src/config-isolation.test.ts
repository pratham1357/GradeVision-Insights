/**
 * Guardrails: the Gemini / LLM API key must never be reachable from the browser
 * bundle, and no real secret is committed. These are source-level checks.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = HERE;
const REPO_ROOT = join(HERE, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("Gemini / LLM key isolation", () => {
  const webFiles = walk(WEB_SRC);

  it("no web source references a Gemini / LLM API key", () => {
    const offenders = webFiles.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /GEMINI_API_KEY|GOOGLE_API_KEY|x-goog-api-key|LLM_API_KEY/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it("web only reads the VITE_API_BASE_URL client variable", () => {
    const usedEnv = new Set<string>();
    for (const f of webFiles) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/import\.meta\.env\.(\w+)/g)) usedEnv.add(m[1]!);
    }
    // Vite built-ins are fine; only custom VITE_ vars matter here.
    const custom = [...usedEnv].filter((v) => v.startsWith("VITE_"));
    expect(custom).toEqual(["VITE_API_BASE_URL"]);
  });

  it(".env.example keeps GEMINI_API_KEY commented out (no value)", () => {
    const env = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.includes("GEMINI_API_KEY"));
    expect(line).toBeDefined();
    expect(line!.trimStart().startsWith("#")).toBe(true);
  });

  it("the Gemini key variable is only declared in the hint-engine service env", () => {
    const hintEnv = readFileSync(
      join(REPO_ROOT, "services", "hint-engine", "src", "env.ts"),
      "utf8",
    );
    expect(hintEnv).toContain("GEMINI_API_KEY");
    // Not in the API's env schema.
    const apiEnv = readFileSync(join(REPO_ROOT, "apps", "api", "src", "env.ts"), "utf8");
    expect(apiEnv).not.toContain("GEMINI");
  });
});
