import type { ProcessingWorkerRequest, ProcessingWorkerResponse } from './processingProtocol'
import {
  applyJavaScriptFilter,
  applyWasmFilter,
  benchmarkComparison,
  initializeWasm,
} from './engine'

interface ProcessingWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ProcessingWorkerRequest>) => void,
  ): void
  postMessage(message: ProcessingWorkerResponse, transfer?: Transferable[]): void
}

const workerScope = self as unknown as ProcessingWorkerScope

let jobQueue = Promise.resolve()
let workerFailed = false

workerScope.addEventListener('message', (event) => {
  const request = event.data
  jobQueue = jobQueue.then(() => runJob(request))
})

async function runJob(request: ProcessingWorkerRequest): Promise<void> {
  // A processing failure is fatal for this realm. The main thread will tear
  // the worker down when it receives the error, so never start work that was
  // already queued behind the failed job in the meantime.
  if (workerFailed) return

  try {
    // Startup is shared by every job in this worker and remains outside all
    // benchmarkComparison timers.
    await initializeWasm()
    const source = new Uint8ClampedArray(request.sourceBuffer)

    if (request.type === 'preview') {
      applyWasmFilter(source, request.width, request.height, request.filter, request.parameters)
      workerScope.postMessage(
        {
          type: 'preview-result',
          requestId: request.requestId,
          width: request.width,
          height: request.height,
          output: source,
        },
        [source.buffer] as Transferable[],
      )
      return
    }

    const result = benchmarkComparison(
      source,
      request.width,
      request.height,
      (pixels) =>
        applyJavaScriptFilter(
          pixels,
          request.width,
          request.height,
          request.filter,
          request.parameters,
        ),
      (pixels) =>
        applyWasmFilter(
          pixels,
          request.width,
          request.height,
          request.filter,
          request.parameters,
        ),
      request.options,
    )

    workerScope.postMessage(
      { type: 'benchmark-result', requestId: request.requestId, result },
      [result.javascriptOutput.buffer, result.wasmOutput.buffer] as Transferable[],
    )
  } catch (error) {
    workerFailed = true
    workerScope.postMessage({
      type: 'error',
      jobType: request.type,
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'The image processing worker failed unexpectedly.',
    })
  }
}
