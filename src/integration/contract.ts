import { isDeepStrictEqual } from "node:util";
import { Ajv } from "ajv";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import captured from "./contract-v2.json" with { type: "json" };

export const GAME_TOOLS = [
  "astra.game_describe",
  "astra.game_create_match",
  "astra.game_join_match",
  "astra.game_read_match",
  "astra.game_command",
] as const;
export type GameTool = (typeof GAME_TOOLS)[number];
export const contract = captured.contract;
const ajv = new Ajv({ strict: false });
const validators = new Map(
  captured.tools.map((t) => [
    t.name,
    { input: ajv.compile(t.inputSchema), output: ajv.compile(t.outputSchema.oneOf[0] ?? false) },
  ]),
);
export const messages = {
  AUTH_REQUIRED: "Sign in to your game account.",
  INVALID_REQUEST: "The request does not match the supported game contract.",
  CONTRACT_MISMATCH:
    "The runtime has an unsupported schema. Install the documented Open-Industries version.",
  FULL_GAME_UNSUPPORTED:
    "Full matches are not available yet. Robot movement, manufacturing, combat and victory are still missing.",
  DISABLED: "The requested feature is disabled in the runtime configuration.",
  NOT_AVAILABLE: "The match, invitation or object is unavailable to this account.",
  CONFLICT: "State changed. Read a fresh snapshot before submitting a new command.",
  COMMAND_ID_REUSED: "This command ID belongs to a different request.",
  LIMIT_REACHED: "Too many requests or active sessions. Try again later.",
  SCHEDULER_UNAVAILABLE:
    "The runtime scheduler is unavailable. Ask the host to restart the game service.",
  MATCH_INACTIVE: "This operation requires an active two-player processing session.",
  DEPOSIT_EMPTY: "This deposit has already been collected.",
  INSPECTION_REQUIRED: "Inspect this deposit before collecting or processing it.",
  INVALID_FEEDSTOCK: "This batch does not satisfy the recipe.",
  NOT_READY: "The batch, machine or job is not ready. Read the current state.",
  INVARIANT_FAILED: "The runtime rolled back an inconsistent operation.",
  OUTCOME_UNKNOWN:
    "The request may have committed. Retry the identical command ID and payload, then refresh.",
  INVALID_RESULT:
    "The runtime returned an unsupported result. Retry the identical command before starting new work.",
  UNAVAILABLE:
    "Cannot reach Open-Industries. Check the runtime service and checkout configuration.",
  FORBIDDEN: "This request must originate from this application.",
} as const;
export type ErrorCode = keyof typeof messages;
export class IntegrationError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(messages[code]);
  }
}
export function safeError(error: unknown) {
  const code = error instanceof IntegrationError ? error.code : "UNAVAILABLE";
  return { code, message: messages[code] };
}
export function gameTool(value: unknown): value is GameTool {
  return GAME_TOOLS.includes(value as GameTool);
}
export function verifySchemas(tools: Tool[]) {
  for (const expected of captured.tools) {
    const found = tools.filter((t) => t.name === expected.name);
    if (
      found.length !== 1 ||
      !isDeepStrictEqual(found[0]?.inputSchema, expected.inputSchema) ||
      !isDeepStrictEqual(found[0]?.outputSchema, expected.outputSchema)
    )
      throw new IntegrationError("CONTRACT_MISMATCH");
  }
}
export function validateRequest(
  name: GameTool,
  args: unknown,
): asserts args is Record<string, unknown> {
  if (Buffer.byteLength(JSON.stringify(args) ?? "") > 8192 || !validators.get(name)?.input(args))
    throw new IntegrationError("INVALID_REQUEST");
}
export function validateResult(
  name: GameTool,
  result: unknown,
): asserts result is Record<string, unknown> {
  if (
    Buffer.byteLength(JSON.stringify(result) ?? "") > 256 * 1024 ||
    !validators.get(name)?.output(result)
  )
    throw new IntegrationError("INVALID_RESULT");
}
export function runtimeError(value: unknown): IntegrationError {
  const code = value && typeof value === "object" && "code" in value ? value.code : undefined;
  return new IntegrationError(
    typeof code === "string" && Object.hasOwn(messages, code) ? (code as ErrorCode) : "UNAVAILABLE",
  );
}
