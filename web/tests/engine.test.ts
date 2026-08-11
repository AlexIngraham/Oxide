import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { sobel_edges } from '../src/wasm/rust_engine.js'
import {
  DEFAULT_FILTER_PARAMETERS,
  FILTER_DEFINITIONS,
  FILTER_DEFINITIONS_BY_ID,
  adjustBrightness,
  adjustClarity,
  adjustHighlights,
  adjustTexture,
  applyJavaScriptFilter,
  gaussianBlur,
  sobelEdges,
  type FilterId,
  type FilterParameters,
} from '../src/engine/filters.ts'
import { benchmarkComparison, comparePixelBuffers, median } from '../src/engine/benchmark.ts'
import { applyWasmFilter, initializeWasm } from '../src/engine/wasm.ts'

const wasmBytes = await readFile(new URL('../src/wasm/rust_engine_bg.wasm', import.meta.url))
await initializeWasm({ module_or_path: wasmBytes })

function deterministicPixels(width: number, height: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  let state = 0x5eed1234
  for (let index = 0; index < pixels.length; index += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    pixels[index] = state & 0xff
    pixels[index + 1] = (state >>> 8) & 0xff
    pixels[index + 2] = (state >>> 16) & 0xff
    pixels[index + 3] = (state >>> 24) & 0xff
  }
  return pixels
}

function withDeterministicClock<T>(callback: (advance: (durationMs: number) => void) => T): T {
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance')
  let currentTime = 0

  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => currentTime },
  })

  try {
    return callback((durationMs) => {
      currentTime += durationMs
    })
  } finally {
    if (originalPerformance) {
      Object.defineProperty(globalThis, 'performance', originalPerformance)
    } else {
      Reflect.deleteProperty(globalThis, 'performance')
    }
  }
}

const filterCases: ReadonlyArray<{
  filter: FilterId
  parameters?: Partial<FilterParameters>
}> = [
  { filter: 'grayscale' },
  { filter: 'brightness', parameters: { brightness: -100 } },
  { filter: 'brightness', parameters: { brightness: 20 } },
  { filter: 'brightness', parameters: { brightness: 100 } },
  { filter: 'contrast', parameters: { contrast: -100 } },
  { filter: 'contrast', parameters: { contrast: 25 } },
  { filter: 'contrast', parameters: { contrast: 100 } },
  { filter: 'saturation', parameters: { saturation: -100 } },
  { filter: 'saturation', parameters: { saturation: 35 } },
  { filter: 'saturation', parameters: { saturation: 100 } },
  { filter: 'highlights', parameters: { highlights: -100 } },
  { filter: 'highlights', parameters: { highlights: 0 } },
  { filter: 'highlights', parameters: { highlights: 100 } },
  { filter: 'texture', parameters: { texture: -100 } },
  { filter: 'texture', parameters: { texture: 0 } },
  { filter: 'texture', parameters: { texture: 100 } },
  { filter: 'clarity', parameters: { clarity: -100 } },
  { filter: 'clarity', parameters: { clarity: 0 } },
  { filter: 'clarity', parameters: { clarity: 100 } },
  { filter: 'gaussian-blur', parameters: { blurRadius: 0 } },
  { filter: 'gaussian-blur', parameters: { blurRadius: 1 } },
  { filter: 'gaussian-blur', parameters: { blurRadius: 3 } },
  { filter: 'gaussian-blur', parameters: { blurRadius: 4 } },
  { filter: 'sobel-edges', parameters: { edgeThreshold: 0 } },
  { filter: 'sobel-edges', parameters: { edgeThreshold: 80 } },
  { filter: 'sobel-edges', parameters: { edgeThreshold: 255 } },
]

