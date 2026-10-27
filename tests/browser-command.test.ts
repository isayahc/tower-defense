import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Page, Request, Response } from "playwright";
import { clickCommand } from "../scripts/browser-command.js";

/** Minimal event-driven page double: retain response ordering and controllable click latency. */
function fixture(click: (events: EventEmitter) => Promise<void>) {
  const events = new EventEmitter();
  const locator = {
    and: () => locator,
    first: () => locator,
    click: () => click(events),
  };
  const page = Object.assign(events, {
    getByRole: () => locator,
    locator: () => locator,
    evaluate: async () => ({ state: "LIVE", message: "Saved", robots: "Robot 1" }),
  }) as unknown as Page;
  return { page, events };
}

/** Supply an identifiable runtime request without authentication data. */
function request(action = "recharge_robot", robotId = "robot-1"): Request {
  return {
    url: () => "http://localhost/api/runtime",
    method: () => "POST",
    postDataJSON: () => ({ name: "astra.game_command", args: { action, robot_id: robotId } }),
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  } as unknown as Request;
}

/** Emit a reply associated with the exact request object, as Playwright does. */
function reply(events: EventEmitter, req: Request, status = 200): Response {
  const response = { request: () => req, status: () => status } as unknown as Response;
  events.emit("response", response);
  return response;
}

/** Ensure completed and failed attempts leave no observers behind. */
function clean(events: EventEmitter): void {
  for (const event of ["request", "response", "requestfailed"])
    assert.equal(events.listenerCount(event), 0);
}

test("click latency does not consume response budget; fast responses are retained", async () => {
  const { page, events } = fixture(async (events) => {
    await delay(60);
    const req = request();
    events.emit("request", req);
    reply(events, req);
  });
  assert.equal((await clickCommand(page, "Recharge", { responseTimeout: 10 })).status(), 200);
  clean(events);
});

test("ignores old replies and unrelated robot commands; preserves server rejection", async () => {
  const old = request();
  const { page, events } = fixture(async (events) => {
    reply(events, old);
    for (const req of [request("survey_robot"), request("recharge_robot", "robot-2")]) {
      events.emit("request", req);
      reply(events, req);
    }
    const wanted = request();
    events.emit("request", wanted);
    reply(events, wanted, 409);
  });
  assert.equal(
    (
      await clickCommand(page, "Recharge", { action: "recharge_robot", robotId: "robot-1" })
    ).status(),
    409,
  );
  clean(events);
});

test("a missing response fails without retry and saves transport/UI diagnostics", async () => {
  await mkdir("test-results", { recursive: true });
  let clicks = 0;
  const { page, events } = fixture(async (events) => {
    clicks++;
    const req = request();
    events.emit("request", req);
    events.emit("requestfailed", req);
  });
  await assert.rejects(
    clickCommand(page, "Missing response regression", { responseTimeout: 10 }),
    /response phase failed/,
  );
  assert.equal(clicks, 1);
  clean(events);
  const files = (await readdir("test-results")).filter((p) =>
    p.startsWith("command-Missing-response-regression-"),
  );
  const report = JSON.parse(await readFile(`test-results/${files.sort().at(-1)}`, "utf8"));
  assert.equal(report.matchingRequests, 1);
  assert.equal(report.state.state, "LIVE");
  assert(report.events.some((e: { event: string }) => e.event === "requestfailed"));
});

test("an unavailable button reports the click phase and cleans up", async () => {
  await mkdir("test-results", { recursive: true });
  const { page, events } = fixture(async () => {
    throw new Error("button stayed disabled");
  });
  await assert.rejects(clickCommand(page, "Disabled button regression"), /click phase failed/);
  clean(events);
});
