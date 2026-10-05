import {
  contract,
  IntegrationError,
  runtimeError,
  type GameTool,
  validateRequest,
  validateResult,
  verifySchemas,
} from "./contract.js";
import { connectRuntime, publishedSchema } from "./transport.js";

export type RuntimeConnection = Awaited<ReturnType<typeof connectRuntime>>;
export async function verifyRuntime(connection: RuntimeConnection) {
  const schema = await publishedSchema(connection.client);
  verifySchemas(schema.tools);
  const result = await connection.client.callTool(
    { name: "astra.game_describe", arguments: { version: 2 } },
    undefined,
    { timeout: 15000 },
  );
  if (result.isError) throw new IntegrationError("CONTRACT_MISMATCH");
  validateResult("astra.game_describe", result.structuredContent);
  return { schema, contract };
}

/** One authenticated process per browser session. No player ID or shared CLI profile. */
export class GameAdapter {
  #connection: RuntimeConnection | undefined;
  #busy = false;
  #closed = false;
  constructor(
    private readonly checkout: string,
    private readonly serviceUrl: string,
    private readonly session: string,
  ) {}
  async call(name: GameTool, args: unknown): Promise<Record<string, unknown>> {
    validateRequest(name, args);
    if (this.#closed) throw new IntegrationError("AUTH_REQUIRED");
    if (this.#busy) throw new IntegrationError("LIMIT_REACHED");
    this.#busy = true;
    try {
      if (!this.#connection) {
        this.#connection = await connectRuntime(this.checkout, {
          ASTRA_GAME_TOOLS_ENABLED: "true",
          ASTRA_GAME_SERVICE_URL: this.serviceUrl,
          ASTRA_GAME_SESSION: this.session,
        });
        await verifyRuntime(this.#connection);
      }
      let result: Awaited<ReturnType<RuntimeConnection["client"]["callTool"]>>;
      try {
        result = await this.#connection.client.callTool({ name, arguments: args }, undefined, {
          timeout: 35000,
        });
      } catch {
        throw new IntegrationError(
          name === "astra.game_read_match" || name === "astra.game_describe"
            ? "UNAVAILABLE"
            : "OUTCOME_UNKNOWN",
        );
      }
      if (result.isError)
        throw runtimeError(
          result.structuredContent &&
            typeof result.structuredContent === "object" &&
            "error" in result.structuredContent
            ? result.structuredContent.error
            : undefined,
        );
      validateResult(name, result.structuredContent);
      return result.structuredContent;
    } catch (error) {
      if (
        !(error instanceof IntegrationError) ||
        ["OUTCOME_UNKNOWN", "INVALID_RESULT", "UNAVAILABLE", "CONTRACT_MISMATCH"].includes(
          error.code,
        )
      ) {
        await this.#connection?.close();
        this.#connection = undefined;
      }
      throw error instanceof IntegrationError ? error : new IntegrationError("UNAVAILABLE");
    } finally {
      this.#busy = false;
    }
  }
  async close() {
    this.#closed = true;
    await this.#connection?.close();
    this.#connection = undefined;
  }
}
