#!/usr/bin/env node
/**
 * Local demo readiness check. Verifies that every component answers on this
 * machine, that the expected providers are selected (local execution, local
 * Ollama model), and that nothing is reachable through this machine's LAN
 * address. Prints no secrets.
 *
 *   node scripts/check-local.mjs
 */
import net from "node:net";
import os from "node:os";

const API = "http://127.0.0.1:4000";
const EVALUATOR = "http://127.0.0.1:4100";
const HINTS = "http://127.0.0.1:4200";
const WEB = "http://localhost:5173";
const OLLAMA = "http://127.0.0.1:11434";

let failures = 0;
let warnings = 0;
const line = (status, label, detail = "") => {
  if (status === "FAIL") failures += 1;
  if (status === "WARN") warnings += 1;
  console.log(`${status.padEnd(4)}  ${label}${detail ? ` - ${detail}` : ""}`);
};

async function json(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function step(label, fn) {
  try {
    await fn();
  } catch (error) {
    line("FAIL", label, error instanceof Error ? error.message : String(error));
  }
}

await step("API", async () => {
  const { status, body } = await json(`${API}/api/v1/health`);
  const db = body?.checks?.database?.status;
  line(status === 200 && db === "up" ? "OK" : "FAIL", "API + database", `HTTP ${status}, db ${db}`);
});

await step("Evaluator", async () => {
  const { body } = await json(`${EVALUATOR}/health`);
  const provider = body?.execution?.provider;
  line(
    provider === "local" || provider === "judge0" ? "OK" : "FAIL",
    "Evaluator execution provider",
    String(provider),
  );
  if (provider === "local") {
    line(
      "WARN",
      "Local execution has NO sandbox",
      "trusted demo machine only; never expose to a network",
    );
  }
});

await step("Hint engine", async () => {
  const { body } = await json(`${HINTS}/health`);
  const p = body?.provider ?? {};
  line(p.name === "ollama" ? "OK" : "WARN", "Hint provider", `${p.name} / ${p.model}`);
  if (p.name === "ollama") {
    line(p.reachable ? "OK" : "FAIL", "Ollama reachable from hint-engine");
    line(p.modelAvailable ? "OK" : "FAIL", "Configured model is pulled", String(p.model));
  }
});

await step("Ollama", async () => {
  const { body } = await json(`${OLLAMA}/api/version`);
  line("OK", "Ollama server", `v${body?.version}`);
  const ps = await json(`${OLLAMA}/api/ps`);
  const loaded = ps.body?.models ?? [];
  line(
    "OK",
    "Model loaded in memory",
    loaded.length
      ? loaded.map((m) => `${m.name} ${(m.size / 1024 ** 3).toFixed(2)} GiB`).join(", ")
      : "none yet (loads on first hint)",
  );
});

await step("Web", async () => {
  const res = await fetch(WEB, { signal: AbortSignal.timeout(4_000) });
  line(res.ok ? "OK" : "FAIL", "Web app", `HTTP ${res.status}`);
});

// --- Exposure: connect to each port through this machine's LAN address. ---
const lanAddresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);

function reachable(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

if (lanAddresses.length === 0) {
  line("OK", "No LAN interface up - nothing can be reached from a network");
} else {
  for (const address of lanAddresses) {
    for (const [port, name, critical] of [
      [4000, "API", true],
      [4100, "evaluator", true],
      [4200, "hint-engine", true],
      [5173, "web", true],
      [11434, "Ollama", true],
      [5432, "PostgreSQL (system service)", false],
    ]) {
      const open = await reachable(address, port);
      if (!open) line("OK", `${name} not reachable on ${address}:${port}`);
      else
        line(
          critical ? "FAIL" : "WARN",
          `${name} IS reachable on ${address}:${port}`,
          critical ? "bind it to 127.0.0.1" : "restrict listen_addresses or firewall 5432",
        );
    }
  }
}

console.log(
  `\n${failures === 0 ? "READY" : "NOT READY"}: ${failures} failure(s), ${warnings} warning(s)`,
);
process.exit(failures === 0 ? 0 : 1);
