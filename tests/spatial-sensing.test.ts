import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coverageRecords,
  latestObservation,
  sensorReady,
  targetSummary,
  type SpatialSnapshot,
} from "../src/web/spatial-sensing.js";

const snapshot = (): SpatialSnapshot => ({
  match_id: "11111111-1111-4111-8111-111111111111",
  revision: 7,
  status: "active",
  world: {
    deposits: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        position: { x: 20, y: 10 },
        revision: 3,
        depleted: false,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        position: { x: 30, y: 12 },
        revision: 1,
        depleted: false,
      },
    ],
  },
  field: {
    sensor_catalog: [
      {
        id: "camera-depth",
        range: 8,
        duration_ms: 2000,
        power_w: 20,
        kit: null,
        establishes: "Visible geometry only.",
      },
      {
        id: "nir",
        range: 3,
        duration_ms: 3000,
        power_w: 40,
        kit: "nir-sensor-kit",
        establishes: "Candidate polymer class only.",
      },
    ],
    observations: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        target_id: "22222222-2222-4222-8222-222222222222",
        target_revision: 2,
        sensor: "camera-depth",
        sensor_version: "field-sensors-v1",
        position: { x: 18, y: 10 },
        timestamp_ms: 1000,
        range: 2,
        quality: "dirty",
        confidence_bps: 4000,
        candidate_classes: ["unclassified"],
        cues: ["Dirty surface"],
        next_actions: ["try-another-sensor"],
        uncertainty_meaning: "bounded-game-fixture-not-hardware-accuracy",
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        target_id: "22222222-2222-4222-8222-222222222222",
        target_revision: 3,
        sensor: "camera-depth",
        sensor_version: "field-sensors-v1",
        position: { x: 19, y: 10 },
        timestamp_ms: 2000,
        range: 1,
        quality: "clear",
        confidence_bps: 7500,
        candidate_classes: ["unclassified", "polymer-candidate"],
        cues: ["Exposed surface geometry"],
        next_actions: ["collect-for-bench-inspection"],
        uncertainty_meaning: "bounded-game-fixture-not-hardware-accuracy",
      },
    ],
    robots: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        sensors: ["camera-depth", "magnetic-inductive"],
        position: { x: 13, y: 27 },
      },
    ],
    jobs: [],
  },
  science: {
    components: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        kind: "nir-sensor-kit",
        quantity: 1,
        tested: false,
        condition: "unknown",
      },
    ],
  },
});

test("private target summaries expose only retained crew evidence", () => {
  const state = snapshot();
  const known = state.world.deposits[0];
  const unknown = state.world.deposits[1];
  assert(known && unknown);

  assert.equal(latestObservation(state, known.id)?.id, "55555555-5555-4555-8555-555555555555");
  assert.equal(targetSummary(state, known).current, true);
  assert.match(targetSummary(state, known).title, /polymer-candidate/);
  assert.match(targetSummary(state, known).detail, /75% confidence/);
  assert.equal(targetSummary(state, unknown).title, "Unknown target · 30, 12");

  const poisoned = {
    ...state,
    opponent_field: {
      observations: [{ target_id: unknown.id, hidden_composition: "steel" }],
    },
  } as unknown as SpatialSnapshot;
  assert.equal(targetSummary(poisoned, unknown).title, "Unknown target · 30, 12");
});

test("coverage uses the latest observation for each target and sensor", () => {
  const records = coverageRecords(snapshot());
  assert.equal(records.length, 1);
  assert.equal(records[0]?.id, "55555555-5555-4555-8555-555555555555");
  assert.equal(records[0]?.sensor_range, 8);
});

test("advanced sensors remain locked until their owned kit is tested", () => {
  const state = snapshot();
  const robot = state.field.robots[0];
  const camera = state.field.sensor_catalog[0];
  const nir = state.field.sensor_catalog[1];
  assert(robot && camera && nir);

  assert.equal(sensorReady(state, robot, camera), true);
  assert.equal(sensorReady(state, robot, nir), false);
  const kit = state.science.components[0];
  assert(kit);
  kit.tested = true;
  kit.condition = "sound";
  assert.equal(sensorReady(state, robot, nir), true);
});
