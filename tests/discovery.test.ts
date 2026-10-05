import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assessGameReadiness, discoverOpenIndustries } from "../src/integration/discovery.js";

const captured = JSON.parse(
  await readFile(new URL("../docs/discovery/openindustries-local.json", import.meta.url), "utf8"),
);
const exec = promisify(execFile);

async function contractDouble(mode = "normal") {
  const root = await mkdtemp(join(tmpdir(), "tower-mcp-"));
  await mkdir(join(root, "server"));
  const trace = join(root, "calls.jsonl");
  // Only test infrastructure. Returns the schema captured from the real OI process.
  await writeFile(
    join(root, "server/astra-mcp.mjs"),
    `
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const snapshot = ${JSON.stringify(captured)};
const mode = ${JSON.stringify(mode)};
process.stderr.write('SENSITIVE_TEST_STDERR_MUST_NOT_ESCAPE');
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  appendFileSync(${JSON.stringify(trace)},JSON.stringify({method:request.method,params:request.params})+'\\n');
  if (!Object.hasOwn(request,'id')) return;
  if (mode==='stall') return;
  let result;
  if(request.method==='initialize') result={protocolVersion:'2025-06-18',serverInfo:snapshot.serverInfo,capabilities:snapshot.capabilities};
  else if(request.method==='tools/list') {
    const tools=mode==='duplicate'?[snapshot.tools[0],snapshot.tools[0]]:request.params?.cursor?snapshot.tools.slice(6):snapshot.tools.slice(0,6);
    result={tools,...(mode==='loop'?{nextCursor:'repeat'}:!request.params?.cursor&&mode!=='duplicate'?{nextCursor:'second'}:{})};
  } else {
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unexpected method'}})+'\\n');
    return;
  }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`,
  );
  return { root, trace, close: () => rm(root, { recursive: true, force: true }) };
}

test("MCP discovery initializes the real published contract, follows pagination, and makes no tool mutations", async () => {
  const server = await contractDouble();
  try {
    const result = await discoverOpenIndustries(server.root);
    assert.equal(result.tools.length, 13);
    assert.deepEqual(result.tools, captured.tools);
    assert.deepEqual(result.resources, []);
    assert.equal(result.readiness.canStartMatch, false);
    const calls = (await readFile(server.trace, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      calls.map((call) => call.method),
      ["initialize", "notifications/initialized", "tools/list", "tools/list"],
    );
    assert.equal(
      calls.some((call) => call.method === "tools/call"),
      false,
    );
  } finally {
    await server.close();
  }
});

test("unknown tool names never certify a game contract or enable a fallback", () => {
  assert.equal(assessGameReadiness([]).canStartMatch, false);
  assert.equal(
    assessGameReadiness(["invented.create_match", "invented.resolve_combat"]).canStartMatch,
    false,
  );
});

test("discovery rejects repeated cursors and duplicate tools", async () => {
  for (const mode of ["loop", "duplicate"]) {
    const server = await contractDouble(mode);
    try {
      await assert.rejects(
        discoverOpenIndustries(server.root),
        /DISCOVERY_CURSOR_LOOP|DUPLICATE_DISCOVERED_TOOL/,
      );
    } finally {
      await server.close();
    }
  }
});

test("an unavailable or nonresponding server fails closed under a deadline", async () => {
  await assert.rejects(discoverOpenIndustries("/this-checkout-does-not-exist"));
  const server = await contractDouble("stall");
  try {
    await assert.rejects(discoverOpenIndustries(server.root, 300));
  } finally {
    await server.close();
  }
});

test("CLI exits 2 for discovered-but-unsupported servers and does not forward server stderr", async () => {
  const server = await contractDouble();
  try {
    try {
      await exec(process.execPath, [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/cli/discover.ts", import.meta.url)),
        server.root,
      ]);
      assert.fail("Unsupported integration must not exit successfully");
    } catch (error) {
      const result = error as Error & { code: number; stdout: string; stderr: string };
      assert.equal(result.code, 2);
      assert.equal(JSON.parse(result.stdout).readiness.canStartMatch, false);
      assert.equal(result.stderr.includes("SENSITIVE_TEST_STDERR_MUST_NOT_ESCAPE"), false);
    }
  } finally {
    await server.close();
  }
});
