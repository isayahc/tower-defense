import { createServer } from "node:http";
import { contract } from "../src/integration/contract.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GameAdapter } from "../src/integration/adapter.js";
import { discoverOpenIndustries } from "../src/integration/discovery.js";
import { startApp } from "../src/server/app.js";
import { launchRuntime } from "../tests/helpers/runtime.js";

const checkout = process.env.OI_CHECKOUT;
if (!checkout) throw new Error("Set OI_CHECKOUT to the documented SQLite runtime checkout.");
const runtime = await launchRuntime(checkout);
const app = await startApp({ checkout, serviceUrl: runtime.origin, port: 0 });
const headers = { origin: app.origin, "content-type": "application/json" };
const command = () => ({ version: 5, command_id: randomUUID() });
const password = "test-only-long-password";
async function register(username: string) {
  const response = await fetch(`${app.origin}/api/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "register", username, password }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { authenticated: true });
  const cookie = response.headers.get("set-cookie");
  assert(cookie);
  assert(cookie.includes("HttpOnly"));
  assert(cookie.includes("SameSite=Strict"));
  return cookie.split(";")[0] as string;
}
async function call(cookie: string, name: string, args: unknown) {
  const response = await fetch(`${app.origin}/api/runtime`, {
    method: "POST",
    headers: { ...headers, cookie },
    body: JSON.stringify({ name: `astra.game_${name}`, args }),
  });
  return { status: response.status, body: await response.json() };
}
try {
  // Correct protocol version and live worker are insufficient when the service advertises an old contract.
  let unexpectedAuth = 0;
  const incompatibleService = createServer((req, res) => {
    if (req.url !== "/health") unexpectedAuth++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        version: 5,
        scheduler_healthy: true,
        contract: { ...contract, ready_for_full_game: false },
      }),
    );
  });
  await new Promise<void>((done) => incompatibleService.listen(0, "127.0.0.1", done));
  const address = incompatibleService.address();
  assert(address && typeof address !== "string");
  const incompatible = await startApp({
    checkout,
    serviceUrl: `http://127.0.0.1:${address.port}`,
    port: 0,
  });
  try {
    const status = await (await fetch(`${incompatible.origin}/api/integration`)).json();
    assert.equal(status.canStartMatch, false);
    assert.equal(status.state, "incompatible");
    const refused = await fetch(`${incompatible.origin}/api/session`, {
      method: "POST",
      headers: { origin: incompatible.origin, "content-type": "application/json" },
      body: JSON.stringify({ mode: "login", username: "alice", password }),
    });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error.code, "CONTRACT_MISMATCH");
    assert.equal(unexpectedAuth, 0);
  } finally {
    await incompatible.close();
    incompatibleService.closeAllConnections();
    await new Promise<void>((done) => incompatibleService.close(() => done()));
  }
  const discovery = await discoverOpenIndustries(checkout);
  const installed = new Set(discovery.tools.map((tool) => tool.name));
  for (const name of [
    "describe",
    "create_match",
    "join_match",
    "read_match",
    "command",
    "science_catalog",
    "evaluate",
  ])
    assert(installed.has(`astra.game_${name}`), `Missing required game tool: ${name}`);
  assert(installed.has("astra.simulation_describe"));
  assert.equal(discovery.readiness.processingContractVerified, true);
  assert.equal(discovery.readiness.canStartMatch, true);
  const a = await register("alice"),
    b = await register("bob"),
    c = await register("outsider");
  assert.notEqual(a, b);
  const createdRequest = command();
  const startup = async (args: unknown) => {
    const response = await fetch(`${app.origin}/api/matches`, {
      method: "POST",
      headers: { ...headers, cookie: a },
      body: JSON.stringify(args),
    });
    return { status: response.status, body: await response.json() };
  };
  const created = await startup(createdRequest);
  assert.equal(created.status, 200);
  const id = created.body.snapshot.match_id;
  assert.deepEqual((await startup(createdRequest)).body, created.body);
  assert.equal((await startup({ ...command(), player_id: "bob" })).status, 400);
  const readiness = await (await fetch(`${app.origin}/api/integration`)).json();
  assert.equal(readiness.state, "ready");
  assert.equal(readiness.canStartMatch, true);
  const joined = await call(b, "join_match", {
    ...command(),
    match_id: id,
    invite_code: created.body.invite_code,
  });
  assert.equal(joined.status, 200);
  const readArgs = { version: 5, match_id: id };
  assert.equal((await call(c, "read_match", readArgs)).body.error.code, "NOT_AVAILABLE");
  assert.equal(
    (
      await call(c, "join_match", {
        ...command(),
        match_id: id,
        invite_code: created.body.invite_code,
      })
    ).body.error.code,
    "NOT_AVAILABLE",
  );
  const read = async () => {
    const result = await call(a, "read_match", readArgs);
    assert.equal(result.status, 200);
    return result.body.snapshot;
  };
  const action = async (action: string, target: Record<string, string>) =>
    call(a, "command", {
      ...command(),
      match_id: id,
      expected_revision: (await read()).revision,
      action,
      ...target,
    });
  const initial = await read();
  const robot_id = initial.field.robots[0].id;
  const deposit_id = initial.deposits[0].id;
  async function until(predicate: (s: typeof initial) => boolean) {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const state = await read();
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Robot progression timed out");
  }
  assert.equal(
    (await action("return_robot", { robot_id: joined.body.snapshot.field.robots[0].id })).body.error
      .code,
    "NOT_AVAILABLE",
  );
  assert.equal((await action("collect_deposit", { deposit_id })).body.error.code, "ROBOT_REQUIRED");
  assert.equal(
    (await action("survey_robot", { robot_id, deposit_id, sensor: "camera-depth", energy_mj: "0" }))
      .status,
    400,
  );
  const surveyed = await action("survey_robot", { robot_id, deposit_id, sensor: "camera-depth" });
  assert.equal(surveyed.status, 200);
  const observed = await until((s) => s.field.observations.length > 0);
  const observation_id = observed.field.observations[0].id;
  const request = {
    ...command(),
    match_id: id,
    expected_revision: observed.revision,
    action: "collect_robot",
    robot_id,
    deposit_id,
    observation_id,
    material_class: "unclassified",
  };
  const accepted = await call(a, "command", request);
  assert.equal(accepted.status, 200);
  assert.deepEqual((await call(a, "command", request)).body, accepted.body);
  const hauling = await until((s) => s.field.robots[0].cargo.length > 0);
  assert.equal(hauling.field.robots[0].cargo[0].mass_g, 10000);
  assert.equal(hauling.batches.length, 0);
  await runtime.restart();
  assert.deepEqual((await call(a, "command", request)).body, accepted.body);
  assert.equal((await call(b, "read_match", readArgs)).body.snapshot.field.observations.length, 0);
  const unloaded = await until((s) => s.batches.length === 1);
  assert.equal(unloaded.field.robots[0].cargo.length, 0);
  assert.equal(unloaded.batches[0].copper_g, null);
  assert.equal(
    (
      await action("collect_robot", {
        robot_id: initial.field.robots[1].id,
        deposit_id,
        observation_id,
        material_class: "unclassified",
      })
    ).body.error.code,
    "STALE_TARGET",
  );
  assert.equal(
    (
      await call(a, "command", {
        ...command(),
        match_id: id,
        expected_revision: initial.revision,
        action: "return_robot",
        robot_id,
      })
    ).body.error.code,
    "CONFLICT",
  );
  const inspected = await action("inspect_batch", { batch_id: unloaded.batches[0].id });
  assert.equal(inspected.status, 200);
  await until((s) => s.batches[0].copper_g !== null);
  const started = await action("start_processing", {
    batch_id: unloaded.batches[0].id,
    machine_id: initial.machines[0].id,
  });
  assert.equal(started.status, 200);
  assert.equal((await action("recharge_robot", { robot_id })).status, 200);
  const charging = await until((s) => s.field.jobs.at(-1).reason === "base-busy");
  assert(charging.field.robots[0].energy_mj < 8000000);
  const denied = await fetch(`${app.origin}/api/matches`, {
    method: "POST",
    headers: { ...headers, cookie: a },
    body: "{}",
  });
  assert.equal((await denied.json()).error.code, "INVALID_REQUEST");
  const crossSite = await fetch(`${app.origin}/api/runtime`, {
    method: "POST",
    headers: { ...headers, origin: "https://attacker.invalid", cookie: a },
    body: JSON.stringify({ name: "astra.game_create_match", args: command() }),
  });
  assert.equal(crossSite.status, 403);
  const tamper = await call(`td_session=${"a".repeat(64)}`, "read_match", readArgs);
  assert.equal(tamper.status, 401);
  const logout = await fetch(`${app.origin}/api/session`, {
    method: "DELETE",
    headers: { ...headers, cookie: a },
  });
  assert.equal(logout.status, 200);
  assert.equal((await call(a, "read_match", readArgs)).status, 401);
  // Auth tokens are never delivered to the browser; adapters enforce session revocation too.
  const direct = await fetch(`${runtime.origin}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "alice", password }),
  });
  const session = await direct.json();
  const adapter = new GameAdapter(checkout, runtime.origin, session.token);
  try {
    await adapter.call("astra.game_read_match", readArgs);
    await fetch(`${runtime.origin}/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
      body: "{}",
    });
    await assert.rejects(
      adapter.call("astra.game_read_match", readArgs),
      (error: unknown) => error instanceof Error && error.message.includes("Sign in"),
    );
  } finally {
    await adapter.close();
  }
  await runtime.stop();
  const offlineStartup = await fetch(`${app.origin}/api/matches`, {
    method: "POST",
    headers: { ...headers, cookie: c },
    body: JSON.stringify(command()),
  });
  assert.equal(offlineStartup.status, 503);
  assert(
    ["UNAVAILABLE", "SCHEDULER_UNAVAILABLE"].includes((await offlineStartup.json()).error.code),
  );
  await runtime.restart();
  console.log(
    "PASS actual SQLite + MCP + HTTP: contract gate, distinct accounts, ownership/privacy, invite limits, processing, idempotency, CSRF, cookies and session revocation",
  );
} finally {
  await app.close();
  await runtime.close();
}
