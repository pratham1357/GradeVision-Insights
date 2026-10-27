#!/usr/bin/env node
/**
 * Headless-browser smoke test of the running local stack (web :5173, API :4000).
 * Drives Microsoft Edge / Chrome over the DevTools protocol using Node's
 * built-in WebSocket - no extra dependencies, no downloaded browser.
 *
 * Fails on: console errors, uncaught exceptions, 5xx API responses, ANY request
 * to a host other than this machine (the demo must run offline), a session
 * token visible to page scripts or stored in localStorage.
 *
 * Runs two separate browser profiles at the same time (instructor + student) to
 * check that their sessions are independent. Screenshots go to $SMOKE_OUT.
 *
 *   node apps/web/scripts/browser-smoke.mjs
 *
 * Uses the seeded development accounts. It starts a real exam session for
 * student1 and creates one rehearsal account as the demo admin; run the demo
 * reset afterwards (docs/LOCAL_DEMO.md).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WEB = process.env.SMOKE_WEB_URL ?? "http://localhost:5173";
const API = process.env.SMOKE_API_URL ?? "http://localhost:4000";
// Node-side calls: the API listens on IPv4 loopback only, and Node does not fall back from ::1.
const API_NODE = process.env.SMOKE_API_NODE_URL ?? "http://127.0.0.1:4000";
const OUT = process.env.SMOKE_OUT ?? mkdtempSync(path.join(tmpdir(), "gv-smoke-"));
const ACCOUNTS = {
  instructor: [
    "instructor@example.edu",
    process.env.SMOKE_INSTRUCTOR_PASSWORD ?? "instructor-dev-password",
  ],
  student: ["student1@example.edu", process.env.SMOKE_STUDENT_PASSWORD ?? "student-dev-password"],
  admin: ["admin@example.edu", process.env.SMOKE_ADMIN_PASSWORD ?? "admin-dev-password"],
};
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BROWSERS = [
  process.env.SMOKE_BROWSER,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  return ok;
}

/** One isolated browser profile (its own cookie jar) driven over CDP. */
async function openBrowser(label, port) {
  const bin = BROWSERS.find((b) => existsSync(b));
  if (!bin) throw new Error("No Edge/Chrome found; set SMOKE_BROWSER");
  const profile = mkdtempSync(path.join(tmpdir(), `gv-smoke-${label}-`));
  const child = spawn(
    bin,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--window-size=1366,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {
      /* not up yet */
    }
    if (!wsUrl) await sleep(200);
  }
  if (!wsUrl) throw new Error(`${label}: browser did not expose a DevTools endpoint`);

  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const requests = [];
  const problems = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    const p = msg.params;
    if (msg.method === "Network.requestWillBeSent") requests.push(p.request.url);
    else if (msg.method === "Network.responseReceived" && p.response.status >= 500) {
      problems.push(`HTTP ${p.response.status} ${p.response.url}`);
    } else if (msg.method === "Runtime.exceptionThrown") {
      problems.push(
        `exception: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`,
      );
    } else if (msg.method === "Runtime.consoleAPICalled" && p.type === "error") {
      problems.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(" ")}`);
    } else if (
      msg.method === "Log.entryAdded" &&
      p.entry.level === "error" &&
      // 4xx resource logs come from deliberate negative checks; 5xx are caught above.
      !/status of 4\d\d/.test(p.entry.text)
    ) {
      problems.push(`log: ${p.entry.text} ${p.entry.url ?? ""}`);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  await Promise.all([
    send("Page.enable"),
    send("Runtime.enable"),
    send("Network.enable"),
    send("Log.enable"),
  ]);

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails)
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const waitFor = async (expression, timeoutMs = 15_000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        /* navigating */
      }
      await sleep(150);
    }
    return false;
  };
  const b = {
    label,
    requests,
    problems,
    send,
    evaluate,
    waitFor,
    async goto(url) {
      await send("Page.navigate", { url });
      await waitFor("document.readyState === 'complete'");
    },
    async shot(name) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
    },
    text: (needle) =>
      `!!document.body && document.body.innerText.includes(${JSON.stringify(needle)})`,
    fill: (selector, value) =>
      evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`),
    clickText: (label2, scope = "document") =>
      evaluate(`(() => {
        const el = [...${scope}.querySelectorAll("button, a")].find((x) => x.innerText.trim() === ${JSON.stringify(label2)});
        if (!el) return false; el.click(); return true;
      })()`),
    /** Calls the API from the page exactly like the app does: cookie + CSRF token. */
    api: (pathname, init = {}) =>
      evaluate(`(async () => {
        const base = ${JSON.stringify(`${API}/api/v1`)};
        const init = ${JSON.stringify(init)};
        const headers = { "content-type": "application/json" };
        if (init.method && init.method !== "GET") {
          const s = await fetch(base + "/auth/session", { credentials: "include" }).then((r) => r.json());
          headers["x-csrf-token"] = s.data?.csrfToken ?? "";
        }
        const r = await fetch(base + ${JSON.stringify(pathname)}, { ...init, headers, credentials: "include" });
        return { status: r.status, body: await r.json().catch(() => null) };
      })()`),
    async login([email, password]) {
      await b.goto(`${WEB}/login`);
      await waitFor("!!document.querySelector('input[type=email]')");
      await b.fill("input[type=email]", email);
      await b.fill("input[type=password]", password);
      await evaluate("document.querySelector('form').requestSubmit(), true");
    },
    async signOut() {
      await b.clickText("Sign out");
      return waitFor("location.pathname === '/login'");
    },
    async close() {
      ws.close();
      child.kill();
      await sleep(400);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* Windows may still hold files */
      }
    },
  };
  return b;
}

