# Tower Defense

Tower Defense is a planned two-player strategy game about building an industrial war machine while defending your own tower and attacking your opponent's tower.

This repository currently contains the game specification only. The game itself has not been implemented.

## Core Idea

Two players share one continuously running match. Each player controls a tower and a network of industrial cities. Cities gather resources and run machines that manufacture defenses, ammunition, vehicles, and raiding units.

The goal is to destroy the opposing tower before your own tower falls.

## Players

- Exactly two players participate in a match.
- Each player owns one tower and begins with at least one industrial city.
- Both players can defend their own tower and raid the opposing tower.
- A player wins when the OpenIndustries server confirms that the opposing tower has been destroyed.
- A disconnected player remains in the match while their existing industries and automated machines continue to run.

## Game Loop

1. Industrial cities extract and process resources.
2. Players configure machines to generate power, materials, ammunition, defenses, or attack units.
3. Defensive machines protect cities, supply routes, and towers.
4. Raid machines produce and dispatch units toward the opposing tower.
5. Players can attack enemy industry to weaken production before attempting a final tower assault.
6. The match continues until one tower reaches zero health.

## OpenIndustries MCP Requirement

All authoritative game state must be managed through an **OpenIndustries MCP server**. The client is a presentation and command layer only; it must not calculate trusted resources, resolve combat, or decide the winner locally.

The OpenIndustries MCP integration must provide capabilities for:

- Creating and joining a two-player match
- Assigning one tower to each player
- Reading the current match, player, city, machine, unit, and tower state
- Constructing, configuring, upgrading, starting, and stopping machines
- Generating and consuming resources over time
- Producing defensive structures and raiding units
- Issuing defend, attack, retreat, and target commands
- Resolving combat and tower damage on the server
- Streaming or polling authoritative state changes
- Continuing production and combat while clients are disconnected
- Recording the winner and final match result

Exact MCP tool and resource names must be taken from the connected OpenIndustries server's published schema during implementation. The game must discover and validate that schema at startup rather than relying on undocumented tool names.

## Server Authority

The OpenIndustries MCP server is responsible for:

- Match membership and player identity
- Ownership and permission checks
- The simulation clock
- Resource balances and production queues
- Machine construction and output
- Unit movement and combat resolution
- Tower health and destruction
- Victory, defeat, reconnection, and match history

Every mutating command must include the match and player identity, be validated against the latest server state, and return the resulting authoritative state. Commands should be idempotent so retries cannot duplicate machines, units, or attacks.

## Expected Match Flow

1. Player one creates a match through OpenIndustries and receives an invite code.
2. Player two joins with that code.
3. OpenIndustries creates both towers, starting cities, resources, and player assignments.
4. Both clients subscribe to the same match state.
5. Players build industries and issue defensive or offensive orders through MCP commands.
6. OpenIndustries runs the simulation continuously and sends state updates to both clients.
7. OpenIndustries declares the result when a tower is destroyed.

## Fair Play and Security

- Clients must never hold OpenIndustries server credentials that grant administrative access.
- A player may only command assets owned by that player.
- Server timestamps, not client clocks, determine production and cooldowns.
- The server must reject stale, invalid, unaffordable, or unauthorized commands.
- Both players must receive the same public match state while private information remains scoped to its owner.
- Reconnection must restore state from OpenIndustries instead of trusting a local save.

## Initial Scope

The first playable version should include:

- One two-player map
- One tower per player
- Industrial cities that can be captured or disabled
- Power, metal, and ammunition resources
- Generator, refinery, factory, turret, and raid-launcher machines
- Automated production queues
- Basic defensive and raiding units
- Live match updates from OpenIndustries MCP
- Clear victory and defeat states

## Out of Scope for the First Version

- Single-player or local simulation
- Matches with more than two players
- Client-authoritative offline saves
- Trading or a global economy
- Cosmetic purchases
- User-created maps

## Implementation Rule

Do not implement a local fallback simulation. If OpenIndustries MCP is unavailable or does not expose the required capabilities, the game should display an integration error and prevent the match from starting.
