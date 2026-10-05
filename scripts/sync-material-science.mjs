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
  const expected = await readFile(join(source, file));
  if (process.argv.includes("--write")) {
    await mkdir(resolve(target, file, ".."), { recursive: true });
    await writeFile(join(target, file), expected);
  } else if (!(await readFile(join(target, file))).equals(expected))
    throw new Error(`Material engine drift: ${file}`);
}
console.log(`Verified ${files.length} material package files against Open-Industries.`);
