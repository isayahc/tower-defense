# Web and adapter foundation

A small TypeScript/Node HTTP backend serves static HTML/CSS/JavaScript. It uses the official MCP SDK over local stdio and a separately running Open-Industries SQLite service. No Supabase package, hosted database or cloud-provider account is required in tower-defense.

## Setup

Install Node 22.18+ and both repositories with `npm ci`. Use Open-Industries v5 commit `1a852f5a1fa6fc09b96c8871b62ce768a70ae077`, pinned in `.github/workflows/ci.yml`, from [upstream PR #43](https://github.com/Mapped-Assembly/Open-Industries/pull/43). In Open-Industries, create `.env` with `ASTRA_GAME_ALLOW_SIGNUP=true` and run `npm run game:server`. This creates its private SQLite file and starts autonomous ticks on loopback port 8790.

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
| `POST /api/runtime` | Exact `{name, args}` for the eight versioned recovery/science tools; authenticated and schema-checked |
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

`npm run check:materials` also checks the vendored pure package against the pinned upstream checkout, normalizing only Git’s CRLF/LF text conversion on Windows. The last two test commands need `OI_CHECKOUT` in the process environment. In PowerShell: `$env:OI_CHECKOUT = 'C:/projects/Open-Industries'`. Test scripts create private temporary SQLite databases and run real service/MCP processes. They never touch the configured production database. Browser screenshots are written to `test-results/` and uploaded by CI. The browser test clicks through create, refresh/renew invitation, join, inspect/collect/process, pause/resume, sign-out/sign-in restoration and mutual completion. It deliberately loses one committed response and checks that the UI retries the identical payload/ID. It also performs paid conductor/component inspections, verifies private persisted evidence, requests suitability at supported/unsupported temperatures, reprocesses residue and holds a click across a polling interval. Desktop/mobile screenshots and console/overflow checks cover the actual map and material lab, including construction-to-steel recovery and battery-suspect vehicle-to-aluminum isolation.

## Play the recovery session

1. Sign in in two separate browser profiles (or normal/incognito windows).
2. Create a recovery session. Share the match ID and invitation code with your partner, who selects **Have an invitation?** and joins. Renew an invite if you refreshed before sharing it; this invalidates older codes.
3. Select a waste site, then **Survey with camera-depth · robot 1**. The robot follows a server-owned obstacle-aware grid route and records private evidence. An installed magnetic/inductive probe is also available. Sensor evidence does not certify composition.
4. Choose a supported **Collect** action. The server reserves at most the remaining stock and free 10 kg payload, budgets travel/collection/return energy, then hauls and unloads automatically. Robots start with 8 kJ. The map shows current authoritative positions and remaining routes; the dispatch panel shows phase, work time, cargo and energy. No browser interpolation advances the robot.
5. Unknown recovered material requires **Inspect recovered batch** at the bench before supported processing. Cable separation consumes 20 seconds / 10 kJ. For other waste, use **Review recovery routes**, choose the matching cold recovery/isolation recipe, preview it, then start the approved process. Inspect the usable output to evaluate existing material uses. Suspect appliance/vehicle residue stays quarantined; batteries and mixed electronics have no generic process route.
6. **Interrupt** releases material reserved before pickup and keeps cargo already collected. **Return and unload** or **Retreat and unload** carries that cargo home. **Return and recharge** shares the base's single charging port, waits behind active processing, and resumes automatically. Insufficient energy requires recharge; changed deposit evidence requires a new survey. Errors preserve the current snapshot and explain the next action.
7. Refresh or sign out/in to restore membership, routes, observations, cargo and job progress. Service restart catches up durable jobs. No credentials or game state enter browser storage.
8. Finish the recovery session after processing and after robots have finished and unloaded. Both crews must finish; this records no combat winner.

The map has seven finite waste categories per starting area, roads, blocking scrap walls, neutral outposts and towers. Grid travel runs at four cells per second on traversable ground, including service roads; no road speed bonus or capture access rule exists yet. The shared dump is accessible to either crew. Full combat/capture remains disabled. Older saves retain their original instant starter-cable recovery controls; new sessions require robots.

The v5 runtime now requires SQLite schema 6. The schema-5 envelope migration preserves native IDs, inventory, paid work, observations, version pins and immutable receipt bytes. Schema 6 adds the starter-recovery compatibility marker without rewriting existing envelopes or receipts. Earlier science/robot upgrades run once when needed. Back up the complete SQLite database, including history and cursor keys, before upgrading. Returning to an older binary requires the complete pre-upgrade backup; never combine old inventory with newer receipts. Use the exact pinned runtime while upstream PR #43 is under review.

Polling every two seconds replaces the current snapshot. A failed connection marks the view stale and disables mutations; **Reconnect match** refreshes it. A mutation with an uncertain outcome retains its exact command in memory and exposes **Retry pending command**; it blocks new work until resolved. Conflict responses refresh state and require an explicit new action. Reloading drops pending in-memory commands: inspect the restored membership/inventory/job state before issuing new work.

The earlier v4 service migrates v3 SQLite matches once, preserving material, jobs, energy and immutable receipts while adding pinned science versions and component references. Historical cable assays remain valid for separation; old recovered outputs receive no retroactive property measurements. Earlier v2 matches first receive the existing world migration. Back up first and upgrade both repositories together. Full-game startup remains disabled; additional machines/manufacturing, combat and victory are later work.
