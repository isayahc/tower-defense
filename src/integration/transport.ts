import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Resource, ResourceTemplate, Tool } from "@modelcontextprotocol/sdk/types.js";

class OwnedTransport extends StdioClientTransport {
  #closing: Promise<void> | undefined;
  override close() {
    this.#closing ??= super.close();
    return this.#closing;
  }
}
export async function connectRuntime(
  checkout: string,
  env: Record<string, string> = {},
  timeoutMs = 15000,
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new Error("INVALID_DISCOVERY_TIMEOUT");
  const root = resolve(checkout),
    script = resolve(root, "server/astra-mcp.mjs");
  await access(script);
  const client = new Client({ name: "tower-defense", version: "0.2.0" });
  const transport = new OwnedTransport({
    command: process.execPath,
    args: [script],
    cwd: root,
    env: { ...env, ASTRA_ROOT: root },
    stderr: "pipe",
    maxBufferSize: 1024 * 1024,
  });
  transport.stderr?.on("data", () => {});
  const close = async () => {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  };
  try {
    await client.connect(transport, { signal: AbortSignal.timeout(timeoutMs), timeout: timeoutMs });
  } catch (error) {
    await close();
    throw error;
  }
  return { client, close };
}
export async function publishedSchema(client: Client, timeoutMs = 15000) {
  const options = { signal: AbortSignal.timeout(timeoutMs), timeout: timeoutMs };
  const capabilities = client.getServerCapabilities() ?? {};
  async function pages<T>(
    get: (cursor?: string) => Promise<{ entries: T[]; nextCursor?: string }>,
  ) {
    const entries: T[] = [],
      seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 32; page++) {
      const result = await get(cursor);
      entries.push(...result.entries);
      if (entries.length > 1000) throw new Error("DISCOVERY_LIMIT");
      if (!result.nextCursor) return entries;
      if (seen.has(result.nextCursor)) throw new Error("DISCOVERY_CURSOR_LOOP");
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error("DISCOVERY_LIMIT");
  }
  const tools: Tool[] = capabilities.tools
    ? await pages(async (cursor) => {
        const result = await client.listTools(cursor ? { cursor } : {}, options);
        return {
          entries: result.tools,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
      })
    : [];
  if (new Set(tools.map((t) => t.name)).size !== tools.length)
    throw new Error("DUPLICATE_DISCOVERED_TOOL");
  const resources: Resource[] = capabilities.resources
    ? await pages(async (cursor) => {
        const result = await client.listResources(cursor ? { cursor } : {}, options);
        return {
          entries: result.resources,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
      })
    : [];
  const resourceTemplates: ResourceTemplate[] = capabilities.resources
    ? await pages(async (cursor) => {
        const result = await client.listResourceTemplates(cursor ? { cursor } : {}, options);
        return {
          entries: result.resourceTemplates,
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        };
      })
    : [];
  return {
    serverInfo: client.getServerVersion(),
    capabilities,
    tools,
    resources,
    resourceTemplates,
  };
}
