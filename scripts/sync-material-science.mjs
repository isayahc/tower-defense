import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const checkout = process.env.OI_CHECKOUT;
if (!checkout) throw new Error("Set OI_CHECKOUT to the pinned Open-Industries checkout.");
const source = resolve(checkout, "packages/material-science");
const target = resolve("vendor/material-science");
if (!process.argv.includes("--write")) {
  const expected = (await readdir(join(source, "dist"))).sort();
  const actual = (await readdir(join(target, "dist"))).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("Material package file list drift");
}
const files = [
  "package.json",
  ...(await readdir(join(source, "dist"))).sort().map((f) => `dist/${f}`),
];
for (const file of files) {
  // Git may check the upstream text out as CRLF on Windows. Compare its
  // canonical LF representation; all other bytes must still agree.
  const expected = (await readFile(join(source, file), "utf8")).replace(/\r\n/g, "\n");
  if (process.argv.includes("--write")) {
    await mkdir(resolve(target, file, ".."), { recursive: true });
    await writeFile(join(target, file), expected);
  } else if ((await readFile(join(target, file), "utf8")).replace(/\r\n/g, "\n") !== expected)
    throw new Error(`Material engine drift: ${file}`);
}
console.log(`Verified ${files.length} material package files against Open-Industries.`);
