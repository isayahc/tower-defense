import { IntegrationError, contract, verifySchemas, validateResult } from "./contract.js";
import { connectRuntime, publishedSchema } from "./transport.js";

export const GAME_REQUIREMENTS = [
  "Authenticated two-player membership and ownership",
  "Persistent server clock and restart recovery",
  "Hidden deposits and per-player sensor observations",
  "Atomic collection and inventory reservations",
  "Authoritative material processing and energy accounting",
  "Robot jobs, construction, combat, and victory",
] as const;
export function assessGameReadiness(
  toolNames: readonly string[],
  processingContractVerified = false,
) {
  return {
    status: "integration-error" as const,
    canStartMatch: false as const,
    discoveredToolCount: toolNames.length,
    processingContractVerified,
    canStartRecovery: processingContractVerified,
    code: processingContractVerified ? "FULL_GAME_UNSUPPORTED" : "GAME_CONTRACT_UNVERIFIED",
    message: processingContractVerified
      ? "The shared dump is ready for two-player recovery. Robot travel, manufacturing, combat and victory are still in development."
      : "OpenIndustries has no verified compatible game contract. Match startup is disabled.",
    requiredCapabilities: [...GAME_REQUIREMENTS],
  };
}
/** Only the exact, pinned read-only describe operation may be called during discovery. */
export async function discoverOpenIndustries(checkout: string, timeoutMs = 15000) {
  const connection = await connectRuntime(checkout, {}, timeoutMs);
  try {
    const schema = await publishedSchema(connection.client, timeoutMs);
    let processingContractVerified = false;
    try {
      verifySchemas(schema.tools);
      const result = await connection.client.callTool(
        { name: "astra.game_describe", arguments: { version: 4 } },
        undefined,
        { timeout: timeoutMs },
      );
      if (result.isError) throw new IntegrationError("CONTRACT_MISMATCH");
      validateResult("astra.game_describe", result.structuredContent);
      processingContractVerified = true;
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
    }
    return {
      format: "tower-defense.mcp-discovery" as const,
      version: 4 as const,
      transport: "local-stdio" as const,
      ...schema,
      ...(processingContractVerified ? { contract } : {}),
      readiness: assessGameReadiness(
        schema.tools.map((t) => t.name),
        processingContractVerified,
      ),
    };
  } finally {
    await connection.close();
  }
}
