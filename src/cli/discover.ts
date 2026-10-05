import { discoverOpenIndustries } from "../integration/discovery.js";

const checkout = process.argv[2];
if (!checkout || process.argv.length !== 3) {
  console.error("Usage: npm run discover:oi -- <Open-Industries-checkout>");
  process.exitCode = 1;
} else {
  try {
    const report = await discoverOpenIndustries(checkout);
    console.log(JSON.stringify(report, null, 2));
    // Discovery succeeding does not imply game readiness. Useful as a deployment gate.
    process.exitCode = report.readiness.canStartMatch ? 0 : 2;
  } catch {
    console.error(
      "MCP discovery failed. Check the checkout, installed dependencies, and server availability. Match startup remains disabled.",
    );
    process.exitCode = 1;
  }
}
