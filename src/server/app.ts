import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { GameAdapter } from "../integration/adapter.js";
import { gameTool, IntegrationError, safeError, validateRequest } from "../integration/contract.js";
import { discoverOpenIndustries } from "../integration/discovery.js";
import { RuntimeService } from "./service.js";

type Session = {
  token: string;
  expires: number;
  adapter: GameAdapter;
  busy: boolean;
  count: number;
  window: number;
};
export interface AppConfig {
  checkout?: string;
  serviceUrl?: string;
  publicOrigin?: string;
  port?: number;
}
export async function startApp(config: AppConfig = {}) {
  const service = new RuntimeService(config.serviceUrl ?? "http://127.0.0.1:8790");
  const sessions = new Map<string, Session>();
  const assets = new Map(
    await Promise.all(
      [
        ["/", "index.html", "text/html"],
        ["/app.js", "app.js", "text/javascript"],
        ["/style.css", "style.css", "text/css"],
      ].map(
        async ([route, file, mime]) =>
          [
            route,
            { body: await readFile(new URL(`../web/${file}`, import.meta.url)), mime },
          ] as const,
      ),
    ),
  );
  let origin = config.publicOrigin ? new URL(config.publicOrigin) : undefined;
  if (
    origin &&
    (origin.origin !== config.publicOrigin ||
      origin.username ||
      origin.password ||
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
        )))
  )
    throw new IntegrationError("FORBIDDEN");
  let probe: Promise<Record<string, unknown>> | undefined,
    probeTime = 0;
  let loginPending = 0,
    loginCount = 0,
    loginWindow = Date.now();
  const cookieName = () => (origin?.protocol === "https:" ? "__Host-td_session" : "td_session");
  const cookie = (id: string, maxAge = 28800) =>
    `${cookieName()}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin?.protocol === "https:" ? "; Secure" : ""}`;
  const sessionId = (req: IncomingMessage) => {
    const values = (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${cookieName()}=`));
    const id = values.length === 1 ? values[0]?.slice(cookieName().length + 1) : undefined;
    return id && /^[a-f0-9]{64}$/.test(id) ? id : undefined;
  };
  async function remove(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.adapter.close();
    await service.request("/auth/logout", {}, session.token).catch(() => {});
  }
  async function integration() {
    if (probe && Date.now() - probeTime < 5000) return probe;
    probeTime = Date.now();
    probe = (async () => {
      if (!config.checkout)
        return {
          state: "unconfigured",
          canStartMatch: false,
          processingContractVerified: false,
          registrationEnabled: false,
          code: "UNCONFIGURED",
          message:
            "The host has not connected Open-Industries yet. Configure the runtime checkout and start its SQLite service.",
        };
      try {
        const report = await discoverOpenIndustries(config.checkout);
        if (!report.readiness.processingContractVerified)
          return { state: "incompatible", ...report.readiness, registrationEnabled: false };
        const health = await service.request("/health");
        if (health.version !== 2 || health.scheduler_healthy !== true)
          throw new IntegrationError("SCHEDULER_UNAVAILABLE");
        return {
          state: "partial",
          ...report.readiness,
          registrationEnabled: health.registration_enabled === true,
        };
      } catch (error) {
        return {
          state: "unavailable",
          canStartMatch: false,
          processingContractVerified: false,
          registrationEnabled: false,
          ...safeError(error),
        };
      }
    })();
    return probe;
  }
  async function jsonBody(req: IncomingMessage) {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json")
      throw new IntegrationError("INVALID_REQUEST");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 12288) throw new IntegrationError("INVALID_REQUEST");
      chunks.push(Buffer.from(chunk));
    }
    try {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      return body as Record<string, unknown>;
    } catch {
      throw new IntegrationError("INVALID_REQUEST");
    }
  }
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const send = (status: number, value: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    try {
      if (
        !origin ||
        req.headers.host !== origin.host ||
        (req.headers.origin && req.headers.origin !== origin.origin) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new IntegrationError("FORBIDDEN");
      if (req.method !== "GET" && req.headers.origin !== origin.origin)
        throw new IntegrationError("FORBIDDEN");
      const id = sessionId(req),
        session = id ? sessions.get(id) : undefined;
      if (id && session && session.expires <= Date.now()) {
        await remove(id);
        throw new IntegrationError("AUTH_REQUIRED");
      }
      if (req.method === "GET" && req.url === "/favicon.ico") return res.writeHead(204).end();
      const asset = assets.get(req.url);
      if (req.method === "GET" && asset) {
        return res
          .writeHead(200, { "content-type": `${asset.mime}; charset=utf-8` })
          .end(asset.body);
      }
      if (req.method === "GET" && req.url === "/api/integration")
        return send(200, await integration());
      if (req.method === "GET" && req.url === "/api/session") {
        if (!session) return send(200, { authenticated: false });
        const result = await service.request("/auth/session", undefined, session.token);
        if (result.authenticated !== true) throw new IntegrationError("AUTH_REQUIRED");
        return send(200, { authenticated: true });
      }
      if (req.method === "POST" && req.url === "/api/session") {
        if (session?.busy) throw new IntegrationError("LIMIT_REACHED");
        if (Date.now() - loginWindow >= 60000) {
          loginWindow = Date.now();
          loginCount = 0;
        }
        if (++loginCount > 30 || loginPending >= 4 || sessions.size + loginPending >= 32)
          throw new IntegrationError("LIMIT_REACHED");
        const body = await jsonBody(req);
        if (
          Object.keys(body).sort().join(",") !== "mode,password,username" ||
          !["login", "register"].includes(String(body.mode)) ||
          typeof body.username !== "string" ||
          !/^[a-zA-Z0-9_-]{3,40}$/.test(body.username) ||
          typeof body.password !== "string" ||
          body.password.length < 12 ||
          body.password.length > 256
        )
          throw new IntegrationError("INVALID_REQUEST");
        if (!config.checkout) throw new IntegrationError("UNAVAILABLE");
        loginPending++;
        try {
          const status = await integration();
          if (status.processingContractVerified !== true || status.state !== "partial")
            throw new IntegrationError("CONTRACT_MISMATCH");
          const result = await service.request(
            body.mode === "register" ? "/auth/register" : "/auth/login",
            { username: body.username, password: body.password },
          );
          if (
            typeof result.token !== "string" ||
            !/^[a-f0-9]{64}$/.test(result.token) ||
            typeof result.expires_at_ms !== "number" ||
            result.expires_at_ms <= Date.now() ||
            result.expires_at_ms > Date.now() + 8 * 3600000
          )
            throw new IntegrationError("INVALID_RESULT");
          if (id) await remove(id);
          const nextId = randomBytes(32).toString("hex");
          sessions.set(nextId, {
            token: result.token,
            expires: result.expires_at_ms,
            adapter: new GameAdapter(config.checkout, service.url.origin, result.token),
            busy: false,
            count: 0,
            window: Date.now(),
          });
          res.setHeader("set-cookie", cookie(nextId));
          return send(200, { authenticated: true });
        } finally {
          loginPending--;
        }
      }
      if (req.method === "DELETE" && req.url === "/api/session") {
        if (session?.busy) throw new IntegrationError("LIMIT_REACHED");
        if (id) await remove(id);
        res.setHeader("set-cookie", cookie("", 0));
        return send(200, { authenticated: false });
      }
      if (req.method === "POST" && ["/api/runtime", "/api/matches"].includes(req.url ?? "")) {
        if (!session) throw new IntegrationError("AUTH_REQUIRED");
        if (req.url === "/api/matches") throw new IntegrationError("FULL_GAME_UNSUPPORTED");
        if (session.busy) throw new IntegrationError("LIMIT_REACHED");
        if (Date.now() - session.window >= 60000) {
          session.window = Date.now();
          session.count = 0;
        }
        if (++session.count > 120) throw new IntegrationError("LIMIT_REACHED");
        session.busy = true;
        try {
          const body = await jsonBody(req);
          if (
            Object.keys(body).sort().join(",") !== "args,name" ||
            !gameTool(body.name) ||
            body.name === "astra.game_describe"
          )
            throw new IntegrationError("INVALID_REQUEST");
          validateRequest(body.name, body.args);
          return send(200, await session.adapter.call(body.name, body.args));
        } finally {
          session.busy = false;
        }
      }
      return send(404, { error: { code: "NOT_FOUND", message: "This route does not exist." } });
    } catch (error) {
      const detail = safeError(error);
      if (detail.code === "AUTH_REQUIRED") {
        const id = sessionId(req);
        if (id) await remove(id);
        res.setHeader("set-cookie", cookie("", 0));
      }
      return send(
        detail.code === "AUTH_REQUIRED"
          ? 401
          : detail.code === "FORBIDDEN"
            ? 403
            : detail.code === "CONFLICT"
              ? 409
              : detail.code === "LIMIT_REACHED"
                ? 429
                : ["UNAVAILABLE", "OUTCOME_UNKNOWN", "SCHEDULER_UNAVAILABLE"].includes(detail.code)
                  ? 503
                  : 400,
        { error: detail },
      );
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 45000;
  server.maxConnections = 128;
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(config.port ?? 3000, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LISTEN_FAILED");
  origin ??= new URL(`http://127.0.0.1:${address.port}`);
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions)
      if (session.expires <= Date.now() && !session.busy) void remove(id);
  }, 30000);
  cleanup.unref();
  return {
    origin: origin.origin,
    async close() {
      clearInterval(cleanup);
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await Promise.all([...sessions.keys()].map(remove));
    },
  };
}
