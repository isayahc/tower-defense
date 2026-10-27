import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { startApp } from "../src/server/app.js";
import { launchRuntime } from "../tests/helpers/runtime.js";
import { clickCommand } from "./browser-command.js";

const checkout = process.env.OI_CHECKOUT;
if (!checkout) throw new Error("Set OI_CHECKOUT to the SQLite runtime checkout.");
const { GameDatabase } = await import(
  pathToFileURL(resolve(checkout, "server/game-sqlite.mjs")).href
);
const { seedVictoryFixture } = await import(
  pathToFileURL(resolve(checkout, "tests/helpers/victory-fixture.mjs")).href
);
const password = "browser-gesture-password";
let match = "";
const runtime = await launchRuntime(checkout, {
  prepare: async (database) => {
    const db = new GameDatabase(database);
    try {
      db.tick();
      const a = (await db.authenticate({ username: "gesturealice", password }, true)).token;
      const b = (await db.authenticate({ username: "gesturebob", password }, true)).token;
      match = seedVictoryFixture(db, a, b, "win");
    } finally {
      db.close();
    }
  },
});
const app = await startApp({ checkout, serviceUrl: runtime.origin, port: 0 });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  await mkdir("test-results", { recursive: true });
  for (const [width, username] of [
    [1360, "gesturealice"],
    [390, "gesturebob"],
  ] as const) {
    const context = await browser.newContext({ viewport: { width, height: 980 } });
    const page = await context.newPage();
    let rechargeRequests = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/runtime") &&
        request.postDataJSON()?.args?.action === "recharge_robot"
      )
        rechargeRequests++;
    });
    // Run the real polling callback at the pointerup/click boundary, without mocking
    // a response, mutating a snapshot, or invoking the command handler ourselves.
    await page.addInitScript(() => {
      const timers = window as unknown as {
        poll?: () => void;
        gestureEvents: object[];
        setInterval: (handler: TimerHandler, timeout?: number, ...args: unknown[]) => number;
      };
      timers.gestureEvents = [];
      const interval = timers.setInterval.bind(window);
      timers.setInterval = (handler, timeout, ...args) => {
        if (timeout === 2000 && typeof handler === "function") timers.poll = () => handler(...args);
        return interval(handler, timeout, ...args);
      };
      for (const type of ["pointerdown", "pointerup", "click"])
        window.addEventListener(type, (event) => {
          const target = event.target;
          if (target instanceof HTMLButtonElement)
            timers.gestureEvents.push({
              type,
              label: target.textContent,
              disabled: target.disabled,
              trusted: event.isTrusted,
            });
        });
    });
    const live = () =>
      page.waitForFunction(() => document.getElementById("game-state")?.textContent === "LIVE");
    try {
      await page.goto(app.origin);
      await page.getByLabel("Username", { exact: true }).fill(username);
      await page.getByLabel("Password", { exact: false }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await live();
      await page.getByRole("button", { name: `Open match ${match}`, exact: true }).click();
      await live();
      const robotId = await page.locator("#robots > .job").first().getAttribute("data-robot-id");
      assert(robotId);
      await page.evaluate(() => {
        const timers = window as unknown as { poll?: () => void; gestureEvents: object[] };
        if (!timers.poll) throw new Error("Polling callback not installed");
        window.addEventListener(
          "pointerup",
          () => {
            timers.poll?.();
            timers.gestureEvents.push({
              type: "forced-poll",
              state: document.getElementById("game-state")?.textContent,
            });
          },
          { once: true },
        );
      });
      const response = await clickCommand(page, "Return and recharge · robot 1", {
        action: "recharge_robot",
        robotId,
      });
      assert.equal(response.status(), 200, JSON.stringify(await response.json()));
      await live();
      assert.equal(rechargeRequests, 1, "One user gesture must send exactly one recharge");
      const gesture = await page.evaluate(() => {
        const { gestureEvents } = window as unknown as {
          gestureEvents: Array<{ type: string; state?: string; label?: string; trusted?: boolean }>;
        };
        return {
          polling: gestureEvents.some(
            (event) => event.type === "forced-poll" && event.state === "SYNCING",
          ),
          clicks: gestureEvents.filter(
            (event) =>
              event.type === "click" &&
              event.label === "Return and recharge · robot 1" &&
              event.trusted,
          ).length,
        };
      });
      assert(gesture.polling, "The real poll must overlap the gesture");
      assert.equal(
        gesture.clicks,
        1,
        "The native click must reach the button handler exactly once",
      );
      await page.locator("#robots").screenshot({ path: `test-results/gesture-${width}.png` });
    } finally {
      const events = await page.evaluate(
        () => (window as unknown as { gestureEvents: object[] }).gestureEvents,
      );
      await writeFile(`test-results/gesture-${width}.json`, JSON.stringify(events, null, 2));
      await context.close();
    }
  }
  console.log(
    "PASS desktop/mobile recharge gesture survives polling at pointerup without repeated mutation",
  );
} finally {
  await browser.close();
  await app.close();
  await runtime.close();
}
