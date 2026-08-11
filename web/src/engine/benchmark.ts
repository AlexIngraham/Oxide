export type BenchmarkPixelBuffer = Uint8ClampedArray

/** Each working-buffer reset from the source occurs before the timer starts. */
export type ProcessingOperation = (pixels: BenchmarkPixelBuffer) => void

export interface BenchmarkOptions {
  /** Untimed calls that allow both the JavaScript JIT and WASM path to settle. */
  warmupIterations?: number
  /** Timed samples; the median is the headline result. */
  measuredIterations?: number
  /** Results inside this fractional difference are labelled a tie. Defaults to 3%. */
  tieTolerance?: number
  /** Which engine runs first; callers can rotate this between comparisons. */
  startWith?: BenchmarkEngine
}

export interface BenchmarkStats {
  samplesMs: readonly number[]
  medianMs: number
  minMs: number
  maxMs: number
  megapixelsPerSecond: number | null
}

export type BenchmarkWinner = 'javascript' | 'wasm' | 'tie'
export type BenchmarkEngine = Exclude<BenchmarkWinner, 'tie'>

export interface RelativePerformance {
  /** JavaScript median / WASM median. Values above 1 mean WASM was faster. */
  wasmSpeedup: number
  /** Slower median / faster median expressed as a factor >= 1. */
  factor: number
  winner: BenchmarkWinner
}

export interface PixelAgreement {
  exact: boolean
  withinTolerance: boolean
  differingChannels: number
  channelsOutsideTolerance: number
  differingPixels: number
  pixelsOutsideTolerance: number
  maxChannelDelta: number
}

export interface BenchmarkComparisonResult {
  width: number
  height: number
  megapixels: number
  warmupIterations: number
  measuredIterations: number
  javascript: BenchmarkStats
  wasm: BenchmarkStats
  relative: RelativePerformance
  agreement: PixelAgreement
  javascriptOutput: BenchmarkPixelBuffer
  wasmOutput: BenchmarkPixelBuffer
}

export const DEFAULT_BENCHMARK_OPTIONS = Object.freeze({
  warmupIterations: 2,
  measuredIterations: 7,
  tieTolerance: 0.03,
})

/**
 * Benchmarks equivalent in-place JavaScript and WASM operations against pristine copies of one image.
 * The function is synchronous because both processing engines are synchronous; callers should avoid
 * starting it for every slider input event and may choose fewer samples for exceptionally large images.
 */
export function benchmarkComparison(
  source: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  javascriptOperation: ProcessingOperation,
  wasmOperation: ProcessingOperation,
  options: Readonly<BenchmarkOptions> = {},
): BenchmarkComparisonResult {
  assertBenchmarkInput(source, width, height)
  const warmupIterations = options.warmupIterations ?? DEFAULT_BENCHMARK_OPTIONS.warmupIterations
  const measuredIterations = options.measuredIterations ?? DEFAULT_BENCHMARK_OPTIONS.measuredIterations
  const tieTolerance = options.tieTolerance ?? DEFAULT_BENCHMARK_OPTIONS.tieTolerance
  const startWith = options.startWith ?? 'javascript'
  assertNonNegativeInteger(warmupIterations, 'Warm-up iterations')
  assertPositiveInteger(measuredIterations, 'Measured iterations')
  if (!Number.isFinite(tieTolerance) || tieTolerance < 0 || tieTolerance >= 1) {
    throw new RangeError(`Tie tolerance must be from 0 (inclusive) to 1 (exclusive); received ${tieTolerance}.`)
  }
  if (startWith !== 'javascript' && startWith !== 'wasm') {
    throw new RangeError(`Starting engine must be "javascript" or "wasm"; received ${String(startWith)}.`)
  }

  // Reuse one working buffer per engine. Resetting it from the immutable source
  // stays outside the timer, while avoiding allocation and GC noise on every run.
  const javascriptOutput = clonePixels(source)
  const wasmOutput = clonePixels(source)

  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    if (shouldRunJavaScriptFirst(iteration, startWith)) {
      runUntimed(javascriptOperation, source, javascriptOutput)
      runUntimed(wasmOperation, source, wasmOutput)
    } else {
      runUntimed(wasmOperation, source, wasmOutput)
      runUntimed(javascriptOperation, source, javascriptOutput)
    }
  }

  const javascriptSamples: number[] = []
  const wasmSamples: number[] = []

  for (let iteration = 0; iteration < measuredIterations; iteration += 1) {
    if (shouldRunJavaScriptFirst(iteration, startWith)) {
      javascriptSamples[iteration] = runTimed(
        javascriptOperation,
        source,
        javascriptOutput,
      )
      wasmSamples[iteration] = runTimed(wasmOperation, source, wasmOutput)
    } else {
      wasmSamples[iteration] = runTimed(wasmOperation, source, wasmOutput)
      javascriptSamples[iteration] = runTimed(
        javascriptOperation,
        source,
        javascriptOutput,
      )
    }
  }

  const megapixels = (width * height) / 1_000_000
  const javascript = summarizeSamples(javascriptSamples, megapixels)
  const wasm = summarizeSamples(wasmSamples, megapixels)

  return {
    width,
    height,
    megapixels,
    warmupIterations,
    measuredIterations,
    javascript,
    wasm,
    relative: comparePerformance(javascript.medianMs, wasm.medianMs, tieTolerance),
    // A tolerance of one channel value accounts for native f32 Rust versus Number-based JS rounding.
    agreement: comparePixelBuffers(javascriptOutput, wasmOutput, 1),
    javascriptOutput,
    wasmOutput,
  }
}

