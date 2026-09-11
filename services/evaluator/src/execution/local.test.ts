/**
 * Real-process tests for `LocalExecutionProvider`. These spawn the host's real
 * toolchains (`PYTHON_BIN`, default `python3` - the same binary the semantic
 * analyzer uses and CI installs - plus node/gcc/g++/javac/java when present).
 * Nothing is mocked: the assertions are about what the student's program
 * actually printed / how it actually terminated. Language blocks whose
 * toolchain is missing on this host are skipped, never faked.
 */
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { ExecutionRequest, GradingLanguage } from "@gradevision/grading";
import { evaluateFunctional } from "@gradevision/grading";
import { describe, expect, it } from "vitest";

import { LocalExecutionProvider, type LocalExecutionConfig } from "./local.js";

const PYTHON_BIN = process.env.PYTHON_BIN?.trim() || "python3";

const CONFIG: LocalExecutionConfig = {
  bins: { python: PYTHON_BIN, node: null, gcc: null, gxx: null, javac: null, java: null },
  defaultWallTimeMs: 3_000,
  compileTimeoutMs: 10_000,
};

/** True when `bin` can be started on this host (used to skip, not fake, a language). */
function hasBin(bin: string, versionFlag = "--version"): boolean {
  const probe = spawnSync(bin, [versionFlag], { stdio: "ignore", windowsHide: true });
  return !probe.error;
}

const CASES: ExecutionRequest["cases"] = [
  { id: "case-1", stdin: "2 3\n", expectedOutput: "5" },
  { id: "case-2", stdin: "10 -4\n", expectedOutput: "6" },
];

function request(sourceCode: string, overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    language: "PYTHON",
    sourceCode,
    cases: CASES,
    limits: { cpuTimeMs: null, memoryMb: null },
    ...overrides,
  };
}

async function execDirs(): Promise<string[]> {
  return (await readdir(tmpdir())).filter((name) => name.startsWith("gradevision-exec-"));
}