test('filter metadata is complete, unique, and has valid defaults', () => {
  const ids = FILTER_DEFINITIONS.map(({ id }) => id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(Object.keys(FILTER_DEFINITIONS_BY_ID).sort(), [...ids].sort())

  for (const definition of FILTER_DEFINITIONS) {
    assert.equal(FILTER_DEFINITIONS_BY_ID[definition.id], definition)
    if (!definition.control) continue
    const { key, min, max, step } = definition.control
    const defaultValue = DEFAULT_FILTER_PARAMETERS[key]
    assert.equal(Number.isFinite(defaultValue), true)
    assert.equal(defaultValue >= min && defaultValue <= max, true)
    assert.equal(Number.isFinite(step) && step > 0, true)
  }
})

test('TypeScript and Rust/WASM stay equivalent across dimensions and extremes', async (context) => {
  const dimensions = [
    [1, 1],
    [1, 9],
    [8, 1],
    [2, 2],
    [7, 5],
    [31, 19],
  ] as const

  for (const [width, height] of dimensions) {
    for (const filterCase of filterCases) {
      const parameterLabel = filterCase.parameters ? ` ${JSON.stringify(filterCase.parameters)}` : ''
      await context.test(`${filterCase.filter}${parameterLabel} at ${width}x${height}`, () => {
        const source = deterministicPixels(width, height)
        const javascriptOutput = new Uint8ClampedArray(source)
        const wasmOutput = new Uint8ClampedArray(source)
        const parameters = { ...DEFAULT_FILTER_PARAMETERS, ...filterCase.parameters }

        applyJavaScriptFilter(javascriptOutput, width, height, filterCase.filter, parameters)
        applyWasmFilter(wasmOutput, width, height, filterCase.filter, parameters)

        const agreement = comparePixelBuffers(javascriptOutput, wasmOutput, 1)
        assert.equal(
          agreement.withinTolerance,
          true,
          `maximum channel delta was ${agreement.maxChannelDelta}`,
        )
        for (let index = 3; index < source.length; index += 4) {
          assert.equal(javascriptOutput[index], source[index], 'TypeScript changed alpha')
          assert.equal(wasmOutput[index], source[index], 'Rust/WASM changed alpha')
        }
      })
    }
  }
})

test('point filters reject malformed RGBA buffers before mutation', () => {
  const pixels = new Uint8ClampedArray([10, 20, 30])
  assert.throws(() => adjustBrightness(pixels, 20), /multiple of 4/)
  assert.deepEqual([...pixels], [10, 20, 30])
})

test('spatial filters reject dimension mismatches before mutation', () => {
  const pixels = new Uint8ClampedArray([10, 20, 30, 40])
  assert.throws(() => gaussianBlur(pixels, 2, 2, 1), /Expected 16 RGBA bytes/)
  assert.deepEqual([...pixels], [10, 20, 30, 40])
})

test('Gaussian blur has a deterministic impulse response', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 1, 255, 255, 255, 2, 0, 0, 0, 3])
  gaussianBlur(pixels, 3, 1, 1)
  assert.deepEqual([...pixels], [27, 27, 27, 1, 201, 201, 201, 2, 27, 27, 27, 3])
})

test('Gaussian blur radius zero is a validated identity operation', () => {
  const pixels = new Uint8ClampedArray([0, 20, 255, 7, 200, 100, 1, 199])
  const original = new Uint8ClampedArray(pixels)
  gaussianBlur(pixels, 2, 1, 0)
  assert.deepEqual(pixels, original)
})

test('Highlights uses a smooth bright-tone mask and preserves darker pixels', () => {
  const raised = new Uint8ClampedArray([
    127, 127, 127, 1,
    191, 191, 191, 2,
    255, 255, 255, 3,
  ])
  adjustHighlights(raised, 100)
  assert.deepEqual([...raised], [127, 127, 127, 1, 241, 241, 241, 2, 255, 255, 255, 3])

  const lowered = new Uint8ClampedArray([
    127, 127, 127, 1,
    191, 191, 191, 2,
    255, 255, 255, 3,
  ])
  adjustHighlights(lowered, -100)
  assert.deepEqual([...lowered], [127, 127, 127, 1, 141, 141, 141, 2, 155, 155, 155, 3])
})

test('Texture boosts or suppresses fine detail without changing alpha', () => {
  const source = new Uint8ClampedArray([0, 0, 0, 1, 128, 128, 128, 2, 0, 0, 0, 3])
  const softened = new Uint8ClampedArray(source)
  const boosted = new Uint8ClampedArray(source)

  adjustTexture(softened, 3, 1, -100)
  adjustTexture(boosted, 3, 1, 100)

  assert.deepEqual([...softened], [32, 32, 32, 1, 64, 64, 64, 2, 32, 32, 32, 3])
  assert.deepEqual([...boosted], [0, 0, 0, 1, 192, 192, 192, 2, 0, 0, 0, 3])
})