function shouldRunJavaScriptFirst(iteration: number, startWith: BenchmarkEngine): boolean {
  return iteration % 2 === 0 ? startWith === 'javascript' : startWith === 'wasm'
}

export function comparePixelBuffers(
  first: Uint8Array | Uint8ClampedArray,
  second: Uint8Array | Uint8ClampedArray,
  tolerance = 0,
): PixelAgreement {
  if (first.length !== second.length) {
    throw new RangeError(`Pixel buffers must have the same length; received ${first.length} and ${second.length}.`)
  }
  assertNonNegativeInteger(tolerance, 'Pixel comparison tolerance')

  let differingChannels = 0
  let channelsOutsideTolerance = 0
  let differingPixels = 0
  let pixelsOutsideTolerance = 0
  let maxChannelDelta = 0
  let currentPixelDiffers = false
  let currentPixelOutsideTolerance = false
  for (let index = 0; index < first.length; index += 1) {
    const delta = Math.abs(first[index] - second[index])
    if (delta !== 0) {
      differingChannels += 1
      currentPixelDiffers = true
    }
    if (delta > tolerance) {
      channelsOutsideTolerance += 1
      currentPixelOutsideTolerance = true
    }
    maxChannelDelta = Math.max(maxChannelDelta, delta)

    if (index % 4 === 3 || index === first.length - 1) {
      if (currentPixelDiffers) differingPixels += 1
      if (currentPixelOutsideTolerance) pixelsOutsideTolerance += 1
      currentPixelDiffers = false
      currentPixelOutsideTolerance = false
    }
  }

  return {
    exact: differingChannels === 0,
    withinTolerance: channelsOutsideTolerance === 0,
    differingChannels,
    channelsOutsideTolerance,
    differingPixels,
    pixelsOutsideTolerance,
    maxChannelDelta,
  }
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError('Cannot calculate the median of an empty sample set.')
  }
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint]
}

function runUntimed(
  operation: ProcessingOperation,
  source: Uint8Array | Uint8ClampedArray,
  output: BenchmarkPixelBuffer,
): void {
  output.set(source)
  operation(output)
}

function runTimed(
  operation: ProcessingOperation,
  source: Uint8Array | Uint8ClampedArray,
  output: BenchmarkPixelBuffer,
): number {
  output.set(source)
  const start = performance.now()
  operation(output)
  return performance.now() - start
}

function clonePixels(source: Uint8Array | Uint8ClampedArray): BenchmarkPixelBuffer {
  return new Uint8ClampedArray(source)
}

function summarizeSamples(samples: readonly number[], megapixels: number): BenchmarkStats {
  const medianMs = median(samples)
  return {
    samplesMs: Object.freeze([...samples]),
    medianMs,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    megapixelsPerSecond: medianMs > 0 ? megapixels / (medianMs / 1_000) : null,
  }
}

function comparePerformance(
  javascriptMedianMs: number,
  wasmMedianMs: number,
  tieTolerance: number,
): RelativePerformance {
  if (javascriptMedianMs === 0 && wasmMedianMs === 0) {
    return { wasmSpeedup: 1, factor: 1, winner: 'tie' }
  }

  const wasmSpeedup = wasmMedianMs === 0 ? Number.POSITIVE_INFINITY : javascriptMedianMs / wasmMedianMs
  const slower = Math.max(javascriptMedianMs, wasmMedianMs)
  const faster = Math.min(javascriptMedianMs, wasmMedianMs)
  const factor = faster === 0 ? Number.POSITIVE_INFINITY : slower / faster
  const relativeDifference = slower === 0 ? 0 : (slower - faster) / slower

  return {
    wasmSpeedup,
    factor,
    winner:
      relativeDifference <= tieTolerance
        ? 'tie'
        : wasmMedianMs < javascriptMedianMs
          ? 'wasm'
          : 'javascript',
  }
}

function assertBenchmarkInput(source: Uint8Array | Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Benchmark dimensions must be positive integers; received ${width} x ${height}.`)
  }
  const expectedLength = width * height * 4
  if (!Number.isSafeInteger(expectedLength) || source.length !== expectedLength) {
    throw new RangeError(`Expected ${expectedLength} RGBA bytes for ${width} x ${height}; received ${source.length}.`)
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer; received ${value}.`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer; received ${value}.`)
  }
}