/** No bearer token in storage; the session cookie must be invisible to scripts. */
async function checkNoTokenInPage(b, who) {
  const exposed = await b.evaluate(`(() => {
    const storage = [];
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) storage.push(s.key(i) + "=" + s.getItem(s.key(i)));
    return { cookie: document.cookie, storage };
  })()`);
  check(
    `${who}: session is HttpOnly - not readable by page scripts, nothing in web storage`,
    !/gv_session/.test(exposed.cookie) && !exposed.storage.some((e) => /token|session/i.test(e)),
    JSON.stringify(exposed).slice(0, 120),
  );
}

async function main() {
  const A = await openBrowser("profile-a", 9333);
  const B = await openBrowser("profile-b", 9334);
  try {
    // --- Two independent profiles signed in at the same time -----------------
    await Promise.all([A.login(ACCOUNTS.instructor), B.login(ACCOUNTS.student)]);
    check(
      "profile A: instructor lands on the dashboard",
      await A.waitFor("location.pathname === '/dashboard'"),
    );
    check(
      "profile B: student lands on their assessments",
      await B.waitFor("location.pathname === '/student'"),
    );
    const [whoA, whoB] = await Promise.all([A.api("/auth/session"), B.api("/auth/session")]);
    check(
      "the two profiles hold separate sessions for separate users",
      whoA.body?.data?.user?.role === "INSTRUCTOR" && whoB.body?.data?.user?.role === "STUDENT",
      `${whoA.body?.data?.user?.email} | ${whoB.body?.data?.user?.email}`,
    );
    await checkNoTokenInPage(A, "instructor");
    await checkNoTokenInPage(B, "student");
    check(
      "a student session cannot reach instructor APIs",
      (await B.api("/assessments")).status === 403,
    );
    const noCsrf = await B.evaluate(
      `fetch(${JSON.stringify(`${API}/api/v1/auth/logout`)}, { method: "POST", credentials: "include" }).then((r) => r.status)`,
    );
    check("a cookie request without the CSRF token is refused", noCsrf === 403, `HTTP ${noCsrf}`);

    // --- Instructor ----------------------------------------------------------
    await A.waitFor(A.text("Assessments"), 8_000);
    await A.shot("01-instructor-dashboard");
    const questions = (await A.api("/questions")).body?.data ?? [];
    if (
      check("instructor question list loads", questions.length > 0, `${questions.length} questions`)
    ) {
      await A.goto(`${WEB}/questions/${questions[0].id}`);
      check("question editor shows hint-stage authoring", await A.waitFor(A.text("Hint stages")));
      await A.shot("02-question-editor");
    }
    const assessments = (await A.api("/assessments")).body?.data ?? [];
    const live = assessments.find((x) => x.status === "ACTIVE");
    if (live) {
      await A.goto(`${WEB}/assessments/${live.id}/results`);
      check(
        "instructor results page renders",
        await A.waitFor(`${A.text("Results")} || ${A.text("results")}`),
      );
      await A.shot("03-instructor-results");
    }

    // --- Student -------------------------------------------------------------
    await B.waitFor(B.text("Live Coding"), 8_000);
    await B.shot("04-student-dashboard");
    await B.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await B.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    check(
      "first Tab focuses 'Skip to main content'",
      await B.waitFor(
        "document.activeElement && document.activeElement.innerText === 'Skip to main content'",
        2_000,
      ),
    );
    const available = (await B.api("/student/assessments")).body?.data ?? [];
    const target = available.find((x) => /Live Coding/i.test(x.title));
    if (check("student sees the live assessment", Boolean(target), target?.title ?? "none")) {
      const started = await B.api(`/student/assessments/${target.id}/session`, {
        method: "POST",
        body: JSON.stringify({ acknowledgeEvidenceNotice: true }),
      });
      check(
        "student starts a session (cookie + CSRF)",
        started.status === 201 || started.status === 200,
        `HTTP ${started.status}`,
      );
      await B.goto(`${WEB}/student/exam/${started.body?.data?.id}`);
      check(
        "Monaco editor renders from the local bundle",
        await B.waitFor("!!document.querySelector('.monaco-editor .view-lines')", 30_000),
      );
      await sleep(400);
      await B.shot("05-student-exam");
    }

    // --- Session ended elsewhere: revoke B's session server-side -------------
    const { cookies } = await B.send("Network.getCookies", { urls: [API] });
    const sessionCookie = cookies.find((c) => /gv_session$/.test(c.name));
    check(
      "the session cookie is HttpOnly and SameSite=Strict",
      Boolean(sessionCookie?.httpOnly && sessionCookie?.sameSite === "Strict"),
    );
    if (sessionCookie) {
      const cookieHeader = `${sessionCookie.name}=${sessionCookie.value}`;
      const session = await (
        await fetch(`${API_NODE}/api/v1/auth/session`, { headers: { cookie: cookieHeader } })
      ).json();
      const logout = await fetch(`${API_NODE}/api/v1/auth/logout`, {
        method: "POST",
        headers: { cookie: cookieHeader, origin: WEB, "x-csrf-token": session.data.csrfToken },
      });
      check("server-side logout of profile B", logout.status === 204);
      await B.evaluate(
        "history.pushState({}, '', '/student'); dispatchEvent(new PopStateEvent('popstate')); true",
      );
      check(
        "profile B is sent to sign in with a 'session ended' notice",
        await B.waitFor(`location.pathname === '/login' && ${B.text("Your session ended")}`),
      );
      await B.shot("06-session-ended");
      check("profile A (instructor) is unaffected", (await A.api("/auth/session")).status === 200);
    }

    // --- Admin in profile B: account management -------------------------------
    await B.login(ACCOUNTS.admin);
    check("admin lands on the admin page", await B.waitFor("location.pathname === '/admin'"));
    check("admin sees account management", await B.waitFor(B.text("Create an account")));
    check(
      "admin cannot use instructor authoring APIs",
      (await B.api("/assessments")).status === 403,
    );
    const email = `smoke-${Date.now()}@example.edu`;
    const created = await B.api("/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        name: "Smoke Rehearsal",
        role: "STUDENT",
        password: "smoke-test-passphrase",
      }),
    });
    check("admin creates an account", created.status === 201, `HTTP ${created.status}`);
    await B.goto(`${WEB}/admin`);
    await B.waitFor(B.text(email));
    const clicked = await B.evaluate(`(() => {
      const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(${JSON.stringify(email)}));
      const btn = row && [...row.querySelectorAll("button")].find((x) => x.innerText.trim() === "Deactivate");
      if (!btn) return false; btn.click(); return true;
    })()`);
    check(
      "admin deactivates it from the table",
      clicked && (await B.waitFor(B.text(`${email} deactivated`))),
    );
    await B.shot("07-admin");
    check("instructor sign-out works in profile A", await A.signOut());
  } finally {
    for (const b of [A, B]) {
      const external = [...new Set(b.requests)]
        .filter((u) => /^https?:/.test(u))
        .filter((u) => !LOCAL_HOSTS.has(new URL(u).hostname));
      check(
        `${b.label}: no request left this machine`,
        external.length === 0,
        external.slice(0, 3).join(", "),
      );
      check(
        `${b.label}: no console errors, exceptions or 5xx`,
        b.problems.length === 0,
        b.problems.slice(0, 3).join(" | "),
      );
      await b.close();
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
