import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from 'react'
import {
  DEFAULT_FILTER_PARAMETERS,
  FILTER_DEFINITIONS,
  FILTER_DEFINITIONS_BY_ID,
  initializeWasm,
  type BenchmarkComparisonResult,
  type FilterId,
  type FilterParameters,
} from './engine'
import type {
  BenchmarkWorkerRequest,
  PreviewWorkerRequest,
  ProcessingWorkerRequest,
  ProcessingWorkerResponse,
} from './processingProtocol'
import { ParameterControl } from './ParameterControl'
import './App.css'

type WasmStatus = 'loading' | 'ready' | 'error'
type PreviewEngine = 'wasm' | 'javascript'

interface ImageMetadata {
  name: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  wasResized: boolean
}

const SAMPLE_IMAGE_URL = `${import.meta.env.BASE_URL}sample-studio.webp`
const MAX_FILE_BYTES = 30 * 1024 * 1024
// Local-detail filters need an RGB float scratch buffer in addition to source,
// result, Canvas, and WASM memory. Six megapixels keeps that worst case bounded
// while retaining enough resolution for meaningful inspection and export.
const MAX_IMAGE_PIXELS = 6_000_000
const MAX_IMAGE_DIMENSION = 4096
const TIMER_PRECISION_FLOOR_MS = 0.005
const PREVIEW_DEBOUNCE_MS = 90
const BENCHMARK_DEBOUNCE_MS = 450
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
])
const SUPPORTED_IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i

function getBenchmarkOptions(filter: FilterId, megapixels: number) {
  const isSpatialFilter =
    filter === 'texture' ||
    filter === 'clarity' ||
    filter === 'gaussian-blur' ||
    filter === 'sobel-edges'
  if (isSpatialFilter || megapixels > 4) {
    return { warmupIterations: 1, measuredIterations: 3 }
  }
  return { warmupIterations: 2, measuredIterations: 7 }
}

function getWorkerJobKey(type: ProcessingWorkerRequest['type'], requestId: number): string {
  return `${type}:${requestId}`
}

function getPreviewAspectRatio(width: number, height: number): number {
  // Preserve ordinary image proportions, but letterbox pathological panoramas
  // and strips so the comparison surface remains usable.
  return Math.min(2, Math.max(0.5, width / height))
}

function drawPixelBuffer(
  canvas: HTMLCanvasElement,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D rendering is unavailable in this browser.')
  }
  // Every app-owned buffer uses ArrayBuffer. Keep the defensive fallback for
  // external SharedArrayBuffer callers without copying the normal render path.
  const canvasPixels =
    pixels.buffer instanceof ArrayBuffer
      ? new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength)
      : new Uint8ClampedArray(pixels)
  context.putImageData(new ImageData(canvasPixels, width, height), 0, 0)
}

function formatMilliseconds(value: number): string {
  if (value < TIMER_PRECISION_FLOOR_MS) return '<0.005 ms'
  if (value < 1) return `${value.toFixed(3)} ms`
  if (value < 100) return `${value.toFixed(2)} ms`
  return `${value.toFixed(1)} ms`
}

