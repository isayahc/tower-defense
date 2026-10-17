import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { launchRuntime } from "../tests/helpers/runtime.js";
import { startApp } from "../src/server/app.js";
const checkout = process.env.OI_CHECKOUT;
if (!checkout) throw Error("Set OI_CHECKOUT to the reviewed victory runtime.");
const { GameDatabase } = await import(
  pathToFileURL(resolve(checkout, "server/game-sqlite.mjs")).href
);
const { seedVictoryFixture, armVictoryFixture } = await import(
  pathToFileURL(resolve(checkout, "tests/helpers/victory-fixture.mjs")).href
);
// Curated near-final-blow SQLite fixtures exercise outcomes, not a claim of manufactured stock.
// The engine's dedicated test:victory separately constructs its real ammunition and launcher.
const matches: Record<string, string> = {},
  password = "browser-results-password";
const runtime = await launchRuntime(checkout, {
  prepare: async (database) => {
    const db = new GameDatabase(database);
    try {
      db.tick();
      const a = (await db.authenticate({ username: "resultalice", password }, true)).token,
        b = (await db.authenticate({ username: "resultbob", password }, true)).token;
      for (const outcome of ["win", "loss", "tie"])
        matches[outcome] = seedVictoryFixture(db, a, b, outcome);
    } finally {
      db.close();
    }
  },
});
let browser: Awaited<ReturnType<typeof chromium.launch>>;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
} catch (error) {
  await runtime.close();
  throw error;
}
const app = await startApp({ checkout, serviceUrl: runtime.origin, port: 0 }),
  errors: string[] = [];
async function wait(page: Page, id: string, value: string) {
  await page.waitForFunction(
    ({ id, value }) => document.getElementById(id)?.textContent === value,
    { id, value },
    { timeout: 45000 },
  );
}
async function login(page: Page, username: string) {
  await page.goto(app.origin);
  await wait(page, "badge", "RECOVERY READY");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: false }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await wait(page, "account-badge", "SIGNED IN");
  await wait(page, "game-state", "LIVE");
}
async function open(page: Page, id: string) {
  await page.getByRole("button", { name: `Open match ${id}`, exact: true }).click();
  await wait(page, "match-id", id);
  await wait(page, "game-state", "LIVE");
}
async function current(page: Page, id: string) {
  return page.evaluate(
    async (id) =>
      (
        await (
          await fetch("/api/runtime", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "astra.game_read_match",
              args: { version: 5, match_id: id },
            }),
          })
        ).json()
      ).snapshot,
    id,
  );
}
try {
  await mkdir("test-results", { recursive: true });
  const ca = await browser.newContext(),
    cb = await browser.newContext(),
    a = await ca.newPage(),
    b = await cb.newPage();
  for (const page of [a, b]) page.on("pageerror", (e) => errors.push(e.message));
  await login(a, "resultalice");
  await login(b, "resultbob");
  for (const outcome of ["win", "loss", "tie"]) {
    const id = matches[outcome];
    assert(id);
    await a.setViewportSize(
      outcome === "loss" ? { width: 390, height: 844 } : { width: 1360, height: 980 },
    );
    await b.setViewportSize(
      outcome === "loss" ? { width: 1360, height: 980 } : { width: 390, height: 844 },
    );
    await open(a, id);
    await open(b, id);
    assert.equal((await current(a, id)).status, "active");
    const db = new GameDatabase(join(runtime.directory, "runtime.sqlite"));
    let secrets: string[][];
    try {
      secrets = db
        .load(id)
        .players.map((p: any) => [p.units[0].ammunition_ids[0], p.components[0].id]);
      armVictoryFixture(db, id);
    } finally {
      db.close();
    }
    const ah = outcome === "tie" ? "Tie" : outcome === "win" ? "Victory" : "Defeat",
      bh = outcome === "tie" ? "Tie" : outcome === "win" ? "Defeat" : "Victory";
    await wait(a, "result-heading", ah);
    await wait(b, "result-heading", bh);
    const sa = await current(a, id),
      sb = await current(b, id);
    assert.deepEqual(sa.completion, sb.completion);
    assert.equal(sa.status, "completed");
    for (const secret of secrets[1] ?? []) assert(!JSON.stringify(sa).includes(secret));
    for (const secret of secrets[0] ?? []) assert(!JSON.stringify(sb).includes(secret));
    for (const [i, page] of [a, b].entries()) {
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert(
        await page
          .locator("#match-view [data-mutation]")
          .evaluateAll((nodes) => nodes.every((n) => (n as HTMLButtonElement).disabled)),
      );
      await page
        .locator("#match-result")
        .screenshot({ path: `test-results/result-${outcome}-${i}.png` });
    }
    const rejected = await a.evaluate(
      async ({ id, revision, command }) =>
        (
          await fetch("/api/runtime", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "astra.game_command",
              args: {
                version: 5,
                match_id: id,
                expected_revision: revision,
                command_id: command,
                action: "abandon_match",
              },
            }),
          })
        ).json(),
      { id, revision: sa.revision, command: randomUUID() },
    );
    assert.equal(rejected.error.code, "MATCH_INACTIVE");
    await runtime.restart();
    await a.reload();
    await b.reload();
    await wait(a, "game-state", "LIVE");
    await wait(b, "game-state", "LIVE");
    await open(a, id);
    await open(b, id);
    await wait(a, "result-heading", ah);
    await wait(b, "result-heading", bh);
    assert.deepEqual((await current(a, id)).completion, sa.completion);
    assert.deepEqual((await current(b, id)).completion, sa.completion);
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS actual SQLite/MCP/HTTP result views: victory, defeat and tie on desktop/mobile; equal-time server final blows, matching public records, private inventories, disabled controls, post-match rejection, hard restart and reconnect",
  );
} finally {
  await browser.close();
  await app.close();
  await runtime.close();
}
