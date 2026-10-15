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
const responseChecks: Promise<void>[] = [];
const unexpectedResponses: string[] = [];
let signingOut = false;
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
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(page, "game-state", "LIVE");
    const pending = page.waitForResponse((response) => {
      if (!response.url().endsWith("/api/runtime")) return false;
      const operation = response.request().postDataJSON()?.name;
      return ![
        "astra.game_read_match",
        "astra.game_list_matches",
        "astra.game_science_catalog",
      ].includes(operation);
    });
    await page.getByRole("button", { name, exact: true }).click();
    const response = await pending;
    const result = await response.json();
    await wait(page, "game-state", "LIVE");
    if (response.status() === 409 && result.error?.code === "CONFLICT") {
      // The UI has refreshed authoritative state; clicking again creates a new intent.
      continue;
    }
    assert.equal(response.status(), 200, `${name}: ${JSON.stringify(result)}`);
    return;
  }
  assert.fail(`${name}: repeated authoritative conflicts`);
}

async function recover(page: Page) {
  const requests: unknown[] = [];
  let dropped = false;
  await page.route("**/api/runtime", async (route) => {
    const body = route.request().postDataJSON();
    if (body.args.action === "survey_robot") {
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
  await page
    .getByRole("button", { name: "Survey with camera-depth · robot 1", exact: true })
    .click();
  await page.getByRole("button", { name: "Retry pending command" }).click();
  await wait(page, "game-state", "LIVE");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  await page.unroute("**/api/runtime");
  await page
    .getByRole("button", { name: "Collect unclassified · robot 1", exact: true })
    .waitFor({ state: "visible", timeout: 45000 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#robots button")].some(
      (b) =>
        b.textContent === "Collect unclassified · robot 1" && !(b as HTMLButtonElement).disabled,
    ),
  );
  await press(page, "Collect unclassified · robot 1");
  await page.waitForFunction(
    () => document.getElementById("robots")?.textContent?.includes("cargo 10.00 kg"),
    undefined,
    { timeout: 45000 },
  );
  await page.screenshot({
    path: `test-results/hauling-${page.viewportSize()?.width}.png`,
    fullPage: true,
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#batches .batch").length === 1,
    undefined,
    { timeout: 45000 },
  );
  assert((await page.locator("#batches").textContent())?.includes("Composition unknown"));
  await press(page, "Inspect recovered batch · 3 s / 300 J");
  await page
    .getByRole("button", { name: "Process cable · 20 s / 10 kJ", exact: true })
    .waitFor({ state: "visible", timeout: 45000 });
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
      // Chromium resource-status messages are audited against their structured HTTP responses.
      if (
        m.type() === "error" &&
        !m.text().includes("net::ERR_FAILED") &&
        !/^Failed to load resource: the server responded with a status of \d+/.test(m.text())
      )
        errors.push(m.text());
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const duringSignOut = signingOut;
      responseChecks.push(
        (async () => {
          const path = new URL(response.url()).pathname;
          const body = await response.json().catch(() => null);
          const request = response.request();
          const input = request.method() === "POST" ? request.postDataJSON() : null;
          const knownConflict =
            path === "/api/runtime" &&
            response.status() === 409 &&
            body?.error?.code === "CONFLICT" &&
            input?.name === "astra.game_command";
          const revokedPoll =
            duringSignOut &&
            path === "/api/runtime" &&
            response.status() === 401 &&
            body?.error?.code === "AUTH_REQUIRED" &&
            [
              "astra.game_read_match",
              "astra.game_list_matches",
              "astra.game_science_catalog",
            ].includes(input?.name);
          if (!knownConflict && !revokedPoll)
            unexpectedResponses.push(
              JSON.stringify({ path, status: response.status(), input, body }),
            );
        })(),
      );
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
  assert((await a.locator("#deposit-detail").textContent())?.includes("Dispatch a robot"));
  await a.getByLabel("Select a waste site").selectOption(selected);
  await recover(a);
  await press(a, "Pause processing");
  assert((await a.locator("#jobs").textContent())?.includes("paused"));
  await press(a, "Resume processing");
  await recover(b);
  signingOut = true;
  await a.getByRole("button", { name: "Sign out", exact: true }).click();
  await wait(a, "account-badge", "SIGNED OUT");
  await signIn(a, "alice", false);
  signingOut = false;
  await wait(a, "match-status", "ACTIVE");
  assert.equal(await a.locator("#match-id").textContent(), id);
  for (const page of [a, b]) {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("#jobs .job")].every(
          (j) => j.getAttribute("data-state") === "completed",
        ),
      undefined,
      { timeout: 45000 },
    );
    assert.equal(await page.locator("#batches .batch").count(), 3);
    assert((await page.locator("#jobs").textContent())?.includes("10.00 kJ spent"));
    assert(
      await page
        .getByRole("button", { name: "Collect unclassified · robot 1", exact: true })
        .isDisabled(),
    );
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await a.reload();
  await wait(a, "match-status", "ACTIVE");
  assert.equal(await a.locator("#batches .batch").count(), 3);
  assert(
    await a
      .getByRole("button", { name: "Collect unclassified · robot 1", exact: true })
      .isDisabled(),
  );
  // The UI asks the authority for evidence and previews; no client-generated grades.
  for (const page of [a, b]) {
    const conductorId = await page
      .locator("#science-target option")
      .filter({ hasText: /^conductor/ })
      .first()
      .getAttribute("value");
    assert(conductorId);
    await page.getByLabel("Owned material or component").selectOption(conductorId);
    await page.getByLabel("Design or recipe").selectOption("copper-conductor");
    await press(page, "Check suitability");
    assert((await page.locator("#science-result").textContent())?.includes("NEEDS_INSPECTION"));
    await press(page, "Inspect conductor · 3 s / 300 J");
    await page.waitForFunction(() =>
      document.getElementById("science-version")?.textContent?.includes("2 saved observations"),
    );
    await press(page, "Check suitability");
    assert(
      (await page.locator("#science-result").textContent())?.includes(
        "Eligible under this game design",
      ),
    );
    assert((await page.locator("#batches").textContent())?.includes("45000000–49000000 S/m"));
    await page.getByLabel("Operating temperature (°C)").fill("90");
    await press(page, "Check suitability");
    assert(
      (await page.locator("#science-result").textContent())?.includes("PROPERTY_NOT_ESTABLISHED"),
    );
    await page.getByLabel("Operating temperature (°C)").fill("20");
  }
  await a.reload();
  await wait(a, "match-status", "ACTIVE");
  assert((await a.locator("#science-version").textContent())?.includes("2 saved observations"));
  await press(a, "Test fastener · 3 s / 300 J");
  await a.waitForFunction(() =>
    document.getElementById("science-version")?.textContent?.includes("3 saved observations"),
  );
  await a.getByLabel("Evaluation", { exact: true }).selectOption("component");
  await press(a, "Check suitability");
  assert(
    (await a.locator("#science-result").textContent())?.includes("Eligible under this game design"),
  );
  assert((await b.locator("#science-version").textContent())?.includes("2 saved observations"));
  await press(a, "Inspect residue · 3 s / 300 J");
  await a.waitForFunction(() =>
    document.getElementById("science-version")?.textContent?.includes("4 saved observations"),
  );
  await a.getByLabel("Evaluation", { exact: true }).selectOption("process");
  const residueId = await a
    .locator("#science-target option")
    .filter({ hasText: /^residue/ })
    .getAttribute("value");
  assert(residueId);
  await a.getByLabel("Owned material or component").selectOption(residueId);
  await a.getByLabel("Design or recipe").selectOption("recover-cable-residue");
  await press(a, "Check suitability");
  assert((await a.locator("#science-result").textContent())?.includes("residue:"));
  await press(a, "Start approved process");
  await a.waitForFunction(() =>
    [...document.querySelectorAll("#jobs .job")].every(
      (j) => j.getAttribute("data-state") === "completed",
    ),
  );
  assert.equal(await a.locator("#batches .batch").count(), 4);
  assert(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await a.screenshot({ path: "test-results/world-desktop.png", fullPage: true });
  await b.screenshot({ path: "test-results/world-mobile.png", fullPage: true });
  await a.locator(".map-layout").screenshot({ path: "test-results/recovery-map.png" });
  await a.locator(".science-panel").screenshot({ path: "test-results/material-lab-desktop.png" });
  await b.locator(".science-panel").screenshot({ path: "test-results/material-lab-mobile.png" });
  await press(a, "Return and recharge · robot 1");
  await a.waitForFunction(
    () => document.getElementById("robots")?.textContent?.includes("8.00 / 8 kJ"),
    undefined,
    { timeout: 45000 },
  );
  await press(a, "Survey with camera-depth · robot 2");
  await press(a, "Interrupt · robot 2");
  await press(a, "Retreat and unload · robot 2");
  await a.waitForFunction(
    () => !(document.getElementById("finish-recovery") as HTMLButtonElement)?.disabled,
    undefined,
    { timeout: 45000 },
  );
  await press(a, "Finish recovery session");
  await wait(a, "match-status", "ACTIVE");
  const finished = b.waitForResponse(
    (response) =>
      response.url().endsWith("/api/runtime") &&
      response.request().postDataJSON()?.args.action === "finish_recovery",
  );
  await wait(b, "game-state", "LIVE");
  // Hold through a polling interval: redraw must not swallow a user gesture.
  await b
    .getByRole("button", { name: "Finish recovery session", exact: true })
    .click({ delay: 2200 });
  assert.equal((await finished).status(), 200);
  await wait(a, "match-status", "COMPLETED");
  await wait(b, "match-status", "COMPLETED");
  assert((await a.locator("#lifecycle-note").textContent())?.includes("recovery complete"));
  await Promise.all(responseChecks);
  assert.deepEqual(unexpectedResponses, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop/mobile click-through: create, refresh/renew invite, join, private selection, uncertain-response identical retry, both recovery loops, paid inspections, component tests, authoritative suitability and temperature refusal, residue reprocessing, private evidence, reconnect, completion, screenshots and no console errors",
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
