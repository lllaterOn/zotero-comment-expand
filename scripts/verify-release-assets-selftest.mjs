import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseAsset } from "./verify-release-assets.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheRoot = resolve(root, ".cache");
await mkdir(cacheRoot, { recursive: true });
const temporary = await mkdtemp(join(cacheRoot, "release-assets-"));

try {
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const fileName = `zotero-comment-expand-${version}.xpi`;
  const common = {
    xpiPath: join(root, "dist", fileName),
    checksumPath: join(root, "dist", "SHA256SUMS"),
    tag: `v${version}`,
    sourceManifestPath: join(root, "addon", "manifest.json"),
    outputPath: join(temporary, "manifest.json")
  };

  await verifyReleaseAsset(common);
  assert.deepEqual(
    JSON.parse(await readFile(common.outputPath, "utf8")),
    JSON.parse(await readFile(common.sourceManifestPath, "utf8"))
  );

  const wrongChecksumPath = join(temporary, "SHA256SUMS.bad");
  await writeFile(wrongChecksumPath, `${"0".repeat(64)}  ${fileName}\n`, "utf8");
  await assert.rejects(
    verifyReleaseAsset({ ...common, checksumPath: wrongChecksumPath }),
    /does not match/
  );
  await assert.rejects(
    verifyReleaseAsset({ ...common, tag: "v999.0.0" }),
    /must be named/
  );
} finally {
  if (dirname(temporary) !== cacheRoot) throw new Error(`Unsafe temporary path: ${temporary}`);
  await rm(temporary, { recursive: true, force: true });
}

console.log("Verified release-asset gate success and failure paths");
