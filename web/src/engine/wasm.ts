import init, {
  adjust_brightness,
  adjust_clarity,
  adjust_contrast,
  adjust_highlights,
  adjust_saturation,
  adjust_texture,
  gaussian_blur,
  grayscale,
  sobel_edges,
} from '../wasm/rust_engine.js'
import type { FilterId, FilterParameters } from './filters'

let wasmInitialization: ReturnType<typeof init> | null = null

/** Initializes the generated module once; initialization is never benchmarked. */
export function initializeWasm(input?: Parameters<typeof init>[0]): ReturnType<typeof init> {
  wasmInitialization ??= input === undefined ? init() : init(input)
  return wasmInitialization
}

/** Applies one filter through the generated wasm-bindgen boundary. */
export function applyWasmFilter(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  filter: FilterId,
  parameters: Readonly<FilterParameters>,
): void {
  // Creating the view is free; wasm-bindgen copies its bytes into and back out
  // of linear memory as part of the measured browser-facing engine call.
  const view = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)

  switch (filter) {
    case 'grayscale':
      grayscale(view)
      return
    case 'brightness':
      adjust_brightness(view, parameters.brightness)
      return
    case 'contrast':
      adjust_contrast(view, parameters.contrast)
      return
    case 'saturation':
      adjust_saturation(view, parameters.saturation)
      return
    case 'highlights':
      adjust_highlights(view, parameters.highlights)
      return
    case 'texture':
      adjust_texture(view, width, height, parameters.texture)
      return
    case 'clarity':
      adjust_clarity(view, width, height, parameters.clarity)
      return
    case 'gaussian-blur':
      gaussian_blur(view, width, height, parameters.blurRadius)
      return
    case 'sobel-edges':
      sobel_edges(view, width, height, parameters.edgeThreshold)
      return
  }

  const unsupportedFilter: never = filter
  throw new RangeError(`Unsupported filter: ${String(unsupportedFilter)}.`)
}