test('Clarity applies broader midtone-weighted local contrast', () => {
  const source = new Uint8ClampedArray(9 * 4)
  for (let index = 0; index < 9; index += 1) {
    source[index * 4] = 64
    source[index * 4 + 1] = 64
    source[index * 4 + 2] = 64
    source[index * 4 + 3] = index + 1
  }
  source[16] = 128
  source[17] = 128
  source[18] = 128

  const softened = new Uint8ClampedArray(source)
  const boosted = new Uint8ClampedArray(source)
  adjustClarity(softened, 9, 1, -100)
  adjustClarity(boosted, 9, 1, 100)

  assert.deepEqual([...softened.slice(16, 20)], [71, 71, 71, 5])
  assert.deepEqual([...boosted.slice(16, 20)], [185, 185, 185, 5])
  for (let index = 3; index < source.length; index += 4) {
    assert.equal(softened[index], source[index])
    assert.equal(boosted[index], source[index])
  }
})

test('Local adjustments validate first and treat zero and one-pixel inputs predictably', () => {
  const source = new Uint8ClampedArray([20, 80, 140, 91])
  for (const operation of [adjustTexture, adjustClarity]) {
    for (const amount of [-100, 0, 100]) {
      const pixels = new Uint8ClampedArray(source)
      operation(pixels, 1, 1, amount)
      assert.deepEqual(pixels, source)
    }

    const malformed = new Uint8ClampedArray(source)
    assert.throws(() => operation(malformed, 2, 1, 100), /Expected 8 RGBA bytes/)
    assert.deepEqual(malformed, source)
    for (const amount of [Number.NaN, Number.NEGATIVE_INFINITY, -101, 101]) {
      const invalidAmount = new Uint8ClampedArray(source)
      assert.throws(() => operation(invalidAmount, 1, 1, amount), /finite number/)
      assert.deepEqual(invalidAmount, source)
    }
  }

  const malformedPointBuffer = new Uint8ClampedArray([20, 80, 140])
  assert.throws(() => adjustHighlights(malformedPointBuffer, 20), /multiple of 4/)
  assert.deepEqual([...malformedPointBuffer], [20, 80, 140])
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -101, 101]) {
    const invalidAmount = new Uint8ClampedArray(source)
    assert.throws(() => adjustHighlights(invalidAmount, amount), /finite number/)
    assert.deepEqual(invalidAmount, source)
  }
})

test('Sobel documents the expected f32 threshold-boundary divergence', () => {
  // At the center pixel, both engines calculate a magnitude extremely close to
  // 39. Rust's f32 path lands on the emitting side of the hard threshold while
  // JavaScript's Number path lands just below it. This is why benchmark output
  // agreement distinguishes rounding tolerance from threshold branch changes.
  const source = new Uint8ClampedArray([
    123, 124, 114, 255, 110, 127, 109, 255, 101, 119, 116, 255,
    123, 125, 113, 255, 110, 108, 131, 255, 101, 128, 125, 255,
    123, 126, 115, 255, 110, 121, 109, 255, 101, 105, 107, 255,
  ])
  const javascriptOutput = new Uint8ClampedArray(source)
  const wasmOutput = new Uint8ClampedArray(source)

  sobelEdges(javascriptOutput, 3, 3, 39)
  sobel_edges(new Uint8Array(wasmOutput.buffer), 3, 3, 39)

  const centerRedIndex = (1 * 3 + 1) * 4
  assert.deepEqual([...javascriptOutput.slice(centerRedIndex, centerRedIndex + 3)], [0, 0, 0])
  assert.deepEqual([...wasmOutput.slice(centerRedIndex, centerRedIndex + 3)], [39, 39, 39])
  assert.deepEqual(comparePixelBuffers(javascriptOutput, wasmOutput, 1), {
    exact: false,
    withinTolerance: false,
    differingChannels: 3,
    channelsOutsideTolerance: 3,
    differingPixels: 1,
    pixelsOutsideTolerance: 1,
    maxChannelDelta: 39,
  })
  for (let index = 3; index < source.length; index += 4) {
    assert.equal(javascriptOutput[index], source[index])
    assert.equal(wasmOutput[index], source[index])
  }
})

