import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await Promise.all([
  rm(cleanTarget("build"), { recursive: true, force: true }),
  rm(cleanTarget("dist"), { recursive: true, force: true })
]);

function cleanTarget(name) {
  const target = resolve(root, name);
  if (dirname(target) !== root || basename(target) !== name || !["build", "dist"].includes(name)) {
    throw new Error(`Refusing to clean unexpected path: ${target}`);
  }
  return target;
}
