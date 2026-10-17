import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { startApp } from "../src/server/app.js";
import { launchRuntime } from "../tests/helpers/runtime.js";

const fullMatch = process.argv.includes("--full");
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
  await wait(page, "badge", "MATCH READY");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: false }).fill(password);
  if (register) await page.getByLabel("Create a new account").check();
  await page
    .getByRole("button", { name: register ? "Create account" : "Sign in", exact: true })
    .click();
  await wait(page, "account-badge", "SIGNED IN");
  await wait(page, "game-state", "LIVE");
  assert(await page.getByRole("button", { name: "Start full match" }).isEnabled());
  assert.equal(await page.evaluate(() => document.cookie), "");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert((await page.context().cookies()).every((c) => c.httpOnly && c.sameSite === "Strict"));
}
async function press(page: Page, name: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(page, "game-state", "LIVE");
    const pending = page.waitForResponse((response) => {
      if (response.url().endsWith("/api/matches")) return true;
      if (!response.url().endsWith("/api/runtime")) return false;
      const operation = response.request().postDataJSON()?.name;
      return ![
        "astra.game_read_match",
        "astra.game_list_matches",
        "astra.game_science_catalog",
        "astra.game_manufacturing_catalog",
      ].includes(operation);
    });
    void pending.catch(() => {});
    await page
      .getByRole("button", { name, exact: true })
      .and(page.locator(":enabled"))
      .first()
      .click();
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

/** Recover and use non-cable material through real desktop/mobile controls and server previews. */
async function recoverFamily(page: Page, slot: number, kind: string, recipe: string, use: string) {
  await press(page, "Return and recharge · robot 1");
  await page.waitForFunction(
    () => {
      const text = document.querySelector("#robots > .job")?.textContent ?? "";
      return text.includes("8.00 / 8 kJ") && text.includes("Ready for dispatch");
    },
    undefined,
    { timeout: 45000 },
  );
  await page.getByLabel("Select a waste site").selectOption({ label: `Crew ${slot} · ${kind}` });
  await press(page, "Survey with camera-depth · robot 1");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#robots button")].some(
        (b) =>
          b.textContent === "Collect unclassified · robot 1" && !(b as HTMLButtonElement).disabled,
      ),
    undefined,
    { timeout: 45000 },
  );
  const before = await page.locator("#batches .batch").count();
  await press(page, "Collect unclassified · robot 1");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#batches .batch").length === n + 1,
    before,
    { timeout: 45000 },
  );
  const input = await page
    .locator("#science-target option")
    .filter({ hasText: /^mixed/ })
    .getAttribute("value");
  assert(input);
  await press(page, "Inspect recovered batch · 3 s / 300 J");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#jobs .job")].every(
        (j) => j.getAttribute("data-state") === "completed",
      ),
    undefined,
    { timeout: 45000 },
  );
  if (kind === "vehicle")
    assert((await page.locator("#batches").textContent())?.includes("Suspect battery/electronic"));
  await page.getByLabel("Evaluation", { exact: true }).selectOption("process");
  await page.getByLabel("Owned material or component").selectOption(input);
  await page.getByLabel("Design or recipe").selectOption(recipe);
  await press(page, "Check suitability");
  if ((await page.locator("#science-result").textContent())?.includes("INSUFFICIENT_ENERGY")) {
    // Earlier recovery/construction spent real shared charge. Wait for measured solar, then request a fresh preview.
    await page.waitForFunction(
      () => Number.parseFloat(document.getElementById("power-reading")?.textContent ?? "0") >= 11,
      undefined,
      { timeout: 120000 },
    );
    await press(page, "Check suitability");
  }
  const processPreview = await page.locator("#science-result").textContent();
  assert(
    processPreview?.includes("Eligible under this game design"),
    processPreview ?? "Missing server process preview",
  );
  await press(page, "Start approved process");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#jobs .job")].every(
        (j) => j.getAttribute("data-state") === "completed",
      ),
    undefined,
    { timeout: 45000 },
  );
  const usable = await page
    .locator("#science-target option")
    .filter({ hasText: /^usable/ })
    .last()
    .getAttribute("value");
  assert(usable);
  await press(page, "Inspect usable · 3 s / 300 J");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#jobs .job")].every(
        (j) => j.getAttribute("data-state") === "completed",
      ),
    undefined,
    { timeout: 45000 },
  );
  await page.getByLabel("Evaluation", { exact: true }).selectOption("use");
  await page.getByLabel("Owned material or component").selectOption(usable);
  await page.getByLabel("Design or recipe").selectOption(use);
  await page.getByLabel("Operating temperature (°C)").fill("20");
  await press(page, "Check suitability");
  assert(
    (await page.locator("#science-result").textContent())?.includes(
      "Eligible under this game design",
    ),
  );
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({
    path: `test-results/${kind}-recovery-${page.viewportSize()?.width}.png`,
    fullPage: true,
  });
}

