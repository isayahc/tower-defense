import assert from "node:assert/strict";
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
let app: Awaited<ReturnType<typeof startApp>>;
const errors: string[] = [];
const password = "browser-test-password-123";
async function wait(page: Page, id: string, text: string) {
  await page.waitForFunction(
    ({ id, text }) => document.getElementById(id)?.textContent === text,
    { id, text },
    { timeout: 45000 },
  );
}
async function signIn(page: Page, username: string, register: boolean) {
  await page.goto(app.origin);
  await wait(page, "badge", "RECOVERY READY");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: false }).fill(password);
  if (register) await page.getByLabel("Create a new account").check();
  await page
    .getByRole("button", { name: register ? "Create account" : "Sign in", exact: true })
    .click();
  await wait(page, "account-badge", "SIGNED IN");
  await wait(page, "game-state", "LIVE");
  assert(await page.getByRole("button", { name: "Start full match" }).isDisabled());
  assert.equal(await page.evaluate(() => document.cookie), "");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert((await page.context().cookies()).every((c) => c.httpOnly && c.sameSite === "Strict"));
}
async function press(page: Page, name: string) {
  await wait(page, "game-state", "LIVE");
  await page.getByRole("button", { name, exact: true }).click();
  await wait(page, "game-state", "LIVE");
}
async function recover(page: Page) {
  await press(page, "Inspect cable");
  assert((await page.locator(".assay").textContent())?.includes("copper"));
  await press(page, "Collect cable");
  assert(await page.getByRole("button", { name: "Collect cable", exact: true }).isDisabled());
  await press(page, "Process cable · 20 s / 10 kJ");
}
try {
  const runtime = await launchRuntime(checkout);
  cleanups.push(() => runtime.close());
  app = await startApp({ checkout, serviceUrl: runtime.origin, port: 0 });
  cleanups.push(() => app.close());
  const unconfigured = await startApp({ port: 0 });
  cleanups.push(() => unconfigured.close());
  await mkdir("test-results", { recursive: true });
  const alice = await browser.newContext({ viewport: { width: 1360, height: 980 } });
  const bob = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await alice.newPage(),
    b = await bob.newPage();
  for (const page of [a, b]) {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("net::ERR_FAILED")) errors.push(m.text());
    });
  }
  await a.goto(unconfigured.origin);
  await wait(a, "badge", "NOT CONNECTED");
  assert(await a.getByRole("button", { name: "Sign in", exact: true }).isDisabled());
  await signIn(a, "alice", true);
  await signIn(b, "bob", true);
  await press(a, "Create recovery session");
  await wait(a, "match-status", "WAITING");
  const id = await a.getByLabel("Share this match ID").inputValue();
  const oldCode = await a.getByLabel("Share this invitation code").inputValue();
  await a.reload();
  await wait(a, "match-status", "WAITING");
  await wait(a, "game-state", "LIVE");
  assert.equal(await a.getByLabel("Share this match ID").inputValue(), id);
  assert.equal(await a.getByLabel("Share this invitation code").inputValue(), "");
  await press(a, "Renew invitation");
  const code = await a.getByLabel("Share this invitation code").inputValue();
  assert.notEqual(code, oldCode);
  await b.getByText("Have an invitation?", { exact: true }).click();
  await b.getByLabel("Match ID", { exact: true }).fill(id);
  await b.getByLabel("Invitation code", { exact: true }).fill(code);
  await press(b, "Join recovery session");
  await wait(a, "match-status", "ACTIVE");
  await wait(b, "match-status", "ACTIVE");
  assert.equal(await a.locator("#dump-map .deposit").count(), 14);
  assert.equal(await a.locator("#dump-map .outpost").count(), 2);
  assert.equal(await a.locator("#assets details").count(), 8);
  const selected = await a.locator("#deposit-choice").inputValue();
  await a.getByLabel("Select a waste site").selectOption({ label: "Crew 2 · cable" });
  assert(
    (await a.locator("#deposit-detail").textContent())?.includes("Contents remain undiscovered"),
  );
  await a.getByLabel("Select a waste site").selectOption(selected);
  // Lose a committed response once. The real UI must retry the original receipt.
  let dropped = false;
  const requests: Array<{ name: string; args: Record<string, unknown> }> = [];
  await a.route("**/api/runtime", async (route) => {
    const body = route.request().postDataJSON();
    if (body.args.action === "inspect_deposit") {
      requests.push(body);
      if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await a.getByRole("button", { name: "Inspect cable", exact: true }).click();
  await a.getByRole("button", { name: "Retry pending command" }).waitFor();
  await a.getByRole("button", { name: "Retry pending command" }).click();
  await wait(a, "game-state", "LIVE");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  await a.unroute("**/api/runtime");
  assert((await a.locator(".assay").textContent())?.includes("copper"));
  await press(a, "Collect cable");
  await press(a, "Process cable · 20 s / 10 kJ");
  await press(a, "Pause processing");
  assert((await a.locator("#jobs").textContent())?.includes("paused"));
  await press(a, "Resume processing");
  await recover(b);
  await a.getByRole("button", { name: "Sign out", exact: true }).click();
  await wait(a, "account-badge", "SIGNED OUT");
  await signIn(a, "alice", false);
  await wait(a, "match-status", "ACTIVE");
  assert.equal(await a.locator("#match-id").textContent(), id);
  for (const page of [a, b]) {
    await page.waitForFunction(
      () => document.querySelector("#jobs .job")?.getAttribute("data-state") === "completed",
      undefined,
      { timeout: 45000 },
    );
    assert.equal(await page.locator("#batches .batch").count(), 3);
    assert((await page.locator("#jobs").textContent())?.includes("10.00 kJ spent"));
    assert(await page.getByRole("button", { name: "Collect cable", exact: true }).isDisabled());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await a.reload();
  await wait(a, "match-status", "ACTIVE");
  assert.equal(await a.locator("#batches .batch").count(), 3);
  assert(await a.getByRole("button", { name: "Collect cable", exact: true }).isDisabled());
  await a.screenshot({ path: "test-results/world-desktop.png", fullPage: true });
  await b.screenshot({ path: "test-results/world-mobile.png", fullPage: true });
  await a.locator(".map-layout").screenshot({ path: "test-results/recovery-map.png" });
  await press(a, "Finish recovery session");
  await wait(a, "match-status", "ACTIVE");
  await press(b, "Finish recovery session");
  await wait(a, "match-status", "COMPLETED");
  await wait(b, "match-status", "COMPLETED");
  assert((await a.locator("#lifecycle-note").textContent())?.includes("recovery complete"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop/mobile click-through: create, refresh/renew invite, join, private selection, uncertain-response identical retry, both recovery loops, pause/resume, logout/login, persisted depletion, completion, screenshots and no console errors",
  );
} catch (error) {
  for (const [i, context] of browser.contexts().entries())
    for (const page of context.pages()) {
      await page
        .screenshot({ path: `test-results/failure-${i}.png`, fullPage: true })
        .catch(() => {});
      console.error(
        await page
          .locator("#game-message")
          .textContent()
          .catch(() => ""),
      );
    }
  throw error;
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
}
