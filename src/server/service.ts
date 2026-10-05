import { IntegrationError, runtimeError } from "../integration/contract.js";

export class RuntimeService {
  readonly url: URL;
  constructor(url: string) {
    this.url = new URL(url);
    if (
      this.url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(this.url.hostname) ||
      this.url.username ||
      this.url.password ||
      this.url.pathname !== "/" ||
      this.url.search ||
      this.url.hash
    )
      throw new IntegrationError("UNAVAILABLE");
  }
  async request(
    path: "/health" | "/auth/session" | "/auth/login" | "/auth/register" | "/auth/logout",
    body?: unknown,
    token?: string,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await fetch(new URL(path, this.url), {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new IntegrationError("UNAVAILABLE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) {
          await reader.cancel();
          throw new IntegrationError("INVALID_RESULT");
        }
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      if (!response.ok) throw runtimeError(result.error);
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new IntegrationError("INVALID_RESULT");
      return result;
    } catch (error) {
      throw error instanceof IntegrationError ? error : new IntegrationError("UNAVAILABLE");
    }
  }
}
