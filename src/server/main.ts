import { startApp } from "./app.js";
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("INVALID_PORT");
try {
  const app = await startApp({
    port,
    serviceUrl: process.env.OI_GAME_SERVICE_URL ?? "http://127.0.0.1:8790",
    ...(process.env.OI_CHECKOUT ? { checkout: process.env.OI_CHECKOUT } : {}),
    ...(process.env.TD_PUBLIC_ORIGIN ? { publicOrigin: process.env.TD_PUBLIC_ORIGIN } : {}),
  });
  console.log(`Tower Defense: ${app.origin}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
} catch {
  console.error("Tower Defense could not start. Check the documented server configuration.");
  process.exitCode = 1;
}
