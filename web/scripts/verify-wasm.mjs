import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  computeRustSourceHash,
  generatedArtifactNames,
  metadataFileName,
  sha256File,
  wasmOutputDirectory,
  wasmPackVersion,
} from './wasm-artifacts.mjs'

function fail(message) {
  console.error(`WASM artifact check failed: ${message}`)
  console.error('Run `npm run build:wasm` with the pinned wasm-pack version, then commit the output.')
  process.exit(1)
}

let metadata
try {
  metadata = JSON.parse(await readFile(join(wasmOutputDirectory, metadataFileName), 'utf8'))
} catch (error) {
  fail(
    error instanceof Error
      ? `${metadataFileName} is missing or invalid (${error.message}).`
      : `${metadataFileName} is missing or invalid.`,
  )
}

if (metadata.schemaVersion !== 1 || metadata.wasmPackVersion !== wasmPackVersion) {
  fail(`metadata does not describe wasm-pack ${wasmPackVersion} output.`)
}

const sourceHash = await computeRustSourceHash()
if (metadata.rustSourceHash !== sourceHash) {
  fail('the Rust source or build configuration changed after the committed WASM package was generated.')
}

for (const fileName of generatedArtifactNames) {
  const expectedHash = metadata.artifacts?.[fileName]
  let actualHash

  try {
    actualHash = await sha256File(join(wasmOutputDirectory, fileName))
  } catch (error) {
    fail(
      error instanceof Error
        ? `${fileName} is missing or unreadable (${error.message}).`
        : `${fileName} is missing or unreadable.`,
    )
  }

  if (typeof expectedHash !== 'string' || expectedHash !== actualHash) {
    fail(`${fileName} does not match the generated artifact manifest.`)
  }
}

const wasmBytes = await readFile(join(wasmOutputDirectory, 'rust_engine_bg.wasm'))
const expectedHeader = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]
if (wasmBytes.length <= expectedHeader.length) {
  fail('rust_engine_bg.wasm is empty or truncated.')
}
if (!expectedHeader.every((byte, index) => wasmBytes[index] === byte)) {
  fail('rust_engine_bg.wasm does not contain a valid WebAssembly header.')
}

const glue = await readFile(join(wasmOutputDirectory, 'rust_engine.js'), 'utf8')
if (!/new URL\(['"]rust_engine_bg\.wasm['"], import\.meta\.url\)/u.test(glue)) {
  fail('rust_engine.js does not resolve its WebAssembly module relative to import.meta.url.')
}

console.log(`Verified committed WASM artifacts (${wasmBytes.length.toLocaleString()} bytes).`)
