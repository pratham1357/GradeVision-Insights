/**
 * Provider-selection tests for `createExecutionProvider`. Each case re-imports
 * the env + selector modules under a stubbed environment.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function selectProvider() {
  vi.resetModules();
  const mod = await import("./index.js");
  return mod.createExecutionProvider();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("createExecutionProvider", () => {
  it("selects Judge0 whenever JUDGE0_URL is configured, even with the fallback enabled", async () => {
    vi.stubEnv("JUDGE0_URL", "http://localhost:2358");
    vi.stubEnv("GEMINI_EXECUTION_FALLBACK_ENABLED", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const provider = await selectProvider();
    expect(provider.name).toBe("judge0");
    expect(provider.isConfigured()).toBe(true);
  });

  it("selects the temporary Gemini provider when Judge0 is absent and the fallback is enabled", async () => {
    vi.stubEnv("JUDGE0_URL", "");
    vi.stubEnv("LOCAL_EXECUTION_ENABLED", "");
    vi.stubEnv("GEMINI_EXECUTION_FALLBACK_ENABLED", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const provider = await selectProvider();
    expect(provider.name).toBe("gemini-execution");
    expect(provider.isConfigured()).toBe(true);
  });

  it("never selects local execution unless LOCAL_EXECUTION_ENABLED is explicitly on", async () => {
    vi.stubEnv("JUDGE0_URL", "");
    vi.stubEnv("LOCAL_EXECUTION_ENABLED", "");
    vi.stubEnv("PYTHON_BIN", "python3");
    vi.stubEnv("GEMINI_EXECUTION_FALLBACK_ENABLED", "");

    const provider = await selectProvider();
    expect(provider.name).toBe("unconfigured");
  });

  it("selects local execution over the Gemini fallback when both are enabled", async () => {
    vi.stubEnv("JUDGE0_URL", "");
    vi.stubEnv("LOCAL_EXECUTION_ENABLED", "true");
    vi.stubEnv("PYTHON_BIN", "python3");
    vi.stubEnv("GEMINI_EXECUTION_FALLBACK_ENABLED", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const provider = await selectProvider();
    expect(provider.name).toBe("local");
    expect(provider.isConfigured()).toBe(true);
  });

  it("still prefers Judge0 over local execution when JUDGE0_URL is set", async () => {
    vi.stubEnv("JUDGE0_URL", "http://localhost:2358");
    vi.stubEnv("LOCAL_EXECUTION_ENABLED", "true");
    vi.stubEnv("PYTHON_BIN", "python3");

    const provider = await selectProvider();
    expect(provider.name).toBe("judge0");
  });

  it("falls through to the Gemini fallback when local execution is on but no toolchain is configured", async () => {
    vi.stubEnv("JUDGE0_URL", "");
    vi.stubEnv("LOCAL_EXECUTION_ENABLED", "true");
    // Blank every toolchain: an empty value disables the languages that need it.
    vi.stubEnv("PYTHON_BIN", "");
    vi.stubEnv("LOCAL_NODE_BIN", "");
    vi.stubEnv("LOCAL_GCC_BIN", "");
    vi.stubEnv("LOCAL_GXX_BIN", "");
    vi.stubEnv("LOCAL_JAVAC_BIN", "");
    vi.stubEnv("LOCAL_JAVA_BIN", "");
    vi.stubEnv("GEMINI_EXECUTION_FALLBACK_ENABLED", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const provider = await selectProvider();
    expect(provider.name).toBe("gemini-execution");
  });

  it("preserves the EXECUTION_UNAVAILABLE behaviour when the fallback is disabled", async () => {
    vi.stubEnv("JUDGE0_URL", "");
    vi.stubEnv("LOCAL_EXECUTION_ENABLED", "");
    vi.stubEnv("GEMINI_EXECUTION_FALLBACK_ENABLED", "false");
    vi.stubEnv("GEMINI_API_KEY", "test-key");

    const provider = await selectProvider();
    expect(provider.name).toBe("unconfigured");
    expect(provider.isConfigured()).toBe(false);
  });

  it("stays unconfigured when the fallback is enabled but no API key is present", async () => {
    vi.stubEnv("JUDGE0_URL", "");
    vi.stubEnv("LOCAL_EXECUTION_ENABLED", "");
    vi.stubEnv("GEMINI_EXECUTION_FALLBACK_ENABLED", "true");
    vi.stubEnv("GEMINI_API_KEY", "");

    const provider = await selectProvider();
    expect(provider.name).toBe("unconfigured");
    expect(provider.isConfigured()).toBe(false);
  });
});
