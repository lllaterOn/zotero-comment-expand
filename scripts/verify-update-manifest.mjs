import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildUpdateManifest,
  compareVersions,
  PLUGIN_ID,
  UPDATE_URL
} from "./update-release-manifest.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [content, packageJSON, releaseManifest] = await Promise.all([
  readFile(join(root, "updates.json"), "utf8"),
  readJSON(join(root, "package.json")),
  readJSON(join(root, "addon", "manifest.json"))
]);
const updateManifest = JSON.parse(content);
const updates = updateManifest.addons?.[PLUGIN_ID]?.updates;
if (!Array.isArray(updates)) throw new Error("Update manifest is missing the Comment Expand update list");
if (releaseManifest.applications?.zotero?.update_url !== UPDATE_URL) {
  throw new Error("Plugin manifest does not point to the maintained update manifest");
}

const versions = new Set();
for (const [index, update] of updates.entries()) {
  if (versions.has(update.version)) throw new Error(`Duplicate update version: ${update.version}`);
  versions.add(update.version);
  if (index && compareVersions(updates[index - 1].version, update.version) >= 0) {
    throw new Error("Update entries are not in ascending semantic-version order");
  }
  if (compareVersions(update.version, packageJSON.version) > 0) {
    throw new Error(`Update ${update.version} is newer than the maintained source version`);
  }
  const expectedLink = `https://github.com/lllaterOn/zotero-comment-expand/releases/download/v${update.version}/zotero-comment-expand-${update.version}.xpi`;
  if (update.update_link !== expectedLink || !/^sha256:[a-f0-9]{64}$/.test(update.update_hash)) {
    throw new Error(`Invalid download metadata for update ${update.version}`);
  }
  const compatibility = update.applications?.zotero;
  if (typeof compatibility?.strict_min_version !== "string"
    || typeof compatibility.strict_max_version !== "string") {
    throw new Error(`Missing Zotero compatibility metadata for update ${update.version}`);
  }
}

const sampleDigest = "a".repeat(64);
const generated = buildUpdateManifest({
  currentManifest: updateManifest,
  releaseManifest,
  tag: `v${releaseManifest.version}`,
  checksumText: `${sampleDigest}  zotero-comment-expand-${releaseManifest.version}.xpi\n`
});
const generatedUpdate = generated.addons[PLUGIN_ID].updates.at(-1);
if (generatedUpdate.version !== releaseManifest.version
  || generatedUpdate.update_hash !== `sha256:${sampleDigest}`) {
  throw new Error("Update-manifest generator did not record the release candidate correctly");
}

if (content !== `${JSON.stringify(updateManifest, null, 2)}\n`) {
  throw new Error("updates.json does not use the deterministic project format");
}
console.log(`Verified update manifest with ${updates.length} published release(s)`);

async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
