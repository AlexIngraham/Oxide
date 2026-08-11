import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))

export const repositoryRoot = join(scriptsDirectory, '..', '..')
export const rustEngineRoot = join(repositoryRoot, 'rust-engine')
export const wasmOutputDirectory = join(repositoryRoot, 'web', 'src', 'wasm')
export const wasmPackVersion = '0.15.0'
export const metadataFileName = 'build-metadata.json'

export const generatedArtifactNames = [
  'LICENSE',
  'package.json',
  'rust_engine.d.ts',
  'rust_engine.js',
  'rust_engine_bg.wasm',
  'rust_engine_bg.wasm.d.ts',
]

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'target' && entry.name !== 'pkg') {
        files.push(...(await listFiles(entryPath)))
      }
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}

function portablePath(filePath) {
  return relative(repositoryRoot, filePath).split(sep).join('/')
}

export async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

export async function computeRustSourceHash() {
  const rustInputFiles = (await listFiles(rustEngineRoot)).filter((filePath) => {
    const extension = extname(filePath)
    return (
      extension === '.rs' ||
      extension === '.toml' ||
      basename(filePath) === 'Cargo.lock' ||
      basename(filePath) === 'LICENSE'
    )
  })
  const inputFiles = [
    join(repositoryRoot, 'rust-toolchain.toml'),
    join(repositoryRoot, 'web', 'scripts', 'build-wasm.mjs'),
    join(repositoryRoot, 'web', 'scripts', 'wasm-artifacts.mjs'),
    ...rustInputFiles,
  ].sort((left, right) => portablePath(left).localeCompare(portablePath(right)))

  const hash = createHash('sha256')

  for (const filePath of inputFiles) {
    const normalizedText = (await readFile(filePath, 'utf8')).replaceAll('\r\n', '\n')
    hash.update(portablePath(filePath))
    hash.update('\0')
    hash.update(normalizedText)
    hash.update('\0')
  }

  return hash.digest('hex')
}
