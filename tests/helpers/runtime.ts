import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export async function launchRuntime(checkout: string) {
  const directory = await mkdtemp(join(tmpdir(), "tower-sqlite-"));
  const child = spawn(process.execPath, ["server/game-service.mjs"], {
    cwd: resolve(checkout),
    env: {
      ...process.env,
      ASTRA_GAME_DB: join(directory, "runtime.sqlite"),
      ASTRA_GAME_PORT: "0",
      ASTRA_GAME_ALLOW_SIGNUP: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  let output = "";
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const origin = await new Promise<string>((done, reject) => {
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
        if (output.length > 4096) {
          clearTimeout(timer);
          reject(new Error("Unexpected runtime output"));
          return;
        }
        const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
        if (match) {
          clearTimeout(timer);
          done(match[0]);
        }
      });
    });
    return { origin, directory, close };
  } catch (error) {
    await close();
    throw error;
  }
}
