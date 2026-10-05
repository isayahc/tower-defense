import { evaluateUse, planProcess, projectBatch } from "../science/engine.js";
import { cableFixture, separatorFixture } from "../science/fixtures.js";

const cable = cableFixture();
const uninspected = { ...cable, inspection: "uninspected", grade: null, properties: [] };
console.log(
  JSON.stringify(
    {
      mode: "science-fixture-only",
      message:
        "Pure material calculations. No match, inventory, robot simulation, or OpenIndustries mutation is performed.",
      beforeInspection: projectBatch(uninspected),
      uncertainUse: evaluateUse(uninspected, "copper-conductor"),
      recoveryPlan: planProcess(cable, "strip-cable", separatorFixture()),
      directUseOfCable: evaluateUse(cable, "copper-conductor"),
    },
    null,
    2,
  ),
);