/** Use only visible owned choices; the server validates each exact bill of materials. */
async function manufacturePart(
  page: Page,
  recipe: string,
  grade: string,
  minimumKg: number,
  checkStalePreview = false,
) {
  await page.getByLabel("Manufacturing recipe", { exact: true }).selectOption(recipe);
  const options = await page
    .locator("#production-batches option")
    .evaluateAll((options) =>
      options.map((o) => ({ id: (o as HTMLOptionElement).value, label: o.textContent ?? "" })),
    );
  const input = options
    .filter(
      (o) => o.label.startsWith(grade) && Number(/· ([0-9.]+) kg/.exec(o.label)?.[1]) >= minimumKg,
    )
    .sort(
      (a, b) =>
        Number(/· ([0-9.]+) kg/.exec(a.label)?.[1]) - Number(/· ([0-9.]+) kg/.exec(b.label)?.[1]),
    )[0];
  assert(input);
  await page.getByLabel("Material batches", { exact: true }).selectOption(input.id);
  await page.getByLabel("Manufactured parts", { exact: true }).selectOption([]);
  await page.getByLabel("Tested component stock", { exact: true }).selectOption([]);
  if (checkStalePreview) {
    let entered!: () => void, release!: () => void;
    const seen = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    let held = false;
    const intercept = async (route: import("playwright").Route) => {
      if (!held && route.request().postDataJSON()?.name === "astra.game_manufacturing_preview") {
        held = true;
        const response = await route.fetch();
        entered();
        await gate;
        await route.fulfill({ response });
      } else await route.continue();
    };
    await page.route("**/api/runtime", intercept);
    const pending = press(page, "Review bill of materials");
    await seen;
    await page.getByLabel("Manufacturing recipe", { exact: true }).selectOption("metal-press");
    release();
    await pending;
    assert(
      await page
        .getByRole("button", { name: "Queue approved manufacture", exact: true })
        .isDisabled(),
    );
    await page.unroute("**/api/runtime", intercept);
    await page.getByLabel("Manufacturing recipe", { exact: true }).selectOption(recipe);
  }
  await press(page, "Review bill of materials");
  assert(
    (await page.locator("#production-result").textContent())?.includes(
      "Exact inputs will be reserved",
    ),
  );
  await press(page, "Queue approved manufacture");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#production-jobs .job")].every(
        (j) => j.getAttribute("data-state") === "completed",
      ),
    undefined,
    { timeout: 45000 },
  );
}
async function constructPress(page: Page) {
  await manufacturePart(page, "steel-bracket", "game-steel-v1", 1, true);
  await manufacturePart(page, "steel-bracket", "game-steel-v1", 1);
  await manufacturePart(page, "copper-conductor", "game-copper-v1", 0.1);
  await page.getByLabel("Manufacturing recipe", { exact: true }).selectOption("metal-press");
  await page.getByLabel("Material batches", { exact: true }).selectOption([]);
  const parts = await page
    .locator("#production-products option")
    .evaluateAll((options) =>
      options.map((o) => ({ id: (o as HTMLOptionElement).value, label: o.textContent ?? "" })),
    );
  await page
    .getByLabel("Manufactured parts", { exact: true })
    .selectOption(
      parts
        .filter(
          (o) => o.label.startsWith("steel-bracket") || o.label.startsWith("copper-conductor"),
        )
        .map((o) => o.id),
    );
  const fastener = await page
    .locator("#production-components option")
    .filter({ hasText: /fastener/ })
    .getAttribute("value");
  assert(fastener);
  await page.getByLabel("Tested component stock", { exact: true }).selectOption(fastener);
  await press(page, "Review bill of materials");
  assert(
    (await page.locator("#production-result").textContent())?.includes(
      "Exact inputs will be reserved",
    ),
  );
  await press(page, "Queue approved manufacture");
  await page
    .getByRole("button", { name: "Disable metal-press", exact: true })
    .waitFor({ timeout: 45000 });
  await press(page, "Disable metal-press");
  await press(page, "Enable metal-press");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page
    .locator(".production-panel")
    .screenshot({ path: "test-results/manufacturing-desktop.png" });
}
/** Assemble exact visible part counts and tested hardware, through the authoritative preview. */
async function assemble(
  page: Page,
  recipe: string,
  demands: Record<string, number>,
  hardware: string[],
) {
  await page.getByLabel("Manufacturing recipe", { exact: true }).selectOption(recipe);
  await page.getByLabel("Material batches", { exact: true }).selectOption([]);
  const parts = await page
    .locator("#production-products option")
    .evaluateAll((options) =>
      options.map((o) => ({ id: (o as HTMLOptionElement).value, label: o.textContent ?? "" })),
    );
  const ids = Object.entries(demands).flatMap(([kind, count]) => {
    const found = parts.filter((o) => o.label.startsWith(kind + " ·")).slice(0, count);
    assert.equal(found.length, count);
    return found.map((o) => o.id);
  });
  await page.getByLabel("Manufactured parts", { exact: true }).selectOption(ids);
  const components = await page
    .locator("#production-components option")
    .evaluateAll((options) =>
      options.map((o) => ({ id: (o as HTMLOptionElement).value, label: o.textContent ?? "" })),
    );
  const componentIds = hardware.flatMap((kind) => {
    let remaining =
      kind === "fastener" || (recipe === "raid-launcher" && ["motor", "wheel"].includes(kind))
        ? 2
        : 1;
    const ids: string[] = [];
    for (const c of components.filter((o) => o.label.includes(" × " + kind + " ·"))) {
      if (remaining <= 0) break;
      ids.push(c.id);
      remaining -= Number(/^(\d+) ×/.exec(c.label)?.[1] ?? 0);
    }
    assert(remaining <= 0, "Missing tested " + kind);
    return ids;
  });
  await page.getByLabel("Tested component stock", { exact: true }).selectOption(componentIds);
  await press(page, "Review bill of materials");
  assert(
    (await page.locator("#production-result").textContent())?.includes(
      "Exact inputs will be reserved",
    ),
  );
  await press(page, "Queue approved manufacture");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#production-jobs .job")].every(
        (j) => j.getAttribute("data-state") === "completed",
      ),
    undefined,
    { timeout: 45000 },
  );
}
/** Real recovered stock and original tested hardware become a supplied platform on desktop/mobile. */
async function constructTurret(page: Page, rival: Page) {
  await recoverFamily(page, 1, "packaging", "bench-trim-hdpe", "hdpe-housing");
  await press(page, "Return and recharge · robot 2");
  await page.waitForFunction(
    () => {
      const t = document.querySelectorAll("#robots > .job")[1]?.textContent ?? "";
      return t.includes("8.00 / 8 kJ") && t.includes("Ready for dispatch");
    },
    undefined,
    { timeout: 45000 },
  );
  await page.locator("details.equipment > summary").click();
  for (const label of ["Fabricator", "Scavenger 02"]) {
    await page.locator("#assets details").filter({ hasText: label }).locator("summary").click();
    await press(page, "Dismantle " + label + " for components");
  }
  for (const kind of [
    "drive",
    "controller",
    "motor",
    "camera",
    ...(fullMatch ? ["wheel", "robot-battery"] : []),
  ]) {
    while (
      await page
        .getByRole("button", { name: "Test " + kind + " · 3 s / 300 J", exact: true })
        .and(page.locator(":enabled"))
        .count()
    ) {
      await press(page, "Test " + kind + " · 3 s / 300 J");
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("#jobs .job")].every(
            (j) => j.getAttribute("data-state") === "completed",
          ),
        undefined,
        { timeout: 45000 },
      );
    }
  }
  await manufacturePart(page, "steel-bracket", "game-steel-v1", 1);
  await manufacturePart(page, "copper-conductor", "game-copper-v1", 0.1);
  await assemble(page, "fabricator", { "steel-bracket": 1, "copper-conductor": 1 }, [
    "drive",
    "controller",
    "fastener",
  ]);
  if (fullMatch) {
    await recoverFamily(page, 1, "construction", "bench-recover-steel", "steel-bracket");
    await recoverFamily(page, 1, "tire", "bench-cut-tire", "traction-tread");
    await manufacturePart(page, "steel-chassis", "game-steel-v1", 8);
    await manufacturePart(page, "copper-conductor", "game-copper-v1", 0.1);
    await manufacturePart(page, "hdpe-housing", "game-hdpe-v1", 0.2);
    for (let i = 0; i < 2; i++)
      await manufacturePart(page, "traction-tread", "game-rubber-v1", 0.5);
    await assemble(
      page,
      "raid-launcher",
      { "steel-chassis": 1, "copper-conductor": 1, "hdpe-housing": 1, "traction-tread": 2 },
      ["motor", "wheel", "controller", "robot-battery", "fastener"],
    );
    for (let i = 0; i < 6; i++) await manufacturePart(page, "steel-slug", "game-steel-v1", 0.25);
    const unit = page.locator("#units-list .job").filter({ hasText: "raid-launcher" });
    const unitId = await unit.getAttribute("data-unit-id");
    assert(unitId);
    const suffix = `raid-launcher ${unitId.slice(0, 8)}`;
    await page.getByLabel("Deployment X", { exact: true }).fill("47");
    await page.getByLabel("Deployment Y", { exact: true }).fill("24");
    await press(page, `Deploy ${suffix} (1000 J)`);
    await press(page, `Load steel slug into ${suffix}`);
    await press(page, `Load steel slug into ${suffix}`);
    await press(page, `Enable ${suffix}`);
    return suffix;
  }
  for (let i = 0; i < 2; i++) await manufacturePart(page, "steel-bracket", "game-steel-v1", 1);
  await manufacturePart(page, "copper-conductor", "game-copper-v1", 0.1);
  await manufacturePart(page, "hdpe-housing", "game-hdpe-v1", 0.2);
  await assemble(
    page,
    "sentry-turret",
    { "steel-bracket": 2, "copper-conductor": 1, "hdpe-housing": 1 },
    ["motor", "camera", "controller", "fastener"],
  );
  await manufacturePart(page, "steel-slug", "game-steel-v1", 0.25);
  const card = page.locator("#units-list .job").filter({ hasText: "sentry-turret" });
  const unitId = await card.getAttribute("data-unit-id");
  assert(unitId);
  const suffix = "sentry-turret " + unitId.slice(0, 8);
  await page
    .getByLabel("Deployment X", { exact: true })
    .fill(process.argv.includes("--combat") ? "11" : "38");
  await page.getByLabel("Deployment Y", { exact: true }).fill("24");
  await page.waitForFunction(
    () => Number.parseFloat(document.getElementById("power-reading")?.textContent ?? "0") >= 2,
    undefined,
    { timeout: 45000 },
  );
  await press(page, "Deploy " + suffix + " (500 J)");
  await press(page, "Load steel slug into " + suffix);
  await press(page, "Enable " + suffix);
  assert((await card.textContent())?.includes("1 / 4 steel slugs"));
  assert((await card.textContent())?.includes("combat-not-started"));
  assert.equal(await page.locator('circle[data-unit-id="' + unitId + '"]').count(), 1);
  if (process.argv.includes("--combat")) {
    await press(page, "Begin combat");
    const rejected = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/runtime") && r.request().postDataJSON()?.args.order === "target",
    );
    await page.getByRole("button", { name: "Hold and target with " + suffix, exact: true }).click();
    assert.equal((await rejected).status(), 400);
    await wait(page, "game-state", "LIVE");
    assert((await page.locator("#game-message").textContent())?.includes("range"));
    await press(page, "Defend with " + suffix);
    await rival.getByLabel("Select a waste site").selectOption({ label: "Crew 1 · cable" });
    await press(rival, "Survey with camera-depth · robot 1");
    await page.waitForFunction(
      () => document.getElementById("combat-targets")?.textContent?.includes("55 / 80 health"),
      undefined,
      { timeout: 45000 },
    );
    assert((await card.textContent())?.includes("0 / 4 steel slugs"));
    await press(rival, "Retreat and unload · robot 1");
  }
  await page.locator(".production-panel").screenshot({ path: "test-results/unit-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await wait(page, "match-status", "ACTIVE");
  await page.getByRole("button", { name: "Disable " + suffix, exact: true }).waitFor();
  await press(page, "Disable " + suffix);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator(".production-panel").screenshot({ path: "test-results/unit-mobile.png" });
  await press(page, "Salvage " + suffix + " (300 J)");
  await page.waitForFunction(
    () => document.getElementById("units-list")?.textContent?.includes("salvaged"),
    undefined,
    { timeout: 15000 },
  );
  await page.setViewportSize({ width: 1360, height: 980 });
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
          const knownRangeRejection =
            path === "/api/runtime" &&
            response.status() === 400 &&
            body?.error?.code === "COMBAT_RANGE" &&
            input?.args?.order === "target";
          if (!knownConflict && !knownRangeRejection)
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
  await press(a, fullMatch ? "Start full match" : "Create match");
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
  await press(b, "Join match");
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
  // Hold a real background read: sign-out must stop new polls and wait, not hit the busy-session gate.
  let releaseRead!: () => void;
  let enteredRead!: () => void;
  const readHeld = new Promise<void>((resolve) => {
    enteredRead = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let held = false;
  await a.route("**/api/runtime", async (route) => {
    if (!held && route.request().postDataJSON()?.name === "astra.game_read_match") {
      held = true;
      enteredRead();
      await release;
    }
    await route.continue();
  });
  await readHeld;
  const signedOut = a.waitForResponse(
    (response) =>
      response.url().endsWith("/api/session") && response.request().method() === "DELETE",
  );
  await a.getByRole("button", { name: "Sign out", exact: true }).click();
  await wait(a, "game-state", "DISCONNECTED");
  assert.equal(await a.locator("#account-badge").textContent(), "SIGNED IN");
  releaseRead();
  assert.equal((await signedOut).status(), 200);
  await wait(a, "account-badge", "SIGNED OUT");
  await a.unroute("**/api/runtime");
  await signIn(a, "alice", false);
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
  // A crew command invalidates the shared revision and clears the other crew's preview.
  // Keep these approval/click flows sequential so neither test races a stale approval.
  await recoverFamily(a, 1, "construction", "bench-recover-steel", "steel-bracket");
  await constructPress(a);
  const launcher = await constructTurret(a, b);
  await recoverFamily(b, 2, "vehicle", "isolate-vehicle", "aluminum-housing");
  await manufacturePart(b, "copper-conductor", "game-copper-v1", 0.1);
  await b
    .locator(".production-panel")
    .screenshot({ path: "test-results/manufacturing-mobile.png" });
  await press(a, "Return and recharge · robot 1");
  await a.waitForFunction(
    () => document.getElementById("robots")?.textContent?.includes("8.00 / 8 kJ"),
    undefined,
    { timeout: 45000 },
  );
  // Use a distant site so a real travel phase remains active while interruption is clicked.
  await a.getByLabel("Select a waste site").selectOption({ label: "Crew 2 · glass" });
  await press(a, "Survey with camera-depth · robot 1");
  await press(a, "Interrupt · robot 1");
  await press(a, "Retreat and unload · robot 1");
  if (fullMatch) {
    assert(launcher);
    await press(a, "Begin combat");
    const tower = await a
      .locator("#combat-target option")
      .filter({ hasText: "Crew 2 · tower" })
      .getAttribute("value");
    assert(tower);
    await a.getByLabel("Combat target", { exact: true }).selectOption(tower);
    // Every shot uses a real manufactured slug.
    for (let wave = 0; wave < 3; wave++) {
      if (wave > 0) {
        await press(a, `Disable ${launcher}`);
        await press(a, `Load steel slug into ${launcher}`);
        await press(a, `Load steel slug into ${launcher}`);
        await press(a, `Enable ${launcher}`);
      }
      await a.getByLabel("Combat target", { exact: true }).selectOption(tower);
      await press(a, `Attack target with ${launcher}`);
      if (wave < 2)
        await a.waitForFunction(
          () => document.getElementById("units-list")?.textContent?.includes("0 / 2 steel slugs"),
          undefined,
          { timeout: 90000 },
        );
      if (wave === 0) {
        await runtime.restart();
        await a.reload();
        await b.reload();
        await wait(a, "match-status", "ACTIVE");
        await wait(b, "match-status", "ACTIVE");
        await wait(a, "game-state", "LIVE");
      }
    }
    await wait(a, "result-heading", "Victory");
    await wait(b, "result-heading", "Defeat");
    const finalRecord = await a.locator("#result-record").textContent();
    assert.equal(await b.locator("#result-record").textContent(), finalRecord);
    await runtime.restart();
    for (const page of [a, b]) {
      await page.reload();
      await wait(page, "game-state", "LIVE");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(
        await page
          .locator("#match-view [data-mutation]")
          .evaluateAll((nodes) => nodes.every((n) => (n as HTMLButtonElement).disabled)),
      );
    }
    await wait(a, "result-heading", "Victory");
    await wait(b, "result-heading", "Defeat");
    assert.equal(await a.locator("#result-record").textContent(), finalRecord);
    assert.equal(await b.locator("#result-record").textContent(), finalRecord);
    await a.locator("#match-result").screenshot({ path: "test-results/full-match-victory.png" });
    await b.locator("#match-result").screenshot({ path: "test-results/full-match-defeat.png" });
    console.log(
      "PASS full two-browser match: authenticated startup, invite/join, real recovery, tested components, manufactured launcher and six slugs, server-owned tower destruction, desktop victory/mobile defeat and hard restart/reconnect",
    );
  } else if (process.argv.includes("--combat")) {
    a.on("dialog", async (dialog) => {
      assert.equal(dialog.type(), "confirm");
      await dialog.accept();
    });
    await press(a, "End session for both crews");
    await wait(a, "match-status", "COMPLETED");
    await wait(b, "match-status", "COMPLETED");
    console.log(
      "PASS real desktop/mobile manufactured combat: defend order, server shot and ammo use, rival hauler damage, private materials, mobile reconnect, disable, home-side timed salvage, end session and no console errors",
    );
  } else {
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
  }
  await Promise.all(responseChecks);
  assert.deepEqual(unexpectedResponses, []);
  assert.deepEqual(errors, []);
  if (!fullMatch)
    console.log(
      "PASS desktop/mobile click-through: create, refresh/renew invite, join, private selection, uncertain-response identical retry, both recovery loops, paid inspections, component tests, authoritative suitability and temperature refusal, residue reprocessing, steel recovery, vehicle isolation and aluminum use, desktop press/turret construction, metered deployment and ammo, mobile unit reconnect/disable/salvage and mobile component manufacture, private evidence, reconnect, completion, screenshots and no console errors",
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
