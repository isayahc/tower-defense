import { writeFile } from "node:fs/promises";
import type { Page, Request, Response } from "playwright";

/** Optional exact command fields plus independent click and response deadlines. */
export interface CommandOptions {
  action?: string;
  robotId?: string;
  clickTimeout?: number;
  responseTimeout?: number;
}

/** Read only command identifiers; never retain cookies, credentials, or full request bodies. */
function describe(request: Request) {
  const path = new URL(request.url()).pathname;
  const body = request.method() === "POST" ? request.postDataJSON() : null;
  return {
    path,
    method: request.method(),
    operation: body?.name as string | undefined,
    action: body?.args?.action as string | undefined,
    robotId: body?.args?.robot_id as string | undefined,
  };
}

/** Observe a new mutation before clicking, then give its response a separate bounded wait. */
export async function clickCommand(
  page: Page,
  name: string,
  options: CommandOptions = {},
): Promise<Response> {
  const requests = new Set<Request>();
  const events: object[] = [];
  let resolveResponse!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  let phase = "click";
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Keep a bounded, credential-free timeline for this button action. */
  function record(event: object): void {
    events.push({ time: new Date().toISOString(), ...event });
    if (events.length > 100) events.shift();
  }
  /** Match only POST mutations, narrowing robot commands when the caller supplies identifiers. */
  function onRequest(request: Request): void {
    const info = describe(request);
    if (!["/api/matches", "/api/runtime"].includes(info.path)) return;
    record({ event: "request", ...info });
    if (info.method !== "POST") return;
    if (options.action && info.action !== options.action) return;
    if (options.robotId && info.robotId !== options.robotId) return;
    if (
      info.path === "/api/runtime" &&
      (!info.operation ||
        [
          "astra.game_read_match",
          "astra.game_list_matches",
          "astra.game_science_catalog",
          "astra.game_manufacturing_catalog",
        ].includes(info.operation))
    )
      return;
    requests.add(request);
  }
  /** Ignore replies to requests that predate this click attempt. */
  function onResponse(response: Response): void {
    const request = response.request();
    const info = describe(request);
    if (!["/api/matches", "/api/runtime"].includes(info.path)) return;
    record({ event: "response", status: response.status(), ...info });
    if (requests.has(request)) resolveResponse(response);
  }
  /** Preserve transport failures without retrying commands with an unknown outcome. */
  function onFailed(request: Request): void {
    const info = describe(request);
    if (!["/api/matches", "/api/runtime"].includes(info.path)) return;
    record({ event: "requestfailed", error: request.failure()?.errorText, ...info });
  }
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onFailed);
  try {
    await page
      .getByRole("button", { name, exact: true })
      .and(page.locator(":enabled"))
      .first()
      .click({ timeout: options.clickTimeout ?? 45000 });
    phase = "response";
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`No matching response after click (${requests.size} matching requests)`),
            ),
          options.responseTimeout ?? 30000,
        );
      }),
    ]);
  } catch (error) {
    const state = await page
      .evaluate(() => ({
        state: document.getElementById("game-state")?.textContent,
        message: document.getElementById("game-message")?.textContent,
        robots: document.getElementById("robots")?.textContent,
        buttons: [...document.querySelectorAll<HTMLButtonElement>("#robots button")].map((b) => ({
          label: b.textContent,
          disabled: b.disabled,
        })),
      }))
      .catch(() => null);
    const report = {
      button: name,
      phase,
      options,
      matchingRequests: requests.size,
      state,
      events,
      error: String(error),
    };
    console.error("Browser command failed:", JSON.stringify(report));
    const filename = name.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 80);
    await writeFile(
      `test-results/command-${filename}-${Date.now()}.json`,
      JSON.stringify(report, null, 2),
    ).catch((writeError: unknown) =>
      console.error("Could not save command diagnostics:", writeError),
    );
    throw new Error(`${name}: ${phase} phase failed`, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("requestfailed", onFailed);
  }
}