function formatThroughput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} MP/s`
}

function getRelativeLabel(result: BenchmarkComparisonResult): string {
  if (isBelowTimerPrecision(result) || !Number.isFinite(result.relative.factor)) {
    return 'Below timer precision'
  }
  if (result.relative.winner === 'tie') return 'Within 3% tie threshold'
  const engine = result.relative.winner === 'wasm' ? 'WASM' : 'JavaScript'
  return `${result.relative.factor.toFixed(2)}× faster in ${engine}`
}

function isBelowTimerPrecision(result: BenchmarkComparisonResult): boolean {
  return (
    result.javascript.medianMs < TIMER_PRECISION_FLOOR_MS ||
    result.wasm.medianMs < TIMER_PRECISION_FLOOR_MS
  )
}

function getAgreementLabel(result: BenchmarkComparisonResult): string {
  if (result.agreement.exact) return 'Exact pixel match'
  if (result.agreement.withinTolerance) {
    return `Equivalent within ±${result.agreement.maxChannelDelta} channel level`
  }
  return `${result.agreement.pixelsOutsideTolerance.toLocaleString()} of ${(result.width * result.height).toLocaleString()} pixels exceed ±1`
}

function App() {
  const originalCanvasRef = useRef<HTMLCanvasElement>(null)
  const processedCanvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sourcePixelsRef = useRef<Uint8ClampedArray | null>(null)
  const loadRequestRef = useRef(0)
  const processRequestRef = useRef(0)
  const benchmarkRequestRef = useRef(0)
  const loadingImageRef = useRef(false)
  const previewTimeoutRef = useRef<number | null>(null)
  const benchmarkTimeoutRef = useRef<number | null>(null)
  const processingWorkerRef = useRef<Worker | null>(null)
  const pendingWorkerJobsRef = useRef(new Set<string>())
  const nextBenchmarkStarterRef = useRef<PreviewEngine>('javascript')

  const [wasmStatus, setWasmStatus] = useState<WasmStatus>('loading')
  const [imageMetadata, setImageMetadata] = useState<ImageMetadata | null>(null)
  const [imageRevision, setImageRevision] = useState(0)
  const [selectedFilter, setSelectedFilter] = useState<FilterId>('grayscale')
  const [parameters, setParameters] = useState<FilterParameters>({ ...DEFAULT_FILTER_PARAMETERS })
  const [benchmark, setBenchmark] = useState<BenchmarkComparisonResult | null>(null)
  const [previewEngine, setPreviewEngine] = useState<PreviewEngine>('wasm')
  const [reveal, setReveal] = useState(50)
  const [isLoadingImage, setIsLoadingImage] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isBenchmarking, setIsBenchmarking] = useState(false)
  const [hasCurrentOutput, setHasCurrentOutput] = useState(false)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeFilter = FILTER_DEFINITIONS_BY_ID[selectedFilter]

  const clearScheduledProcessing = useCallback(() => {
    if (previewTimeoutRef.current !== null) {
      window.clearTimeout(previewTimeoutRef.current)
      previewTimeoutRef.current = null
    }
    if (benchmarkTimeoutRef.current !== null) {
      window.clearTimeout(benchmarkTimeoutRef.current)
      benchmarkTimeoutRef.current = null
    }
  }, [])

  const stopProcessingWorker = useCallback(() => {
    processingWorkerRef.current?.terminate()
    processingWorkerRef.current = null
    pendingWorkerJobsRef.current.clear()
  }, [])

  const failProcessingWorker = useCallback(
    (worker: Worker | null, message: string) => {
      if (worker && processingWorkerRef.current !== worker) return
      processRequestRef.current += 1
      benchmarkRequestRef.current += 1
      clearScheduledProcessing()
      stopProcessingWorker()
      setIsPreviewing(false)
      setIsBenchmarking(false)
      console.error('Image processing worker failed:', message)
      setError(message)
    },
    [clearScheduledProcessing, stopProcessingWorker],
  )

  const getProcessingWorker = useCallback((): Worker => {
    const existingWorker = processingWorkerRef.current
    if (existingWorker) return existingWorker

    const worker = new Worker(new URL('./processing.worker.ts', import.meta.url), { type: 'module' })
    processingWorkerRef.current = worker

    worker.onmessage = (event: MessageEvent<ProcessingWorkerResponse>) => {
      if (processingWorkerRef.current !== worker) return
      const response = event.data

      if (response.type === 'error') {
        const requestIsCurrent =
          response.jobType === 'preview'
            ? response.requestId === processRequestRef.current
            : response.requestId === benchmarkRequestRef.current
        pendingWorkerJobsRef.current.delete(getWorkerJobKey(response.jobType, response.requestId))
        if (requestIsCurrent) failProcessingWorker(worker, response.message)
        return
      }

      const jobType = response.type === 'preview-result' ? 'preview' : 'benchmark'
      pendingWorkerJobsRef.current.delete(getWorkerJobKey(jobType, response.requestId))

      if (response.type === 'preview-result') {
        if (response.requestId !== processRequestRef.current) return
        setIsPreviewing(false)
        const processedCanvas = processedCanvasRef.current
        if (!processedCanvas) return
        try {
          drawPixelBuffer(processedCanvas, response.output, response.width, response.height)
          setHasCurrentOutput(true)
        } catch (reason) {
          console.error('Failed to render the processed image:', reason)
          setHasCurrentOutput(false)
          setError(reason instanceof Error ? reason.message : 'The processed image could not be rendered.')
        }
        return
      }

      if (response.requestId !== benchmarkRequestRef.current) return
      setIsBenchmarking(false)
      setBenchmark(response.result)
    }

    worker.onerror = (event) => {
      event.preventDefault()
      if (processingWorkerRef.current !== worker) return
      failProcessingWorker(worker, event.message || 'The image processing worker failed unexpectedly.')
    }

    worker.onmessageerror = () => {
      if (processingWorkerRef.current !== worker) return
      failProcessingWorker(worker, 'The browser could not read the image processing worker result.')
    }

    return worker
  }, [failProcessingWorker])

  const cancelProcessing = useCallback(
    (clearResults: boolean) => {
      processRequestRef.current += 1
      benchmarkRequestRef.current += 1
      clearScheduledProcessing()
      if (pendingWorkerJobsRef.current.size > 0) stopProcessingWorker()
      setIsPreviewing(false)
      setIsBenchmarking(false)
      if (clearResults) {
        setBenchmark(null)
        setPreviewEngine('wasm')
        setHasCurrentOutput(false)
      }
    },
    [clearScheduledProcessing, stopProcessingWorker],
  )

  useEffect(() => {
    let active = true
    initializeWasm()
      .then(() => {
        if (active) setWasmStatus('ready')
      })
      .catch((reason: unknown) => {
        console.error('Failed to initialize the WebAssembly module:', reason)
        if (active) {
          setWasmStatus('error')
          setError('The Rust/WebAssembly engine could not be initialized in this browser.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  const loadImage = useCallback(async (sourceUrl: string, name: string) => {
    const requestId = ++loadRequestRef.current
    cancelProcessing(false)
    loadingImageRef.current = true
    setIsLoadingImage(true)
    setError(null)

    try {
      const image = new Image()
      image.decoding = 'async'
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('The selected file could not be decoded as an image.'))
        // Attach handlers before assigning src so a cached sample cannot win
        // the race and fire its load event first.
        image.src = sourceUrl
      })

      if (requestId !== loadRequestRef.current) return

      const originalWidth = image.naturalWidth
      const originalHeight = image.naturalHeight
      if (originalWidth === 0 || originalHeight === 0) {
        throw new Error('The selected image has invalid dimensions.')
      }
      const originalPixelCount = originalWidth * originalHeight
      if (!Number.isSafeInteger(originalPixelCount)) {
        throw new Error('The selected image dimensions are too large to process safely.')
      }

      const dimensionScale = Math.min(
        1,
        MAX_IMAGE_DIMENSION / originalWidth,
        MAX_IMAGE_DIMENSION / originalHeight,
      )
      const pixelScale = Math.min(1, Math.sqrt(MAX_IMAGE_PIXELS / originalPixelCount))
      const scale = Math.min(dimensionScale, pixelScale)
      // Floor both dimensions so rounding can never push the working canvas
      // above the advertised pixel cap.
      const width = Math.max(1, Math.floor(originalWidth * scale))
      const height = Math.max(1, Math.floor(originalHeight * scale))
      const scratchCanvas = document.createElement('canvas')
      scratchCanvas.width = width
      scratchCanvas.height = height
      const scratchContext = scratchCanvas.getContext('2d', { willReadFrequently: true })
      if (!scratchContext) throw new Error('Canvas 2D rendering is unavailable in this browser.')
      scratchContext.drawImage(image, 0, 0, width, height)
      const imageData = scratchContext.getImageData(0, 0, width, height)
      const sourcePixels = imageData.data

      if (requestId !== loadRequestRef.current) return
      // Reuse the warmed worker throughout edits to one image, but release its
      // WASM linear-memory high-water mark when a replacement image succeeds.
      stopProcessingWorker()
      const originalCanvas = originalCanvasRef.current
      const processedCanvas = processedCanvasRef.current
      if (!originalCanvas || !processedCanvas) {
        throw new Error('The image preview is not available.')
      }

      originalCanvas.width = width
      originalCanvas.height = height
      processedCanvas.width = width
      processedCanvas.height = height
      drawPixelBuffer(originalCanvas, sourcePixels, width, height)
      drawPixelBuffer(processedCanvas, sourcePixels, width, height)
      sourcePixelsRef.current = sourcePixels

      setBenchmark(null)
      setImageMetadata({
        name,
        width,
        height,
        originalWidth,
        originalHeight,
        wasResized: width !== originalWidth || height !== originalHeight,
      })
      setPreviewEngine('wasm')
      setHasCurrentOutput(false)
      setReveal(50)
      setImageRevision((revision) => revision + 1)
    } catch (reason) {
      if (requestId === loadRequestRef.current) {
        console.error('Failed to load image:', reason)
        setError(reason instanceof Error ? reason.message : 'The image could not be loaded.')
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        loadingImageRef.current = false
        setIsLoadingImage(false)
      }
    }
  }, [cancelProcessing, stopProcessingWorker])

  const loadSampleImage = useCallback(() => {
    void loadImage(SAMPLE_IMAGE_URL, 'Studio sample')
  }, [loadImage])

  useEffect(() => {
    loadSampleImage()
  }, [loadSampleImage])

  useEffect(
    () => () => {
      loadRequestRef.current += 1
      processRequestRef.current += 1
      benchmarkRequestRef.current += 1
      loadingImageRef.current = false
      clearScheduledProcessing()
      stopProcessingWorker()
    },
    [clearScheduledProcessing, stopProcessingWorker],
  )

  const runBenchmark = useCallback(() => {
    const source = sourcePixelsRef.current
    if (!source || !imageMetadata || wasmStatus !== 'ready' || loadingImageRef.current) {
      return
    }

    const requestId = ++benchmarkRequestRef.current
    setIsBenchmarking(true)

    let worker: Worker | null = null
    try {
      const options = getBenchmarkOptions(selectedFilter, (imageMetadata.width * imageMetadata.height) / 1_000_000)
      const startingEngine = nextBenchmarkStarterRef.current
      nextBenchmarkStarterRef.current = startingEngine === 'javascript' ? 'wasm' : 'javascript'
      worker = getProcessingWorker()
      const sourceCopy = new Uint8ClampedArray(source)
      const request: BenchmarkWorkerRequest = {
        type: 'benchmark',
        requestId,
        sourceBuffer: sourceCopy.buffer,
        width: imageMetadata.width,
        height: imageMetadata.height,
        filter: selectedFilter,
        parameters: { ...parameters },
        options: { ...options, startWith: startingEngine },
      }
      pendingWorkerJobsRef.current.add(getWorkerJobKey(request.type, requestId))
      worker.postMessage(request, [sourceCopy.buffer])
    } catch (reason) {
      if (requestId === benchmarkRequestRef.current) {
        failProcessingWorker(
          worker,
          reason instanceof Error ? reason.message : 'The benchmark could not be started.',
        )
      }
    }
  }, [failProcessingWorker, getProcessingWorker, imageMetadata, parameters, selectedFilter, wasmStatus])

  const runPreview = useCallback(() => {
    const source = sourcePixelsRef.current
    if (!source || !imageMetadata || wasmStatus !== 'ready' || loadingImageRef.current) {
      return
    }

    const requestId = ++processRequestRef.current
    setIsPreviewing(true)

    let worker: Worker | null = null
    try {
      worker = getProcessingWorker()
      const sourceCopy = new Uint8ClampedArray(source)
      const request: PreviewWorkerRequest = {
        type: 'preview',
        requestId,
        sourceBuffer: sourceCopy.buffer,
        width: imageMetadata.width,
        height: imageMetadata.height,
        filter: selectedFilter,
        parameters: { ...parameters },
      }
      pendingWorkerJobsRef.current.add(getWorkerJobKey(request.type, requestId))
      worker.postMessage(request, [sourceCopy.buffer])
    } catch (reason) {
      if (requestId === processRequestRef.current) {
        failProcessingWorker(
          worker,
          reason instanceof Error ? reason.message : 'The image preview could not be started.',
        )
      }
    }
  }, [failProcessingWorker, getProcessingWorker, imageMetadata, parameters, selectedFilter, wasmStatus])

  useEffect(() => {
    if (wasmStatus !== 'ready' || !imageMetadata || imageRevision === 0 || loadingImageRef.current) return
    setIsBenchmarking(true)
    previewTimeoutRef.current = window.setTimeout(() => {
      previewTimeoutRef.current = null
      runPreview()
    }, PREVIEW_DEBOUNCE_MS)
    benchmarkTimeoutRef.current = window.setTimeout(() => {
      benchmarkTimeoutRef.current = null
      runBenchmark()
    }, BENCHMARK_DEBOUNCE_MS)

    return () => {
      clearScheduledProcessing()
    }
  }, [clearScheduledProcessing, imageMetadata, imageRevision, parameters, runBenchmark, runPreview, selectedFilter, wasmStatus])

  const handleFiles = useCallback(
    (files: FileList | readonly File[]) => {
      const file = files[0]
      if (!file) return
      const hasSupportedType =
        SUPPORTED_IMAGE_TYPES.has(file.type) || SUPPORTED_IMAGE_EXTENSION.test(file.name)
      if (!hasSupportedType) {
        setError('Choose a PNG, JPEG, WebP, GIF, AVIF, or another browser-supported image.')
        return
      }
      if (file.size === 0) {
        setError('That file is empty. Choose an image that contains decodable pixel data.')
        return
      }
      if (file.size > MAX_FILE_BYTES) {
        setError('That file is larger than 30 MB. Choose a smaller image for this in-browser demo.')
        return
      }

      const objectUrl = URL.createObjectURL(file)
      void loadImage(objectUrl, file.name).finally(() => URL.revokeObjectURL(objectUrl))
    },
    [loadImage],
  )

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) handleFiles(event.target.files)
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingFile(false)
    handleFiles(event.dataTransfer.files)
  }

  const updateReveal = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width <= 0) return
    const nextReveal = ((event.clientX - bounds.left) / bounds.width) * 100
    const clamped = Math.min(100, Math.max(0, nextReveal))
    setReveal(Math.round(clamped * 10) / 10)
  }

  const handleComparisonPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    updateReveal(event)
  }

  const handleComparisonPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateReveal(event)
  }

  const handleParameterChange = (value: number) => {
    const control = activeFilter.control
    if (!control || !Number.isFinite(value) || parameters[control.key] === value) return
    setError(null)
    cancelProcessing(true)
    setParameters((current) => ({ ...current, [control.key]: value }))
  }

  const handleSelectFilter = (filter: FilterId) => {
    if (filter === selectedFilter) return
    setError(null)
    cancelProcessing(true)
    setSelectedFilter(filter)
  }

  const handleReset = () => {
    setError(null)
    cancelProcessing(true)
    setParameters({ ...DEFAULT_FILTER_PARAMETERS })
    setSelectedFilter('grayscale')
    setReveal(50)
    if (imageMetadata) setImageRevision((revision) => revision + 1)
  }

  const handlePreviewEngineChange = (engine: PreviewEngine) => {
    if (engine === previewEngine || !benchmark) return
    const canvas = processedCanvasRef.current
    if (!canvas) return

    try {
      const output = engine === 'wasm' ? benchmark.wasmOutput : benchmark.javascriptOutput
      drawPixelBuffer(canvas, output, benchmark.width, benchmark.height)
      setPreviewEngine(engine)
      setHasCurrentOutput(true)
    } catch (reason) {
      console.error('Failed to render benchmark output:', reason)
      setError(reason instanceof Error ? reason.message : 'The processed image could not be rendered.')
    }
  }

  const handleDownload = () => {
    const canvas = processedCanvasRef.current
    if (!canvas || !imageMetadata || !hasCurrentOutput) return

    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          setError('The processed image could not be exported by this browser.')
          return
        }
        let objectUrl: string | null = null
        try {
          objectUrl = URL.createObjectURL(blob)
          const link = document.createElement('a')
          const baseName = imageMetadata.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-') || 'image'
          link.href = objectUrl
          link.download = `${baseName}-${selectedFilter}-${previewEngine}.png`
          link.hidden = true
          document.body.append(link)
          try {
            link.click()
          } finally {
            link.remove()
          }
        } catch (reason) {
          console.error('Failed to export processed image:', reason)
          setError(reason instanceof Error ? reason.message : 'The processed image could not be exported.')
        } finally {
          if (objectUrl) {
            const urlToRevoke = objectUrl
            window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1_000)
          }
        }
      }, 'image/png')
    } catch (reason) {
      console.error('Failed to export processed image:', reason)
      setError(reason instanceof Error ? reason.message : 'The processed image could not be exported.')
    }
  }

  const maxTiming = benchmark
    ? Math.max(benchmark.javascript.medianMs, benchmark.wasm.medianMs)
    : 1
  const timingBarWidth = (value: number): string =>
    benchmark && maxTiming > 0 ? `${(value / maxTiming) * 100}%` : '0%'
  const imageMegapixels = imageMetadata
    ? (imageMetadata.width * imageMetadata.height) / 1_000_000
    : 0
  const previewAspectRatio = imageMetadata
    ? getPreviewAspectRatio(imageMetadata.width, imageMetadata.height)
    : 1.5
  const comparisonStyle = {
    '--reveal-position': `${reveal}%`,
    maxWidth: imageMetadata
      ? `min(100%, ${720 * previewAspectRatio}px)`
      : '100%',
  } as CSSProperties
  const statusKind = isLoadingImage || wasmStatus === 'loading' || isPreviewing || isBenchmarking
    ? 'busy'
    : wasmStatus === 'error'
      ? 'error'
      : benchmark
        ? 'ready'
        : 'idle'
  const statusLabel = isLoadingImage
    ? 'Decoding image'
    : wasmStatus === 'loading'
      ? 'Loading WASM engine'
      : wasmStatus === 'error'
        ? 'WASM unavailable'
        : isPreviewing
          ? 'Updating preview'
          : isBenchmarking
            ? 'Measuring both engines'
            : benchmark
              ? 'Comparison is current'
              : 'Updates automatically'
  const timingWinner =
    benchmark && !isBelowTimerPrecision(benchmark) && benchmark.relative.winner !== 'tie'
      ? benchmark.relative.winner
      : null

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Oxide Lab home">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-name">
            Oxide <span>Lab</span>
          </span>
        </a>
        <nav className="topbar-nav" aria-label="Primary navigation">
          <a href="#workbench">Workbench</a>
          <a href="#architecture">Architecture</a>
        </nav>
      </header>

      <main id="top">
        <section className="intro" aria-labelledby="hero-title">
          <div className="intro-copy">
            <p className="eyebrow">Rust / WebAssembly · TypeScript</p>
            <h1 id="hero-title">A local image lab that times both engines on the same pixels.</h1>
          </div>
          <div className="intro-aside">
            <p>
              Edit with equivalent TypeScript and Rust/WebAssembly filters. The browser compares their output and
              execution time automatically after each change.
            </p>
            <p className="privacy-note">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 10V8a5 5 0 0 1 10 0v2M5 10h14v11H5z" />
              </svg>
              <span>
                <strong>Processed in this tab.</strong> Images never leave the browser.
              </span>
            </p>
          </div>
        </section>

        <section className="workbench-section" id="workbench" aria-labelledby="workbench-title">
          <div className="workbench-intro">
            <h2 id="workbench-title">Workbench</h2>
            <p>Choose a filter and adjust its value. The preview responds first; performance results follow automatically.</p>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>!</span>
              <p>{error}</p>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}

          <div className="lab">
            <aside className="control-panel" aria-label="Image processing controls">
              <div className="control-section control-section--source">
                <div className="control-heading">
                  <h3>Source</h3>
                </div>
                <div
                  className={`drop-zone${isDraggingFile ? ' drop-zone--active' : ''}`}
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setIsDraggingFile(true)
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    const relatedTarget = event.relatedTarget
                    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
                      setIsDraggingFile(false)
                    }
                  }}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    className="visually-hidden"
                    type="file"
                    accept=".avif,.bmp,.gif,.jpeg,.jpg,.png,.webp"
                    onChange={handleFileChange}
                    aria-label="Upload an image"
                  />
                  <button type="button" className="drop-zone-button" onClick={() => fileInputRef.current?.click()}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 16V4m0 0L7 9m5-5 5 5M4 15v5h16v-5" />
                    </svg>
                    <span>{isDraggingFile ? 'Drop it here' : 'Drop image or browse'}</span>
                    <small>PNG, JPEG, WebP, AVIF · max 30 MB</small>
                  </button>
                </div>
                <button type="button" className="sample-button" onClick={loadSampleImage} disabled={isLoadingImage}>
                  <span
                    className="sample-swatch"
                    style={{ backgroundImage: `url("${SAMPLE_IMAGE_URL}")` }}
                    aria-hidden="true"
                  />
                  Use built-in studio sample
                </button>
                {imageMetadata && (
                  <div className="source-meta">
                    <span title={imageMetadata.name}>{imageMetadata.name}</span>
                    <span>
                      {imageMetadata.width} × {imageMetadata.height}
                    </span>
                  </div>
                )}
              </div>

              <div className="control-section">
                <div className="control-heading">
                  <h3>Filter</h3>
                </div>
                <fieldset className="filter-grid">
                  <legend className="visually-hidden">Image filter</legend>
                  {FILTER_DEFINITIONS.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={selectedFilter === filter.id ? 'filter-button filter-button--active' : 'filter-button'}
                      aria-pressed={selectedFilter === filter.id}
                      onClick={() => handleSelectFilter(filter.id)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </fieldset>
              </div>

              <div className="control-section control-section--parameter">
                <div className="control-heading">
                  <h3>Parameter</h3>
                </div>
                <div className="filter-summary">
                  <strong>{activeFilter.label}</strong>
                  <p>{activeFilter.description}</p>
                </div>
                {activeFilter.control ? (
                  <ParameterControl
                    key={activeFilter.control.key}
                    control={activeFilter.control}
                    value={parameters[activeFilter.control.key]}
                    onChange={handleParameterChange}
                  />
                ) : (
                  <div className="fixed-parameter">
                    <code>Y = 0.299R + 0.587G + 0.114B</code>
                  </div>
                )}
              </div>

              <div className="control-actions">
                <button type="button" className="reset-button" onClick={handleReset}>
                  Reset
                </button>
              </div>
            </aside>

            <div className="visual-workspace">
              <div className="canvas-toolbar">
                <output className={`auto-process-status auto-process-status--${statusKind}`} aria-live="polite">
                  <span aria-hidden="true" />
                  <span>{statusLabel}</span>
                </output>
                <fieldset className="engine-switch">
                  <legend className="visually-hidden">Preview output</legend>
                  <button
                    type="button"
                    aria-pressed={previewEngine === 'wasm'}
                    className={previewEngine === 'wasm' ? 'active' : ''}
                    onClick={() => handlePreviewEngineChange('wasm')}
                    disabled={!benchmark}
                  >
                    Rust / WASM
                  </button>
                  <button
                    type="button"
                    aria-pressed={previewEngine === 'javascript'}
                    className={previewEngine === 'javascript' ? 'active' : ''}
                    onClick={() => handlePreviewEngineChange('javascript')}
                    disabled={!benchmark}
                  >
                    TypeScript
                  </button>
                </fieldset>
                <button
                  type="button"
                  className="download-button"
                  onClick={handleDownload}
                  disabled={!hasCurrentOutput || isPreviewing || isLoadingImage}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3v12m0 0 5-5m-5 5-5-5M4 19h16" />
                  </svg>
                  Download PNG
                </button>
              </div>

              <div className="comparison-frame" style={comparisonStyle}>
                <figure
                  className="comparison-stage"
                  style={{ aspectRatio: previewAspectRatio }}
                  onPointerDown={handleComparisonPointerDown}
                  onPointerMove={handleComparisonPointerMove}
                >
                  <figcaption className="visually-hidden">
                    Original image on the left and processed image on the right
                  </figcaption>
                  <canvas ref={originalCanvasRef} aria-label="Original image">
                    Original image preview
                  </canvas>
                  <canvas
                    ref={processedCanvasRef}
                    className="processed-canvas"
                    aria-label={`Processed image from the ${previewEngine === 'wasm' ? 'Rust WebAssembly' : 'TypeScript'} engine`}
                  >
                    Processed image preview
                  </canvas>
                  {imageMetadata && (
                    <>
                      <div className="stage-label stage-label--original">Original</div>
                      <div className="stage-label stage-label--processed">{activeFilter.label}</div>
                      <div className="reveal-divider" aria-hidden="true">
                        <span />
                      </div>
                    </>
                  )}
                  {!imageMetadata && !isLoadingImage && (
                    <div className="stage-empty">
                      <strong>No image loaded</strong>
                      <span>Choose a local image or restore the built-in sample.</span>
                    </div>
                  )}
                  {(isLoadingImage || isPreviewing) && (
                    <output className="stage-busy" aria-live="polite">
                      <span className="busy-spinner" aria-hidden="true" />
                      {isLoadingImage ? 'Decoding pixels' : 'Rendering Rust preview'}
                    </output>
                  )}
                </figure>
                {imageMetadata && (
                  <div className="reveal-control">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={reveal}
                      onChange={(event) => setReveal(Number(event.currentTarget.value))}
                      aria-label="Comparison divider position"
                      aria-valuetext={`${reveal}% before, ${100 - reveal}% after`}
                    />
                    <div className="reveal-track" aria-hidden="true">
                      <span className="reveal-track-divider" />
                    </div>
                    <div className="reveal-labels" aria-hidden="true">
                      <span>Before</span>
                      <span>After</span>
                    </div>
                  </div>
                )}
                <div className="canvas-caption">
                  <span>Drag the divider to inspect the transformation.</span>
                  {imageMetadata?.wasResized && (
                    <span>
                      Safety resize: {imageMetadata.originalWidth} × {imageMetadata.originalHeight} →{' '}
                      {imageMetadata.width} × {imageMetadata.height}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <section className="benchmark-panel" aria-labelledby="benchmark-title">
              <div className="benchmark-heading">
                <div>
                  <p className="eyebrow">Browser benchmark</p>
                  <h3 id="benchmark-title">JavaScript and Rust/WASM performance</h3>
                </div>
                <div
                  className={`agreement-badge${
                    isBenchmarking
                      ? ' agreement-badge--running'
                      : benchmark?.agreement.withinTolerance
                      ? ' agreement-badge--valid'
                      : benchmark
                        ? ' agreement-badge--near'
                        : ''
                  }`}
                  title={
                    benchmark
                      ? `${benchmark.agreement.differingChannels.toLocaleString()} differing channels; maximum channel delta ${benchmark.agreement.maxChannelDelta}.`
                      : undefined
                  }
                  aria-live="polite"
                >
                  <span aria-hidden="true">
                    {isBenchmarking ? '↻' : benchmark?.agreement.withinTolerance ? '✓' : benchmark ? '≈' : '·'}
                  </span>
                  {isBenchmarking
                    ? 'Benchmarking latest edit'
                    : benchmark
                      ? getAgreementLabel(benchmark)
                      : imageMetadata
                        ? 'Waiting for comparison'
                        : 'Awaiting image'}
                </div>
              </div>

              <div className="benchmark-grid" aria-live="polite">
                <article className={`engine-result${timingWinner === 'wasm' ? ' engine-result--winner' : ''}`}>
                  <div className="engine-result-label">
                    <span className="engine-dot" />
                    <span>Rust / WASM</span>
                    <small>wasm-bindgen call</small>
                  </div>
                  <strong>
                    {benchmark ? formatMilliseconds(benchmark.wasm.medianMs) : '—'}
                  </strong>
                  <div className="timing-track" aria-hidden="true">
                    <span
                      style={{ width: benchmark ? timingBarWidth(benchmark.wasm.medianMs) : '0%' }}
                    />
                  </div>
                  <div className="engine-details">
                    <span>Throughput</span>
                    <strong>{benchmark ? formatThroughput(benchmark.wasm.megapixelsPerSecond) : '—'}</strong>
                  </div>
                </article>

                <article className={`engine-result engine-result--js${timingWinner === 'javascript' ? ' engine-result--winner' : ''}`}>
                  <div className="engine-result-label">
                    <span className="engine-dot" />
                    <span>TypeScript</span>
                    <small>optimized browser JS</small>
                  </div>
                  <strong>
                    {benchmark ? formatMilliseconds(benchmark.javascript.medianMs) : '—'}
                  </strong>
                  <div className="timing-track" aria-hidden="true">
                    <span
                      style={{ width: benchmark ? timingBarWidth(benchmark.javascript.medianMs) : '0%' }}
                    />
                  </div>
                  <div className="engine-details">
                    <span>Throughput</span>
                    <strong>{benchmark ? formatThroughput(benchmark.javascript.megapixelsPerSecond) : '—'}</strong>
                  </div>
                </article>

                <article className="relative-result">
                  <span>Relative result</span>
                  <strong>{benchmark ? getRelativeLabel(benchmark) : '—'}</strong>
                  <p>
                    {benchmark
                      ? isBelowTimerPrecision(benchmark)
                        ? 'The operation is too short for a reliable single-call comparison on this timer.'
                        : benchmark.relative.winner === 'tie'
                        ? 'Median execution times are within the 3% tie threshold.'
                        : `Measured on this device for ${activeFilter.label.toLowerCase()}. Lower is better.`
                      : 'Results depend on the image, filter, browser, and hardware.'}
                  </p>
                </article>
              </div>

              <div className="benchmark-meta">
                <div>
                  <span>Resolution</span>
                  <strong>{imageMetadata ? `${imageMetadata.width} × ${imageMetadata.height}` : '—'}</strong>
                </div>
                <div>
                  <span>Pixels processed</span>
                  <strong>{imageMetadata ? `${imageMegapixels.toFixed(2)} MP` : '—'}</strong>
                </div>
                <div>
                  <span>Method</span>
                  <strong>
                    {benchmark
                      ? `${benchmark.warmupIterations} warm-up + median of ${benchmark.measuredIterations}`
                      : 'Warm-up + median'}
                  </strong>
                </div>
                <div>
                  <span>Timed scope</span>
                  <strong>Engine call only</strong>
                </div>
              </div>
              <details className="methodology-details">
                <summary>What exactly is measured?</summary>
                <p>
                  After an edit settles, a worker warms up and measures both engines against reusable buffers reset from
                  the same immutable source outside the timer. WASM initialization, worker messaging, Canvas readback,
                  and rendering are excluded. The WASM result includes wasm-bindgen allocation and boundary copies—the
                  cost a browser caller actually pays. Run order alternates to reduce systematic bias.
                </p>
              </details>
            </section>
          </div>
        </section>

        <section className="architecture-section" id="architecture" aria-labelledby="architecture-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Architecture</p>
              <h2 id="architecture-title">How a frame is processed</h2>
            </div>
            <p>
              No API, storage, or server-side processing. A dedicated worker renders the WASM preview first, then
              feeds the same RGBA source to both engines for measurement and pixel validation.
            </p>
          </div>

          <figure className="pipeline">
            <figcaption className="visually-hidden">
              Immutable ImageData enters a processing worker for a Rust WebAssembly preview, then branches to
              equivalent TypeScript and Rust kernels for measurement before returning to Canvas.
            </figcaption>
            <ol className="pipeline-steps">
              <li className="pipeline-step">
                <span>01</span>
                <strong>Image / Canvas</strong>
                <small>Decode once to immutable RGBA</small>
              </li>
              <li className="pipeline-pair">
                <div className="pipeline-step">
                  <span>02A</span>
                  <strong>TypeScript</strong>
                  <small>Worker typed-array kernel</small>
                </div>
                <div className="pipeline-step pipeline-step--accent">
                  <span>02B</span>
                  <strong>wasm-bindgen → Rust</strong>
                  <small>Worker boundary + Rust kernel</small>
                </div>
              </li>
              <li className="pipeline-step pipeline-step--output">
                <span>03</span>
                <strong>Compare / Canvas</strong>
                <small>Validate, measure, transfer, render</small>
              </li>
            </ol>
          </figure>

          <div className="engineering-principles">
            <article>
              <h3>Equivalent implementations</h3>
              <p>Both engines use the same kernels, coefficients, edge handling, and parameter ranges.</p>
            </article>
            <article>
              <h3>Automatic measurements</h3>
              <p>Debouncing, worker execution, warm-ups, and alternating runs keep editing responsive and results current.</p>
            </article>
            <article>
              <h3>Local processing</h3>
              <p>Images are decoded, processed, and rendered in the current browser tab.</p>
            </article>
          </div>
        </section>
      </main>

      <footer className="footer">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-name">
            Oxide <span>Lab</span>
          </span>
        </a>
        <p>Client-side image processing with Rust, WebAssembly, TypeScript, and React.</p>
        <a className="footer-top" href="#top">Back to top</a>
      </footer>
    </div>
  )
}

export default App
