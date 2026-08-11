import type {
  BenchmarkComparisonResult,
  BenchmarkOptions,
  FilterId,
  FilterParameters,
} from './engine'

interface ProcessingRequestBase {
  requestId: number
  sourceBuffer: ArrayBuffer
  width: number
  height: number
  filter: FilterId
  parameters: FilterParameters
}

export interface PreviewWorkerRequest extends ProcessingRequestBase {
  type: 'preview'
}

export interface BenchmarkWorkerRequest extends ProcessingRequestBase {
  type: 'benchmark'
  options: BenchmarkOptions
}

export type ProcessingWorkerRequest = PreviewWorkerRequest | BenchmarkWorkerRequest

export type ProcessingWorkerResponse =
  | {
      type: 'preview-result'
      requestId: number
      width: number
      height: number
      output: Uint8ClampedArray
    }
  | {
      type: 'benchmark-result'
      requestId: number
      result: BenchmarkComparisonResult
    }
  | {
      type: 'error'
      jobType: ProcessingWorkerRequest['type']
      requestId: number
      message: string
    }
