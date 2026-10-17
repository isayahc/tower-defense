import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Start a real private SQLite service; restart preserves the same database and port. */
export async function launchRuntime(
  checkout: string,
  options: { prepare?: (database: string) => Promise<void> } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "tower-sqlite-"));
  let child: ChildProcessWithoutNullStreams;
  let origin = "";
  /** Kill the service without a graceful flush, exercising durable transactions. */
  async function stop(): Promise<void> {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  /** Reuse a fixed port after the first start so existing MCP sessions reconnect. */
  async function start(): Promise<void> {
    child = spawn(process.execPath, ["server/game-service.mjs"], {
      cwd: resolve(checkout),
      env: {
        ...process.env,
        ASTRA_GAME_DB: join(directory, "runtime.sqlite"),
        ASTRA_GAME_PORT: origin ? new URL(origin).port : "0",
        ASTRA_GAME_ALLOW_SIGNUP: "true",
      },
      stdio: "pipe",
    });
    child.stderr.on("data", () => {});
    let output = "";
    origin = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("Runtime startup timed out")), 10000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Runtime failed to start"));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Runtime exited"));
      });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
        if (match) {
          clearTimeout(timer);
          done(match[0]);
        } else if (output.length > 4096) {
          clearTimeout(timer);
          reject(new Error("Unexpected runtime output"));
        }
      });
    });
  }
  /** Remove only this fixture's temporary database after stopping its process. */
  async function close(): Promise<void> {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
  try {
    await options.prepare?.(join(directory, "runtime.sqlite"));
    await start();
    return {
      origin,
      directory,
      close,
      stop,
      restart: async (): Promise<void> => {
        await stop();
        await start();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
