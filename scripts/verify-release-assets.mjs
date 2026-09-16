import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { PLUGIN_ID, UPDATE_URL } from "./update-release-manifest.mjs";

export async function verifyReleaseAsset({ xpiPath, checksumPath, tag, sourceManifestPath, outputPath }) {
  const version = parseTag(tag);
  const expectedFileName = `zotero-comment-expand-${version}.xpi`;
  if (basename(xpiPath) !== expectedFileName) {
    throw new Error(`Release asset must be named ${expectedFileName}`);
  }

  const [xpi, checksumText, sourceManifest] = await Promise.all([
    readFile(xpiPath),
    readFile(checksumPath, "utf8"),
    readJSON(sourceManifestPath)
  ]);
  const digest = createHash("sha256").update(xpi).digest("hex");
  if (checksumText !== `${digest}  ${expectedFileName}\n`) {
    throw new Error("Published SHA256SUMS does not match the XPI asset");
  }

  const packagedManifest = JSON.parse(readStoredEntry(xpi, "manifest.json").toString("utf8"));
  if (packagedManifest.version !== version) {
    throw new Error(`Packaged manifest version ${packagedManifest.version} does not match ${tag}`);
  }
  const zotero = packagedManifest.applications?.zotero;
  if (zotero?.id !== PLUGIN_ID || zotero.update_url !== UPDATE_URL) {
    throw new Error("Packaged manifest has an unexpected plugin identity or update URL");
  }
  if (!isDeepStrictEqual(packagedManifest, sourceManifest)) {
    throw new Error("Packaged manifest differs from the manifest at the release tag");
  }

  await writeFile(outputPath, `${JSON.stringify(packagedManifest, null, 2)}\n`, "utf8");
}

function readStoredEntry(archive, expectedName) {
  let offset = 0;
  let found;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    if (flags & 0x0008) throw new Error("XPI data descriptors are not supported");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > archive.length) throw new Error("Truncated XPI entry");
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (name === expectedName) {
      if (found) throw new Error(`Duplicate ${expectedName} in XPI`);
      if (method !== 0) throw new Error(`${expectedName} must use the deterministic stored ZIP method`);
      found = archive.subarray(dataStart, dataEnd);
    }
    offset = dataEnd;
  }
  if (!found) throw new Error(`Missing ${expectedName} in XPI`);
  return found;
}

function parseTag(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!match) throw new Error(`Unsupported release tag: ${tag}`);
  return match.slice(1).join(".");
}

async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await verifyReleaseAsset({
    xpiPath: resolve(required(options, "xpi")),
    checksumPath: resolve(required(options, "checksum-file")),
    tag: required(options, "tag"),
    sourceManifestPath: resolve(required(options, "source-manifest")),
    outputPath: resolve(required(options, "output"))
  });
  console.log(`Verified published release asset ${options.tag}`);
}

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument near ${key ?? "end"}`);
    options[key.slice(2)] = value;
  }
  return options;
}

function required(options, key) {
  if (!options[key]) throw new Error(`Missing --${key}`);
  return options[key];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
