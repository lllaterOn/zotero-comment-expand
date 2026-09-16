import { createHash } from "node:crypto";
import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const buildDirectory = cleanTarget("build");
const staging = join(buildDirectory, "addon");
const dist = cleanTarget("dist");

await Promise.all([
  rm(buildDirectory, { recursive: true, force: true }),
  rm(dist, { recursive: true, force: true })
]);
await mkdir(staging, { recursive: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "addon"), staging, { recursive: true });
await copyFile(join(root, "LICENSE"), join(staging, "LICENSE"));

await build({
  absWorkingDir: root,
  entryPoints: ["./src/main.ts"],
  outfile: "build/addon/runtime.js",
  bundle: true,
  format: "iife",
  globalName: "CommentExpandRuntime",
  platform: "browser",
  target: "firefox115",
  sourcemap: false,
  legalComments: "none",
  charset: "utf8"
});

const packageJSON = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifestPath = join(staging, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version = packageJSON.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

const entries = [];
for (const path of await filesUnder(staging)) {
  entries.push({
    name: relative(staging, path).replaceAll("\\", "/"),
    data: await readFile(path)
  });
}

const fileName = `zotero-comment-expand-${packageJSON.version}.xpi`;
const xpiPath = join(dist, fileName);
const archive = createStoredZip(entries);
await writeFile(xpiPath, archive);
const digest = createHash("sha256").update(archive).digest("hex");
await writeFile(join(dist, "SHA256SUMS"), `${digest}  ${fileName}\n`, "utf8");

console.log(`Built ${xpiPath}`);
console.log(`SHA-256 ${digest}`);

async function filesUnder(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

function createStoredZip(entriesToArchive) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entriesToArchive) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x2821, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2821, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entriesToArchive.length, 8);
  end.writeUInt16LE(entriesToArchive.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function cleanTarget(name) {
  const target = resolve(root, name);
  if (dirname(target) !== root || basename(target) !== name || !["build", "dist"].includes(name)) {
    throw new Error(`Refusing to clean unexpected path: ${target}`);
  }
  return target;
}
