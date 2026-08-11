import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeRustSourceHash,
  generatedArtifactNames,
  metadataFileName,
  sha256File,
  wasmOutputDirectory,
  wasmPackVersion,
} from './wasm-artifacts.mjs'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const rustEngine = fileURLToPath(new URL('../../rust-engine', import.meta.url))
const generatedIgnoreFile = fileURLToPath(new URL('../src/wasm/.gitignore', import.meta.url))

const versionResult = spawnSync('wasm-pack', ['--version'], {
  cwd: webRoot,
  encoding: 'utf8',
})

if (versionResult.error) {
  console.error(`Could not start wasm-pack: ${versionResult.error.message}`)
  process.exit(1)
}

const detectedVersion = versionResult.stdout.trim()
if (detectedVersion !== `wasm-pack ${wasmPackVersion}`) {
  console.error(
    `Expected wasm-pack ${wasmPackVersion}, but found ${detectedVersion || 'an unknown version'}.`,
  )
  process.exit(1)
}

const result = spawnSync(
  'wasm-pack',
  ['build', rustEngine, '--target', 'web', '--out-dir', wasmOutputDirectory],
  { cwd: webRoot, stdio: 'inherit' },
)

if (result.error) {
  console.error(`Could not start wasm-pack: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

// wasm-pack 0.15 writes a catch-all ignore file even when its output is meant
// to be committed. Removing it keeps regenerated bindings visible to Git.
rmSync(generatedIgnoreFile, { force: true })

const artifactHashes = Object.fromEntries(
  await Promise.all(
    generatedArtifactNames.map(async (fileName) => [
      fileName,
      await sha256File(join(wasmOutputDirectory, fileName)),
    ]),
  ),
)
const metadata = {
  schemaVersion: 1,
  wasmPackVersion,
  rustSourceHash: await computeRustSourceHash(),
  artifacts: artifactHashes,
}

writeFileSync(
  join(wasmOutputDirectory, metadataFileName),
  `${JSON.stringify(metadata, null, 2)}\n`,
)
