import { createHash } from "node:crypto"
import { readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = join(root, "assets", "release-media.json")
const assetSpecs = [
  { path: "assets/screenshot.png", format: "png" },
  { path: "assets/demo.gif", format: "gif" },
  { path: "assets/demo-vertical.mp4", format: "mp4" },
  { path: "assets/social-preview.png", format: "png" },
]

function assertFormat(buffer, format, path) {
  if (buffer.length === 0) throw new Error(`${path} is empty`)
  if (format === "png" && !buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    throw new Error(`${path} is not a PNG`)
  }
  if (format === "gif" && !["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) {
    throw new Error(`${path} is not a GIF`)
  }
  if (format === "mp4" && (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp")) {
    throw new Error(`${path} is not an MP4`)
  }
}

async function inspectAssets() {
  const entries = {}
  for (const spec of assetSpecs) {
    let buffer
    try {
      buffer = await readFile(join(root, spec.path))
    } catch (error) {
      throw new Error(`${spec.path} is missing: ${error instanceof Error ? error.message : String(error)}`)
    }
    assertFormat(buffer, spec.format, spec.path)
    entries[spec.path] = {
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    }
  }
  return entries
}

async function packageVersion() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  if (typeof packageJson.version !== "string" || !packageJson.version) throw new Error("package.json has no version")
  return packageJson.version
}

async function writeManifest(version, assets) {
  const temporary = `${manifestPath}.${process.pid}.tmp`
  const manifest = `${JSON.stringify({ version, assets }, null, 2)}\n`
  await writeFile(temporary, manifest, { mode: 0o644 })
  await rename(temporary, manifestPath)
  process.stdout.write(`wrote ${relative(root, manifestPath)} for v${version}\n`)
}

async function verifyManifest(version, assets) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch (error) {
    throw new Error(`assets/release-media.json is missing or invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest.version !== version) {
    throw new Error(`release media version ${JSON.stringify(manifest.version)} does not match package v${version}`)
  }
  for (const spec of assetSpecs) {
    const expected = manifest.assets?.[spec.path]
    const actual = assets[spec.path]
    if (!expected || expected.sha256 !== actual.sha256 || expected.bytes !== actual.bytes) {
      throw new Error(`${spec.path} does not match assets/release-media.json`)
    }
  }
  process.stdout.write(`release media verified for v${version}\n`)
}

const args = process.argv.slice(2)
if (args.some((arg) => arg !== "--write") || args.filter((arg) => arg === "--write").length > 1) {
  throw new Error("Usage: node scripts/check-release-assets.mjs [--write]")
}

const version = await packageVersion()
const assets = await inspectAssets()
if (args.includes("--write")) await writeManifest(version, assets)
else await verifyManifest(version, assets)
