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
const command = () => ({ version: 4, command_id: randomUUID() });
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
  const discovery = await discoverOpenIndustries(checkout);
  assert.equal(discovery.tools.length, 21);
  assert.equal(discovery.readiness.processingContractVerified, true);
  assert.equal(discovery.readiness.canStartMatch, false);
  const a = await register("alice"),
    b = await register("bob"),
    c = await register("outsider");
  assert.notEqual(a, b);
  const createdRequest = command();
  const created = await call(a, "create_match", createdRequest);
  assert.equal(created.status, 200);
  const id = created.body.snapshot.match_id;
  assert.deepEqual((await call(a, "create_match", createdRequest)).body, created.body);
  assert.equal((await call(a, "create_match", { ...command(), player_id: "bob" })).status, 400);
  const joined = await call(b, "join_match", {
    ...command(),
    match_id: id,
    invite_code: created.body.invite_code,
  });
  assert.equal(joined.status, 200);
  const readArgs = { version: 4, match_id: id };
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
  assert.equal(initial.deposits[0].observation, null);
  assert.equal(
    (await action("inspect_deposit", { deposit_id: joined.body.snapshot.deposits[0].id })).body
      .error.code,
    "NOT_AVAILABLE",
  );
  await action("inspect_deposit", { deposit_id: initial.deposits[0].id });
  const collected = await action("collect_deposit", { deposit_id: initial.deposits[0].id });
  assert.equal(collected.status, 200);
  const started = await action("start_processing", {
    batch_id: collected.body.snapshot.batches[0].id,
    machine_id: initial.machines[0].id,
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.snapshot.jobs[0].state, "running");
  const denied = await fetch(`${app.origin}/api/matches`, {
    method: "POST",
    headers: { ...headers, cookie: a },
    body: "{}",
  });
  assert.equal((await denied.json()).error.code, "FULL_GAME_UNSUPPORTED");
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
  console.log(
    "PASS actual SQLite + MCP + HTTP: contract gate, distinct accounts, ownership/privacy, invite limits, processing, idempotency, CSRF, cookies and session revocation",
  );
} finally {
  await app.close();
  await runtime.close();
}
