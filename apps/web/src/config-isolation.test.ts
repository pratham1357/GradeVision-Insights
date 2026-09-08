/**
 * Guardrails: the Gemini / LLM API key must never be reachable from the browser
 * bundle, and no real secret is committed. These are source-level checks.
 *
 * Architecture note: `GEMINI_API_KEY` is intentionally shared by the two
 * BACKEND services that talk to Google - `services/hint-engine` (AI hints) and
 * `services/evaluator` (the temporary Gemini execution fallback) - through the
 * backend-only root `.env`. It must stay completely out of `apps/web` and every
 * `VITE_*` client variable.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_SRC = HERE;
const WEB_ROOT = join(HERE, "..");
const REPO_ROOT = join(HERE, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Every committed web file that can reach the browser bundle (source + config +
 * env), excluding build output and test files (tests never ship).
 */
function walkAll(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkAll(full, out);
    else if (!/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
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

  it("GEMINI_API_KEY is declared only in the two backend services, never the API", () => {
    const hintEnv = readFileSync(
      join(REPO_ROOT, "services", "hint-engine", "src", "env.ts"),
      "utf8",
    );
    const evaluatorEnv = readFileSync(
      join(REPO_ROOT, "services", "evaluator", "src", "env.ts"),
      "utf8",
    );
    // Intentionally shared by both backend services via the root .env.
    expect(hintEnv).toContain("GEMINI_API_KEY");
    expect(evaluatorEnv).toContain("GEMINI_API_KEY");
    // Never in the API's env schema.
    const apiEnv = readFileSync(join(REPO_ROOT, "apps", "api", "src", "env.ts"), "utf8");
    expect(apiEnv).not.toContain("GEMINI");
  });

  it("the evaluator's Gemini fallback config is backend-only - no web source or config consumes it", () => {
    // The evaluator reads the key only in its own env module, server-side.
    const evaluatorEnv = readFileSync(
      join(REPO_ROOT, "services", "evaluator", "src", "env.ts"),
      "utf8",
    );
    expect(evaluatorEnv).toContain("GEMINI_EXECUTION_FALLBACK_ENABLED");
    expect(evaluatorEnv).toMatch(/process\.env/);

    // No file anywhere under apps/web (source, vite/vitest config, tsconfig,
    // index.html, any committed .env) references the Gemini/LLM key or a
    // Gemini-flavoured VITE_ variable.
    const offenders = walkAll(WEB_ROOT).filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /GEMINI|GOOGLE_API_KEY|x-goog-api-key|LLM_API_KEY|generativelanguage/i.test(src) ||
        /VITE_[A-Z0-9_]*(GEMINI|LLM|AI_KEY|API_KEY)/i.test(src)
      );
    });
    expect(offenders).toEqual([]);

    // apps/web declares no dependency on the evaluator or grading packages.
    const webPkg = readFileSync(join(WEB_ROOT, "package.json"), "utf8");
    expect(webPkg).not.toContain("@gradevision/evaluator");
    expect(webPkg).not.toContain("@gradevision/grading");
  });
});
