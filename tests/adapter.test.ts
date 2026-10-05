import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import captured from "../src/integration/contract-v2.json" with { type: "json" };
import {
  IntegrationError,
  safeError,
  validateRequest,
  validateResult,
  verifySchemas,
} from "../src/integration/contract.js";
import { startApp } from "../src/server/app.js";
import { RuntimeService } from "../src/server/service.js";

const tools = captured.tools as Tool[];
test("exact schemas are required; plausible names, extra identity fields and changed versions fail closed", () => {
  verifySchemas(tools);
  assert.throws(() => verifySchemas([]), IntegrationError);
  assert.throws(() => verifySchemas([...tools, tools[0] as Tool]), IntegrationError);
  const changed = structuredClone(tools);
  const create = changed.find((t) => t.name === "astra.game_create_match");
  assert(create);
  create.inputSchema.additionalProperties = true;
  assert.throws(() => verifySchemas(changed), IntegrationError);
  for (const args of [
    { version: 1, command_id: randomUUID() },
    { version: 2, command_id: randomUUID(), player_id: randomUUID() },
    { version: 2, command_id: "bad" },
  ]) {
    assert.throws(() => validateRequest("astra.game_create_match", args), IntegrationError);
  }
  validateRequest("astra.game_create_match", { version: 2, command_id: randomUUID() });
  assert.throws(
    () =>
      validateRequest("astra.game_command", {
        version: 2,
        command_id: randomUUID(),
        match_id: randomUUID(),
        expected_revision: 1,
        action: "tick",
        time: 999,
      }),
    IntegrationError,
  );
  validateResult("astra.game_describe", captured.contract);
  assert.throws(
    () =>
      validateResult("astra.game_describe", { ...captured.contract, ready_for_full_game: true }),
    IntegrationError,
  );
  assert.throws(
    () =>
      validateResult("astra.game_read_match", {
        version: 2,
        balance_version: "dump-v1",
        snapshot: {},
        hidden_seed: "secret",
      }),
    IntegrationError,
  );
  assert(!JSON.stringify(safeError(new Error("sensitive-server-stderr"))).includes("sensitive"));
});

test("runtime credentials may only be sent to the configured loopback service", () => {
  for (const url of [
    "http://example.com",
    "http://127.0.0.1@evil.example",
    "file:///tmp/x",
    "http://127.0.0.1/auth",
    "http://127.0.0.1/?token=x",
  ])
    assert.throws(() => new RuntimeService(url));
});

test("unconfigured web foundation serves assets, blocks startup, origin attacks and private files", async () => {
  const app = await startApp({ port: 0 });
  try {
    const page = await fetch(app.origin);
    assert.equal(page.status, 200);
    assert(page.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
    assert((await page.text()).includes("Start full match"));
    const integration = await (await fetch(`${app.origin}/api/integration`)).json();
    assert.equal(integration.canStartMatch, false);
    assert.equal(integration.state, "unconfigured");
    const noSession = await fetch(`${app.origin}/api/runtime`, {
      method: "POST",
      headers: { origin: app.origin, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(noSession.status, 401);
    const hostile = await fetch(`${app.origin}/api/session`, {
      method: "POST",
      headers: { origin: "https://attacker.invalid", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(hostile.status, 403);
    const forgedHost = await new Promise<number | undefined>((done, reject) => {
      const req = httpRequest(
        `${app.origin}/api/session`,
        { headers: { Host: "attacker.invalid" } },
        (response) => {
          response.resume();
          done(response.statusCode);
        },
      );
      req.once("error", reject);
      req.end();
    });
    assert.equal(forgedHost, 403);
    for (const path of [
      "/.env",
      "/src/server/app.ts",
      "/integration/contract-v2.json",
      "/package.json",
    ])
      assert.equal((await fetch(app.origin + path)).status, 404);
    for (const path of ["/", "/app.js", "/style.css"]) {
      const text = await (await fetch(app.origin + path)).text();
      assert(!/ASTRA_GAME_SESSION|password_hash|process\.env|service_role|supabase/i.test(text));
    }
  } finally {
    await app.close();
  }
});
