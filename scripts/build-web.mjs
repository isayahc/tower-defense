import { cp } from "node:fs/promises";
await cp(new URL("../src/web/", import.meta.url), new URL("../dist/web/", import.meta.url), {
  recursive: true,
});
