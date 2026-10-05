import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Resource, ResourceTemplate, Tool } from "@modelcontextprotocol/sdk/types.js";

export const GAME_REQUIREMENTS = [
  "Authenticated two-player membership and ownership",
  "Persistent server clock and restart recovery",
  "Hidden deposits and per-player sensor observations",
  "Atomic collection and inventory reservations",
  "Authoritative material processing and energy accounting",
  "Robot jobs, construction, combat, and victory",
] as const;

/** Discovery is read-only. Tool names alone are never proof of a game contract. */
export function assessGameReadiness(toolNames: readonly string[]) {
  return {
    status: "integration-error" as const,
    canStartMatch: false as const,
    discoveredToolCount: toolNames.length,
    code: "GAME_CONTRACT_UNVERIFIED" as const,
    message: "OpenIndustries game operations have no verified adapter. Match startup is disabled.",
    requiredCapabilities: [...GAME_REQUIREMENTS],
  };
}

export async function discoverOpenIndustries(checkout: string, timeoutMs = 15_000) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("INVALID_DISCOVERY_TIMEOUT");
  }
  const root = resolve(checkout);
  const script = resolve(root, "server/astra-mcp.mjs");
  await access(script);
  const client = new Client({ name: "tower-defense-discovery", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    cwd: root,
    env: { ASTRA_ROOT: root },
    stderr: "pipe",
    maxBufferSize: 1024 * 1024,
  });
  // Drain, but never forward arbitrary server stderr (which may include credentials).
  transport.stderr?.on("data", () => {});
  const options = { signal: AbortSignal.timeout(timeoutMs), timeout: timeoutMs };
  try {
    await client.connect(transport, options);
    const capabilities = client.getServerCapabilities() ?? {};
    const tools: Tool[] = [];
    const resources: Resource[] = [];
    const resourceTemplates: ResourceTemplate[] = [];
    async function pages<T>(
      get: (cursor?: string) => Promise<{ entries: T[]; nextCursor?: string }>,
    ) {
      const entries: T[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 32; page++) {
        const result = await get(cursor);
        entries.push(...result.entries);
        if (entries.length > 1_000) throw new Error("DISCOVERY_LIMIT");
        if (!result.nextCursor) return entries;
        if (seen.has(result.nextCursor)) throw new Error("DISCOVERY_CURSOR_LOOP");
        seen.add(result.nextCursor);
        cursor = result.nextCursor;
      }
      throw new Error("DISCOVERY_LIMIT");
    }
    if (capabilities.tools) {
      tools.push(
        ...(await pages(async (cursor) => {
          const result = await client.listTools(cursor ? { cursor } : {}, options);
          return {
            entries: result.tools,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          };
        })),
      );
    }
    if (capabilities.resources) {
      resources.push(
        ...(await pages(async (cursor) => {
          const result = await client.listResources(cursor ? { cursor } : {}, options);
          return {
            entries: result.resources,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          };
        })),
      );
      resourceTemplates.push(
        ...(await pages(async (cursor) => {
          const result = await client.listResourceTemplates(cursor ? { cursor } : {}, options);
          return {
            entries: result.resourceTemplates,
            ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          };
        })),
      );
    }
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
      throw new Error("DUPLICATE_DISCOVERED_TOOL");
    }
    return {
      format: "tower-defense.mcp-discovery" as const,
      version: 1 as const,
      transport: "local-stdio" as const,
      serverInfo: client.getServerVersion(),
      capabilities,
      tools,
      resources,
      resourceTemplates,
      readiness: assessGameReadiness(tools.map((tool) => tool.name)),
    };
  } finally {
    await client.close();
  }
}