test('benchmark protocol alternates both starting engines and resets pristine working buffers', async (context) => {
  const starts = ['javascript', 'wasm'] as const

  for (const startWith of starts) {
    await context.test(`starts with ${startWith}`, () => {
      withDeterministicClock((advance) => {
        const source = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80])
        const original = [...source]
        const calls: Array<(typeof starts)[number]> = []
        const buffers = new Map<(typeof starts)[number], Uint8ClampedArray>()

        const operation = (engine: (typeof starts)[number], durationMs: number, delta: number) =>
          (pixels: Uint8ClampedArray) => {
            assert.deepEqual([...pixels], original, `${engine} did not receive pristine pixels`)
            const priorBuffer = buffers.get(engine)
            if (priorBuffer) {
              assert.equal(pixels, priorBuffer, `${engine} did not reuse its working buffer`)
            } else {
              buffers.set(engine, pixels)
            }
            calls.push(engine)
            pixels[0] += delta
            advance(durationMs)
          }

        const result = benchmarkComparison(
          source,
          2,
          1,
          operation('javascript', 4, 1),
          operation('wasm', 2, 2),
          { warmupIterations: 2, measuredIterations: 3, startWith },
        )

        const expectedCalls =
          startWith === 'javascript'
            ? ['javascript', 'wasm', 'wasm', 'javascript', 'javascript', 'wasm', 'wasm', 'javascript', 'javascript', 'wasm']
            : ['wasm', 'javascript', 'javascript', 'wasm', 'wasm', 'javascript', 'javascript', 'wasm', 'wasm', 'javascript']
        assert.deepEqual(calls, expectedCalls)
        assert.equal(buffers.size, 2)
        assert.notEqual(buffers.get('javascript'), buffers.get('wasm'))
        assert.deepEqual([...source], original)
        assert.equal(result.warmupIterations, 2)
        assert.equal(result.measuredIterations, 3)
        assert.deepEqual(result.javascript.samplesMs, [4, 4, 4])
        assert.deepEqual(result.wasm.samplesMs, [2, 2, 2])
        assert.deepEqual([...result.javascriptOutput], [11, 20, 30, 40, 50, 60, 70, 80])
        assert.deepEqual([...result.wasmOutput], [12, 20, 30, 40, 50, 60, 70, 80])
        assert.deepEqual(result.relative, { wasmSpeedup: 2, factor: 2, winner: 'wasm' })
        assert.deepEqual(result.agreement, {
          exact: false,
          withinTolerance: true,
          differingChannels: 1,
          channelsOutsideTolerance: 0,
          differingPixels: 1,
          pixelsOutsideTolerance: 0,
          maxChannelDelta: 1,
        })
      })
    })
  }
})

test('benchmark classifies JavaScript wins, WASM wins, and configured ties', () => {
  const run = (javascriptDuration: number, wasmDuration: number, tieTolerance = 0.03) =>
    withDeterministicClock((advance) =>
      benchmarkComparison(
        new Uint8ClampedArray([10, 20, 30, 255]),
        1,
        1,
        () => advance(javascriptDuration),
        () => advance(wasmDuration),
        { warmupIterations: 0, measuredIterations: 3, tieTolerance },
      ),
    )

  assert.deepEqual(run(1, 4).relative, { wasmSpeedup: 0.25, factor: 4, winner: 'javascript' })
  assert.deepEqual(run(4, 1).relative, { wasmSpeedup: 4, factor: 4, winner: 'wasm' })
  assert.deepEqual(run(100, 98).relative, {
    wasmSpeedup: 100 / 98,
    factor: 100 / 98,
    winner: 'tie',
  })
  assert.deepEqual(run(0, 0).relative, { wasmSpeedup: 1, factor: 1, winner: 'tie' })
})

test('benchmark rejects malformed inputs and invalid protocol options before running an engine', () => {
  const source = new Uint8ClampedArray([10, 20, 30, 255])
  let operationCalls = 0
  const operation = () => {
    operationCalls += 1
  }
  const run = (options: Parameters<typeof benchmarkComparison>[5]) =>
    benchmarkComparison(source, 1, 1, operation, operation, options)

  assert.throws(() => run({ warmupIterations: -1 }), /non-negative integer/)
  assert.throws(() => run({ warmupIterations: 1.5 }), /non-negative integer/)
  assert.throws(() => run({ measuredIterations: 0 }), /positive integer/)
  assert.throws(() => run({ tieTolerance: -0.01 }), /from 0 \(inclusive\) to 1 \(exclusive\)/)
  assert.throws(() => run({ tieTolerance: 1 }), /from 0 \(inclusive\) to 1 \(exclusive\)/)
  assert.throws(() => run({ tieTolerance: Number.NaN }), /from 0 \(inclusive\) to 1 \(exclusive\)/)
  assert.throws(() => run({ startWith: 'native' as never }), /Starting engine/)
  assert.throws(() => benchmarkComparison(source, 0, 1, operation, operation), /positive integers/)
  assert.throws(
    () => benchmarkComparison(source, 2, 1, operation, operation),
    /Expected 8 RGBA bytes/,
  )
  assert.equal(operationCalls, 0)
})

test('median is stable for odd and even sample counts', () => {
  assert.equal(median([7, 1, 3]), 3)
  assert.equal(median([9, 1, 7, 3]), 5)
})
