/**
 * Demo reset CLI - restores a dedicated local DEMO database to its seeded state.
 *
 *   pnpm db:demo-inspect                         # read-only: target + what would be removed
 *   pnpm db:demo-reset --confirm <db-name>       # backup -> guarded reset -> re-seed
 *
 * Refuses (exit code 2) unless GRADEVISION_DEMO_MODE=true, DEMO_DATABASE_NAME
 * names the database, --confirm repeats it, the host is loopback, the database
 * is not a test/system database, NODE_ENV is not production, and the server
 * itself reports that database. The server check is repeated inside the
 * transaction that deletes. Only the demo namespace is touched (see
 * database/src/demo-reset.ts); schema and migration history are never changed.
 *
 * Options: --no-backup (skip pg_dump), --no-seed (skip the re-seed).
 * Never prints the connection URL or credentials.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  checkDemoTarget,
  inspectDemoData,
  resetDemoData,
  serverDatabaseName,
  tsxScriptCommand,
} from "../src/demo-reset.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const inspectOnly = flag("--inspect");
const env = {
  databaseUrl: process.env.DATABASE_URL,
  demoMode: process.env.GRADEVISION_DEMO_MODE,
  expectedName: process.env.DEMO_DATABASE_NAME,
  confirmName: option("--confirm"),
  nodeEnv: process.env.NODE_ENV,
};

function refuse(reasons: string[]): never {
  console.error("Demo reset REFUSED - nothing was changed:");
  for (const reason of reasons) console.error(`  - ${reason}`);
  process.exit(2);
}

function findPgDump(): string | null {
  const candidates = [
    process.env.PG_DUMP_BIN,
    "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
    "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
    "/usr/bin/pg_dump",
    "/opt/homebrew/bin/pg_dump",
  ].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const onPath = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
  return onPath.status === 0 ? "pg_dump" : null;
}

function backup(databaseUrl: string, database: string): string {
  const bin = findPgDump();
  if (!bin) throw new Error("pg_dump not found (set PG_DUMP_BIN, or pass --no-backup)");
  const url = new URL(databaseUrl);
  const dir = path.resolve(here, "..", "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const file = path.join(dir, `${database}-${stamp}.dump`);
  const result = spawnSync(
    bin,
    [
      "--format=custom",
      `--file=${file}`,
      `--host=${url.hostname.replace(/^\[|\]$/gu, "")}`,
      `--port=${url.port || "5432"}`,
      `--username=${decodeURIComponent(url.username)}`,
      database,
    ],
    {
      // Password via the environment, never on the command line or in logs.
      env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(`pg_dump failed (exit ${result.status})`);
  return file;
}

function reseed(): void {
  const { command, args, cwd } = tsxScriptCommand(
    path.resolve(here, ".."),
    path.join(here, "seed.ts"),
  );
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (result.error) throw new Error(`re-seed failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`re-seed failed (exit ${result.status})`);
}

async function main(): Promise<void> {
  // Never connect for a destructive run until the static checks pass.
  const preflight = checkDemoTarget(env);
  if (!inspectOnly && !preflight.ok) refuse(preflight.reasons);
  if (!env.databaseUrl) refuse(["DATABASE_URL is not set"]);

  const prisma = new PrismaClient({ datasourceUrl: env.databaseUrl });
  try {
    const serverDatabase = await serverDatabaseName(prisma);
    const verdict = checkDemoTarget({ ...env, serverDatabase });

    if (inspectOnly) {
      console.log(`Target: database '${serverDatabase}' on ${preflight.host ?? "?"}`);
      // Inspect takes no --confirm, so judge the target without that check.
      const blockers = verdict.reasons.filter((r) => !r.startsWith("--confirm"));
      console.log(
        blockers.length === 0
          ? "Guard: a reset of this target would be ALLOWED (with --confirm)."
          : `Guard: a reset would be REFUSED:\n  - ${blockers.join("\n  - ")}`,
      );
      console.log("Would remove (demo namespace only):", await inspectDemoData(prisma));
      return;
    }
    if (!verdict.ok) refuse(verdict.reasons);

    const before = await inspectDemoData(prisma);
    if (!flag("--no-backup")) {
      const file = backup(env.databaseUrl, serverDatabase!);
      console.log(`Backup written: ${path.relative(process.cwd(), file)}`);
    }

    const removed = await resetDemoData(prisma, async (tx) => {
      const inside = await serverDatabaseName(tx);
      const check = checkDemoTarget({ ...env, serverDatabase: inside });
      if (!check.ok) throw new Error(`target changed: ${check.reasons.join("; ")}`);
    });
    console.log("Removed:", removed);
    if (JSON.stringify(before) !== JSON.stringify(removed)) {
      console.log("(counts changed between inspection and reset - activity happened meanwhile)");
    }

    if (!flag("--no-seed")) {
      try {
        reseed();
      } catch (error) {
        // The removal above has already committed; only the re-seed is missing.
        console.error(
          `Demo data was removed (committed), but the re-seed failed: ${
            error instanceof Error ? error.message : error
          }\nRun \`pnpm db:seed\` to restore the seeded accounts and content.`,
        );
        process.exitCode = 1;
        return;
      }
      console.log("Re-seeded demo accounts and content (deterministic fixed ids).");
    }
    console.log("Demo reset complete. Schema and migration history unchanged.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Demo reset failed - the transaction was rolled back:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