describe("LocalExecutionProvider (python)", () => {
  const provider = new LocalExecutionProvider(CONFIG);

  it("is configured only when a language has every toolchain it needs", () => {
    expect(provider.isConfigured()).toBe(true);
    expect(provider.enabledLanguages()).toEqual(["PYTHON"]);
    const none = new LocalExecutionProvider({ ...CONFIG, bins: { ...CONFIG.bins, python: null } });
    expect(none.isConfigured()).toBe(false);
    // Java needs both javac and java - one alone does not enable it.
    const halfJava = new LocalExecutionProvider({
      ...CONFIG,
      bins: { ...CONFIG.bins, python: null, javac: "javac" },
    });
    expect(halfJava.enabledLanguages()).toEqual([]);
    const fullJava = new LocalExecutionProvider({
      ...CONFIG,
      bins: { ...CONFIG.bins, python: null, javac: "javac", java: "java" },
    });
    expect(fullJava.enabledLanguages()).toEqual(["JAVA"]);
  });

  it("runs a correct program against every case with stdin and captures real stdout", async () => {
    const result = await provider.execute(
      request("a, b = map(int, input().split())\nprint(a + b)\n"),
    );

    expect(result.provider).toBe("local");
    expect(result.cases.map((c) => c.caseId)).toEqual(["case-1", "case-2"]);
    for (const run of result.cases) {
      expect(run.runStatus).toBe("COMPLETED");
      expect(run.exitCode).toBe(0);
      expect(run.compileOutput).toBeNull();
      expect(run.timeMs).toBeTypeOf("number");
    }
    expect(result.cases[0]!.stdout.trim()).toBe("5");
    expect(result.cases[1]!.stdout.trim()).toBe("6");

    // Feeding the raw run into the unchanged functional layer yields the pass/fail.
    const functional = evaluateFunctional(
      CASES.map((c) => ({
        caseId: c.id,
        weight: 1,
        expectedOutput: c.expectedOutput,
        visibility: "HIDDEN",
      })),
      result.cases,
    );
    expect(functional.passedCount).toBe(2);
  });

  it("reports a wrong-answer program as COMPLETED - correctness is the grading layer's call", async () => {
    const result = await provider.execute(
      request("a, b = map(int, input().split())\nprint(a - b)\n"),
    );
    expect(result.cases.map((c) => c.runStatus)).toEqual(["COMPLETED", "COMPLETED"]);
    expect(result.cases[0]!.stdout.trim()).toBe("-1");

    const functional = evaluateFunctional(
      CASES.map((c) => ({
        caseId: c.id,
        weight: 1,
        expectedOutput: c.expectedOutput,
        visibility: "HIDDEN",
      })),
      result.cases,
    );
    expect(functional.passedCount).toBe(0);
    expect(functional.outcomes.map((o) => o.status)).toEqual(["FAILED", "FAILED"]);
  });

  it("maps a crash to RUNTIME_ERROR with the real stderr and non-zero exit code", async () => {
    const result = await provider.execute(
      request("import sys\nprint('partial')\nsys.stdout.flush()\nraise ValueError('boom')\n"),
    );
    const run = result.cases[0]!;
    expect(run.runStatus).toBe("RUNTIME_ERROR");
    expect(run.exitCode).not.toBe(0);
    expect(run.stdout.trim()).toBe("partial");
    expect(run.stderr).toContain("ValueError: boom");
  });

  it("maps a syntax error to COMPILE_ERROR and skips running any case", async () => {
    const result = await provider.execute(request("def broken(:\n    pass\n"));
    expect(result.cases).toHaveLength(2);
    for (const run of result.cases) {
      expect(run.runStatus).toBe("COMPILE_ERROR");
      expect(run.compileOutput).toContain("SyntaxError");
      expect(run.stdout).toBe("");
      expect(run.exitCode).toBeNull();
    }
  });

  it("kills a non-terminating program at the wall-clock limit and reports TIMEOUT", async () => {
    const started = Date.now();
    const result = await provider.execute(
      request("while True:\n    pass\n", {
        cases: [CASES[0]!],
        limits: { wallTimeMs: 1_000, cpuTimeMs: null, memoryMb: null },
      }),
    );
    const run = result.cases[0]!;
    expect(run.runStatus).toBe("TIMEOUT");
    expect(run.exitCode).toBeNull();
    // Killed near the limit, not at the 3 s provider default.
    expect(Date.now() - started).toBeLessThan(2_800);
  });

  it("derives the wall limit from the question's CPU limit plus a grace period", async () => {
    const started = Date.now();
    const result = await provider.execute(
      request("while True:\n    pass\n", {
        cases: [CASES[0]!],
        limits: { cpuTimeMs: 200, memoryMb: null },
      }),
    );
    expect(result.cases[0]!.runStatus).toBe("TIMEOUT");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(3_000);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("does not leak evaluator secrets into the student's environment", async () => {
    process.env.GRADEVISION_TEST_SECRET = "must-not-leak";
    try {
      const result = await provider.execute(
        request(
          "import os\nprint(os.environ.get('GRADEVISION_TEST_SECRET', 'absent'))\nprint(os.environ.get('DATABASE_URL', 'absent'))\n",
          { cases: [CASES[0]!] },
        ),
      );
      expect(result.cases[0]!.runStatus).toBe("COMPLETED");
      expect(result.cases[0]!.stdout.trim().split(/\r?\n/)).toEqual(["absent", "absent"]);
    } finally {
      delete process.env.GRADEVISION_TEST_SECRET;
    }
  });

  it("terminates a program that floods stdout and flags the case as a runtime error", async () => {
    const result = await provider.execute(
      request("while True:\n    print('x' * 65536)\n", { cases: [CASES[0]!] }),
    );
    const run = result.cases[0]!;
    expect(run.runStatus).toBe("RUNTIME_ERROR");
    expect(run.stderr).toContain("output limit exceeded");
    expect(run.stdout.length).toBeLessThanOrEqual(20_000);
  });

  it("removes its temporary directory after every run, including failures", async () => {
    const before = await execDirs();
    await provider.execute(request("print(input())\n"));
    await provider.execute(request("def broken(:\n"));
    await provider.execute(
      request("while True:\n    pass\n", {
        cases: [CASES[0]!],
        limits: { wallTimeMs: 300, cpuTimeMs: null, memoryMb: null },
      }),
    );
    const after = await execDirs();
    expect(after.length).toBeLessThanOrEqual(before.length);
  });

  it("fails cleanly (throws) for a language with no configured toolchain", async () => {
    await expect(
      provider.execute(request("console.log(1)", { language: "JAVASCRIPT" })),
    ).rejects.toThrow(/not configured for JAVASCRIPT/);
  });

  it("throws (provider outage) when the configured binary cannot be started", async () => {
    const broken = new LocalExecutionProvider({
      ...CONFIG,
      bins: { ...CONFIG.bins, python: "definitely-not-a-real-interpreter-xyz" },
    });
    const before = await execDirs();
    await expect(broken.execute(request("print(1)"))).rejects.toThrow();
    // ...and still cleans up after itself.
    expect((await execDirs()).length).toBeLessThanOrEqual(before.length);
  });
});

// ---------------------------------------------------------------------------
// Other languages: the same provider, the same contract, real toolchains.
// ---------------------------------------------------------------------------

interface LanguageFixture {
  language: GradingLanguage;
  bins: Partial<LocalExecutionConfig["bins"]>;
  available: boolean;
  /** Reads two ints from stdin, prints their sum. */
  correct: string;
  /** Compiles/parses fine, then crashes at runtime. */
  crash: string;
  /** Fails to compile (or, for JavaScript, fails to parse at startup). */
  broken: string;
  /** Loops forever. */
  hang: string;
  /** Expected status for `broken` - JavaScript has no compile step. */
  brokenStatus: "COMPILE_ERROR" | "RUNTIME_ERROR";
}

const FIXTURES: LanguageFixture[] = [
  {
    language: "JAVASCRIPT",
    bins: { node: "node" },
    available: hasBin("node"),
    correct:
      "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(' ').map(Number);\nconsole.log(a + b);\n",
    crash: "console.log('partial');\nthrow new Error('boom');\n",
    broken: "const = ;\n",
    hang: "for (;;) {}\n",
    brokenStatus: "RUNTIME_ERROR",
  },
  {
    language: "C",
    bins: { gcc: "gcc" },
    available: hasBin("gcc"),
    correct:
      '#include <stdio.h>\nint main(void){long a,b; if(scanf("%ld %ld",&a,&b)!=2) return 1; printf("%ld\\n",a+b); return 0;}\n',
    crash:
      '#include <stdio.h>\n#include <stdlib.h>\nint main(void){printf("partial\\n"); fflush(stdout); fprintf(stderr,"boom\\n"); fflush(stderr); abort();}\n',
    broken: "int main(void){ return 0 \n",
    hang: "int main(void){ for(;;){} }\n",
    brokenStatus: "COMPILE_ERROR",
  },
  {
    language: "CPP",
    bins: { gxx: "g++" },
    available: hasBin("g++"),
    correct:
      "#include <iostream>\nint main(){long a,b; std::cin>>a>>b; std::cout<<a+b<<std::endl; return 0;}\n",
    crash:
      '#include <iostream>\n#include <stdexcept>\nint main(){std::cout<<"partial"<<std::endl; throw std::runtime_error("boom");}\n',
    broken: "int main(){ return 0 \n",
    hang: "int main(){ for(;;){} }\n",
    brokenStatus: "COMPILE_ERROR",
  },
  {
    language: "JAVA",
    bins: { javac: "javac", java: "java" },
    available: hasBin("javac", "-version") && hasBin("java", "-version"),
    correct:
      "import java.util.Scanner;\npublic class Main { public static void main(String[] a){ Scanner s=new Scanner(System.in); long x=s.nextLong(), y=s.nextLong(); System.out.println(x+y);} }\n",
    crash:
      'public class Main { public static void main(String[] a){ System.out.println("partial"); throw new RuntimeException("boom"); } }\n',
    broken: "public class Main { public static void main(String[] a){ int x = ; } }\n",
    hang: "public class Main { public static void main(String[] a){ while(true){} } }\n",
    brokenStatus: "COMPILE_ERROR",
  },
];

for (const fixture of FIXTURES) {
  describe.skipIf(!fixture.available)(`LocalExecutionProvider (${fixture.language})`, () => {
    const provider = new LocalExecutionProvider({
      ...CONFIG,
      bins: { ...CONFIG.bins, python: null, ...fixture.bins },
      compileTimeoutMs: 30_000,
    });
    const req = (sourceCode: string, overrides: Partial<ExecutionRequest> = {}) =>
      request(sourceCode, { language: fixture.language, ...overrides });

    it("enables exactly this language", () => {
      expect(provider.enabledLanguages()).toEqual([fixture.language]);
    });

    it("runs a correct program for real and the functional layer passes it", async () => {
      const result = await provider.execute(req(fixture.correct));
      expect(result.cases.map((c) => c.runStatus)).toEqual(["COMPLETED", "COMPLETED"]);
      expect(result.cases.map((c) => c.stdout.trim())).toEqual(["5", "6"]);
      const functional = evaluateFunctional(
        CASES.map((c) => ({
          caseId: c.id,
          weight: 1,
          expectedOutput: c.expectedOutput,
          visibility: "HIDDEN",
        })),
        result.cases,
      );
      expect(functional.passedCount).toBe(2);
    });

    it("reports a runtime crash with the partial stdout and a non-zero exit", async () => {
      const result = await provider.execute(req(fixture.crash, { cases: [CASES[0]!] }));
      const run = result.cases[0]!;
      expect(run.runStatus).toBe("RUNTIME_ERROR");
      expect(run.exitCode).not.toBe(0);
      expect(run.stdout.trim()).toBe("partial");
      expect(run.stderr.length).toBeGreaterThan(0);
    });

    it(`reports code that cannot build as ${fixture.brokenStatus}`, async () => {
      const result = await provider.execute(req(fixture.broken));
      expect(result.cases).toHaveLength(2);
      for (const run of result.cases) {
        expect(run.runStatus).toBe(fixture.brokenStatus);
        if (fixture.brokenStatus === "COMPILE_ERROR") {
          expect(run.compileOutput).toBeTruthy();
          expect(run.stdout).toBe("");
        }
      }
    });

    it("kills a hanging program at the wall-clock limit", async () => {
      const result = await provider.execute(
        req(fixture.hang, {
          cases: [CASES[0]!],
          limits: { wallTimeMs: 1_500, cpuTimeMs: null, memoryMb: null },
        }),
      );
      expect(result.cases[0]!.runStatus).toBe("TIMEOUT");
      expect(result.cases[0]!.exitCode).toBeNull();
    });

    it("cleans up its temporary directory", async () => {
      const before = await execDirs();
      await provider.execute(req(fixture.correct, { cases: [CASES[0]!] }));
      expect((await execDirs()).length).toBeLessThanOrEqual(before.length);
    });
  });
}
