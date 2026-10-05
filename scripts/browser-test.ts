import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { startApp } from "../src/server/app.js";
import { launchRuntime } from "../tests/helpers/runtime.js";

const checkout = process.env.OI_CHECKOUT;
if (!checkout) throw new Error("Set OI_CHECKOUT to the documented SQLite runtime checkout.");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const cleanups: Array<() => Promise<void>> = [() => browser.close()];
let runtime: Awaited<ReturnType<typeof launchRuntime>>;
let app: Awaited<ReturnType<typeof startApp>>;
let unconfigured: Awaited<ReturnType<typeof startApp>>;
const errors: string[] = [];
const password = "browser-test-password-123";
async function signIn(page: Page, username: string, register: boolean) {
  await page.goto(app.origin);
  await page.waitForFunction(
    () => document.getElementById("badge")?.textContent === "FOUNDATION READY",
  );
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: false }).fill(password);
  if (register) await page.getByLabel("Create a new account").check();
  await page
    .getByRole("button", { name: register ? "Create account" : "Sign in", exact: true })
    .click();
  await page.waitForFunction(
    () => document.getElementById("account-badge")?.textContent === "SIGNED IN",
  );
  assert(await page.getByRole("button", { name: "Start full match" }).isDisabled());
  assert.equal(await page.evaluate(() => document.cookie), "");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  const cookies = await page.context().cookies();
  assert(cookies.every((c) => c.httpOnly && c.sameSite === "Strict"));
}
async function call(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, args }) => {
      const response = await fetch("/api/runtime", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `astra.game_${name}`, args }),
      });
      return { status: response.status, body: await response.json() };
    },
    { name, args },
  );
}
try {
  runtime = await launchRuntime(checkout);
  cleanups.push(() => runtime.close());
  app = await startApp({ checkout, serviceUrl: runtime.origin, port: 0 });
  cleanups.push(() => app.close());
  unconfigured = await startApp({ port: 0 });
  cleanups.push(() => unconfigured.close());
  await mkdir("test-results", { recursive: true });
  const alice = await browser.newContext({ viewport: { width: 1360, height: 980 } });
  const bob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await alice.newPage(),
    b = await bob.newPage();
  for (const page of [a, b]) {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
  }
  await a.goto(unconfigured.origin);
  await a.waitForFunction(() => document.getElementById("badge")?.textContent === "NOT CONNECTED");
  assert(await a.getByRole("button", { name: "Sign in", exact: true }).isDisabled());
  await a.getByRole("button", { name: "Check connection" }).click();
  await a.waitForFunction(() => document.getElementById("badge")?.textContent === "NOT CONNECTED");
  await signIn(a, "alice", true);
  await signIn(b, "bob", true);
  for (const page of [a, b])
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await a.screenshot({ path: "test-results/foundation-desktop.png", fullPage: true });
  await b.screenshot({ path: "test-results/foundation-mobile.png", fullPage: true });
  const createArgs = { version: 2, command_id: randomUUID() };
  const created = await call(a, "create_match", createArgs);
  assert.equal(created.status, 200);
  const id = created.body.snapshot.match_id;
  const joined = await call(b, "join_match", {
    version: 2,
    command_id: randomUUID(),
    match_id: id,
    invite_code: created.body.invite_code,
  });
  assert.equal(joined.status, 200);
  const read = async () => {
    const result = await call(a, "read_match", { version: 2, match_id: id });
    assert.equal(result.status, 200);
    return result.body.snapshot;
  };
  const action = async (action: string, target: Record<string, string>) => {
    const result = await call(a, "command", {
      version: 2,
      command_id: randomUUID(),
      match_id: id,
      expected_revision: (await read()).revision,
      action,
      ...target,
    });
    assert.equal(result.status, 200);
    return result.body.snapshot;
  };
  const inspected = await action("inspect_deposit", {
    deposit_id: created.body.snapshot.deposits[0].id,
  });
  const collected = await action("collect_deposit", {
    deposit_id: created.body.snapshot.deposits[0].id,
  });
  await action("start_processing", {
    batch_id: collected.batches[0].id,
    machine_id: collected.machines[0].id,
  });
  await a.getByRole("button", { name: "Sign out", exact: true }).click();
  await a.waitForFunction(
    () => document.getElementById("account-badge")?.textContent === "SIGNED OUT",
  );
  await signIn(a, "alice", false);
  let finished = await read();
  const deadline = Date.now() + 35000;
  while (finished.jobs[0]?.state !== "completed" && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 1000));
    finished = await read();
  }
  assert.equal(finished.jobs[0]?.state, "completed");
  assert.equal(finished.batches.length, 4);
  assert.equal(finished.machines[0].energy_mj, 10000000);
  for (const key of ["copper_g", "hdpe_g", "dirt_g"]) {
    assert.equal(
      finished.batches
        .filter((v: { state: string }) => v.state !== "consumed")
        .reduce((sum: number, v: Record<string, number>) => sum + (v[key] ?? 0), 0),
      inspected.deposits[0].observation[key],
    );
  }
  const other = await call(b, "read_match", { version: 2, match_id: id });
  assert.equal(other.body.snapshot.deposits[0].observation, null);
  assert.equal(other.body.snapshot.batches.length, 0);
  assert.deepEqual((await call(a, "create_match", createArgs)).body, created.body);
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop/mobile browsers: loading/error/retry, real SQLite signup/login, HttpOnly isolation, two accounts, API processing loop, logout/reconnect, privacy and conservation. Full game stays disabled.",
  );
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
}
