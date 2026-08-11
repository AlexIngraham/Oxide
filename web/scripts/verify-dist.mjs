import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = join(webRoot, 'dist')
const assetsDirectory = join(outputDirectory, 'assets')

function fail(message) {
  console.error(`Production bundle check failed: ${message}`)
  process.exit(1)
}

let html
let assetNames
try {
  ;[html, assetNames] = await Promise.all([
    readFile(join(outputDirectory, 'index.html'), 'utf8'),
    readdir(assetsDirectory),
  ])
} catch (error) {
  fail(error instanceof Error ? error.message : 'the Vite output is missing or unreadable.')
}

if (html.includes('/src/') || !html.includes('type="module"')) {
  fail('index.html still contains a development entry point.')
}

const staticReferences = [...html.matchAll(/(?:href|src)="\/([^"#?]+)"/gu)].map(
  (match) => match[1],
)
for (const reference of staticReferences) {
  try {
    if (!(await stat(join(outputDirectory, reference))).isFile()) {
      fail(`/${reference} does not resolve to a file in dist.`)
    }
  } catch {
    fail(`/${reference} does not resolve to a file in dist.`)
  }
}

const wasmAssetNames = assetNames.filter((fileName) => fileName.endsWith('.wasm'))
if (wasmAssetNames.length !== 1) {
  fail(`expected one emitted WebAssembly asset, found ${wasmAssetNames.length}.`)
}

const wasmAssetName = wasmAssetNames[0]
const wasmBytes = await readFile(join(assetsDirectory, wasmAssetName))
const sourceWasmBytes = await readFile(join(webRoot, 'src', 'wasm', 'rust_engine_bg.wasm'))
const expectedHeader = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]
if (!expectedHeader.every((byte, index) => wasmBytes[index] === byte)) {
  fail(`${wasmAssetName} does not contain a valid WebAssembly header.`)
}
if (!wasmBytes.equals(sourceWasmBytes)) {
  fail('Vite did not emit the verified WebAssembly module byte-for-byte.')
}

const javascriptAssets = await Promise.all(
  assetNames
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => readFile(join(assetsDirectory, fileName), 'utf8')),
)
if (!javascriptAssets.some((source) => source.includes(wasmAssetName))) {
  fail('the JavaScript bundle does not reference the emitted WebAssembly asset.')
}

for (const publicAsset of ['favicon.svg', 'sample-studio.webp']) {
  try {
    if (!(await stat(join(outputDirectory, publicAsset))).isFile()) {
      fail(`${publicAsset} was not copied into dist.`)
    }
  } catch {
    fail(`${publicAsset} was not copied into dist.`)
  }
}

console.log(
  `Verified production bundle and hashed WASM asset ${wasmAssetName} (${wasmBytes.length.toLocaleString()} bytes).`,
)
