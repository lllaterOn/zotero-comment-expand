import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staging = join(root, "build", "addon");
const packageJSON = await readJSON(join(root, "package.json"));
const packageLock = await readJSON(join(root, "package-lock.json"));
const sourceManifest = await readJSON(join(root, "addon", "manifest.json"));
const updateManifest = await readJSON(join(root, "updates.json"));
const manifest = await readJSON(join(staging, "manifest.json"));
const zotero = manifest.applications?.zotero;

const versions = [
  packageJSON.version,
  packageLock.version,
  packageLock.packages?.[""]?.version,
  sourceManifest.version,
  manifest.version
];
if (versions.some(version => version !== packageJSON.version)) {
  throw new Error(`Version metadata differs: ${versions.join(", ")}`);
}
if (packageJSON.name !== "zotero-comment-expand"
  || packageJSON.private !== true
  || packageJSON.license !== "MIT") {
  throw new Error("Unexpected package identity");
}
if (zotero?.id !== "comment-expand@lllateron") throw new Error("Unexpected plugin ID");
if (zotero.update_url !== "https://raw.githubusercontent.com/lllaterOn/zotero-comment-expand/main/updates.json") {
  throw new Error("Unexpected plugin update URL");
}
if (!Array.isArray(updateManifest.addons?.[zotero.id]?.updates)) {
  throw new Error("Missing public update manifest for the plugin ID");
}
if (manifest.homepage_url !== "https://github.com/lllaterOn/zotero-comment-expand") {
  throw new Error("Unexpected plugin homepage");
}
if (typeof zotero.strict_min_version !== "string" || typeof zotero.strict_max_version !== "string") {
  throw new Error("Missing Zotero compatibility range");
}
if (manifest.icons?.["48"] !== "icon.svg" || manifest.icons?.["96"] !== "icon.svg") {
  throw new Error("Missing Comment Expand plugin icons");
}

const requiredFiles = ["LICENSE", "bootstrap.js", "icon.svg", "manifest.json", "runtime.js"];
for (const required of requiredFiles) await access(join(staging, required));

const stagedFiles = await walk(staging);
if (stagedFiles.some(path => path.endsWith(".map"))) {
  throw new Error("Source maps must not be included in the release package");
}

const bundle = await readFile(join(staging, "runtime.js"), "utf8");
if (!bundle.includes("CommentExpandRuntime")) {
  throw new Error("Runtime bundle does not expose CommentExpandRuntime");
}
const bootstrap = await readFile(join(staging, "bootstrap.js"), "utf8");
if (!bootstrap.includes("runtime.js") || !bootstrap.includes("CommentExpandRuntime")) {
  throw new Error("Bootstrap does not load the packaged runtime");
}

const icon = await readFile(join(staging, "icon.svg"), "utf8");
if (!/<svg\b[^>]*viewBox=["'][^"']+["']/i.test(icon)
  || /(?:<image\b|@import|(?:href|xlink:href)\s*=|data:image)/i.test(icon)) {
  throw new Error("Comment Expand icon does not satisfy the SVG resource contract");
}

const fileName = `zotero-comment-expand-${packageJSON.version}.xpi`;
const xpi = await readFile(join(root, "dist", fileName));
const checksum = await readFile(join(root, "dist", "SHA256SUMS"), "utf8");
const digest = createHash("sha256").update(xpi).digest("hex");
if (checksum !== `${digest}  ${fileName}\n`) throw new Error("SHA256SUMS does not match the XPI");

const archivedFiles = listZipEntries(xpi);
const expectedFiles = stagedFiles
  .map(path => relative(staging, path).replaceAll("\\", "/"))
  .sort((left, right) => left.localeCompare(right, "en"));
if (JSON.stringify(archivedFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error("XPI entries differ from the staged add-on files");
}

const forbidden = [
  new RegExp(`\\b(?:${["gh" + "p_", "gh" + "o_", "gh" + "u_", "gh" + "s_", "gh" + "r_"].join("|")}|${"github" + "_pat_"})[A-Za-z0-9_]{20,}\\b`),
  /secretKey\s*[=:]\s*["'][a-f0-9]{20,}/i,
  new RegExp("BEGIN " + "(?:RSA |EC |OPENSSH )?" + "PRIVATE KEY"),
  /(?:[A-Za-z]:\\Users\\[^\s"'<>]+|\/Users\/[^/\s"'<>]+|\/home\/[^/\s"'<>]+)/
];
for (const path of stagedFiles) {
  const content = await readFile(path, "utf8");
  if (forbidden.some(pattern => pattern.test(content))) {
    throw new Error(`Possible secret or machine-specific path in ${relative(staging, path)}`);
  }
}

console.log(`Verified Zotero Comment Expand ${manifest.version}`);

function listZipEntries(archive) {
  const endOffset = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0 || endOffset + 22 !== archive.length) throw new Error("Invalid XPI end record");
  const count = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (centralOffset + centralSize !== endOffset) throw new Error("Invalid XPI central directory");

  const names = [];
  let offset = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid XPI entry header");
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name.startsWith("/") || name.includes("../") || name.includes("\\")) {
      throw new Error(`Unsafe XPI entry: ${name}`);
    }
    names.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== endOffset) throw new Error("Unexpected data after XPI central directory");
  return names;
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
