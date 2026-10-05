# Web and adapter foundation

A small TypeScript/Node HTTP backend serves static HTML/CSS/JavaScript. It uses the official MCP SDK over local stdio and a separately running Open-Industries SQLite service. No Supabase package, hosted database or cloud-provider account is required in tower-defense.

## Setup

Install Node 22.18+ and both repositories with `npm ci`. Use Open-Industries v3 commit `e8529035679f80ab1aa286fb07ac51032c9e2ff8`, pinned in `.github/workflows/ci.yml`, from [upstream PR #4](https://github.com/Mapped-Assembly/Open-Industries/pull/4). In Open-Industries, create `.env` with `ASTRA_GAME_ALLOW_SIGNUP=true` and run `npm run game:server`. This creates its private SQLite file and starts autonomous ticks on loopback port 8790.

In tower-defense, copy `.env.example` to `.env`, set `OI_CHECKOUT` to that installed checkout, and run `npm run dev`. Open **http://127.0.0.1:3000**. Windows PowerShell accepts forward slashes in the checkout path, for example `C:/projects/Open-Industries`.

Without configuration, the page loads an actionable integration-error view. With a compatible running service, it offers native game-account registration/sign-in. Use a username (3–40 letters, digits, `_` or `-`) and a password of at least 12 characters. Disable upstream registration after provisioning accounts if desired. These are local game accounts; no email verification/reset flow is implemented.

Production build: `npm run build`, then `npm start`. `npm run demo:science` remains a separate pure material fixture. `npm run dev` now starts the web foundation rather than the science demo.

Both services bind loopback. For remote browsers, put the game backend behind a TLS reverse proxy on the same host, preserve its Host header, and set `TD_PUBLIC_ORIGIN` to the exact public HTTPS origin. Do not expose the SQLite service or its files directly. This small deployment uses an in-memory browser-session registry, so one backend process owns its sessions; restarting the backend requires sign-in again, while SQLite match progress remains durable.

## Boundary and routes

| Route | Purpose |
| --- | --- |
| `GET /api/integration` | Cached read-only discovery and service health; always reports `canStartMatch: false` |
| `POST /api/session` | Exact `{mode: "login" or "register", username, password}`; returns only authentication status |
| `GET /api/session` | Revalidate the game session server-side |
| `DELETE /api/session` | Revoke the upstream session, close its MCP process and clear the cookie |
| `POST /api/runtime` | Exact `{name, args}` for the five versioned recovery tools; authenticated and schema-checked |
| `POST /api/matches` | Explicitly rejects full-match startup until the complete game contract exists |

The browser receives a random opaque HttpOnly, SameSite=Strict cookie; it never receives the runtime token, a player-ID selector or server filesystem paths. HTTPS uses a Secure `__Host-` cookie. Backend sessions last at most eight hours, are bounded to 32, and each owns one lazily started MCP process. SQLite verifies the token/owner on every game operation. A browser-supplied identity, arbitrary tool name or unknown field is rejected before forwarding.

POST/DELETE requests require exact Origin and Host matches and JSON bodies. Cross-site requests and DNS-rebinding Host values are rejected. No CORS is enabled. Static serving is allowlisted; `.env`, source files and databases cannot be requested. Responses are no-store with a restrictive CSP and no-referrer policy. Runtime errors and stderr never pass through unfiltered. Authentication and per-session calls have rate/concurrency/body/deadline limits; a proxy should impose normal network traffic limits too.

## Commands and recovery

Use server-issued object IDs and revisions. Keep the same `command_id` and identical payload when a response is lost; the adapter never blindly retries a mutation or chooses a replacement ID. An uncertain result returns `OUTCOME_UNKNOWN`. After a conflict, read the current snapshot and reconcile before creating a new command. Each read is a full authorized replacement snapshot. Receipts can contain old snapshots, so read again after replay.

Processing endpoints support only the declared foundation. The static describe response does not prove scheduler health, successful authentication or deployment readiness; health and identity are separately checked. Full-game startup stays disabled on both client and backend.

## Check

```sh
npm run check
npm run test:integration
npx playwright install chromium
npm run test:browser
```

The last two test commands need `OI_CHECKOUT` in the process environment. In PowerShell: `$env:OI_CHECKOUT = 'C:/projects/Open-Industries'`. Test scripts create private temporary SQLite databases and run real service/MCP processes. They never touch the configured production database. Browser screenshots are written to `test-results/` and uploaded by CI. The browser test clicks through create, refresh/renew invitation, join, inspect/collect/process, pause/resume, sign-out/sign-in restoration and mutual completion. It deliberately loses one committed response and checks that the UI retries the identical payload/ID. Desktop/mobile screenshots and console/overflow checks cover the actual map and controls.

## Play the recovery session

1. Sign in in two separate browser profiles (or normal/incognito windows).
2. Create a recovery session. Share the match ID and invitation code with your partner, who selects **Have an invitation?** and joins. Renew an invite if you refreshed before sharing it; this invalidates older codes.
3. Each crew selects its own starter cable, inspects it, collects it, then processes the recovered batch. The 20-second, 10 kJ job runs in Open-Industries; 100 W solar recharges its 20 kJ battery. Pause/resume/cancel are available.
4. Refresh or sign out/in to restore the match from the account's membership list. The same depleted sites, materials and job progress return. No token, password, invitation or game state is stored in browser storage.
5. Once both crews have processed a batch, each selects **Finish recovery session** to archive it. Ending early cancels jobs for both crews; the UI asks before that shared action. Completion is a recovery-session result, not combat victory.

The map shows seven finite waste categories per starting area, roads, obstacles, neutral outposts, towers and your two parked robots. Only your starter cable can currently be inspected/recovered. Other categories keep their undiscovered mass/components on the server for later robot survey/hauling work. The equipment panel accounts for the prebuilt tower, two robots, solar generator, battery, bench, fabricator, separator and starter stock.

Polling every two seconds replaces the current snapshot. A failed connection marks the view stale and disables mutations; **Reconnect match** refreshes it. A mutation with an uncertain outcome retains its exact command in memory and exposes **Retry pending command**; it blocks new work until resolved. Conflict responses refresh state and require an explicit new action. Reloading drops pending in-memory commands: inspect the restored membership/inventory/job state before issuing new work.

The v3 service migrates v2 SQLite matches once, retaining their cable, observations, jobs, batches, accounts and receipts, and records the new equipment grants. Back up first and upgrade both repositories together. Full-game startup remains disabled; robot travel, expanded sensing/material processing, manufacturing, combat and victory are later work.
