/** A mutable canvas-compatible RGBA pixel buffer. */
export type PixelBuffer = Uint8Array | Uint8ClampedArray

const RED_LUMA = 0.299
const GREEN_LUMA = 0.587
const BLUE_LUMA = 0.114

export type FilterId =
  | 'grayscale'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'highlights'
  | 'texture'
  | 'clarity'
  | 'gaussian-blur'
  | 'sobel-edges'

export interface FilterParameters {
  brightness: number
  contrast: number
  saturation: number
  highlights: number
  texture: number
  clarity: number
  blurRadius: number
  edgeThreshold: number
}

export type FilterParameterKey = keyof FilterParameters

export interface FilterControlDefinition {
  key: FilterParameterKey
  label: string
  min: number
  max: number
  step: number
  unit: string
}

export interface FilterDefinition {
  id: FilterId
  label: string
  description: string
  control?: FilterControlDefinition
}

export const DEFAULT_FILTER_PARAMETERS: Readonly<FilterParameters> = Object.freeze({
  brightness: 20,
  contrast: 25,
  saturation: 35,
  highlights: 0,
  texture: 0,
  clarity: 0,
  blurRadius: 4,
  edgeThreshold: 80,
})

export const FILTER_DEFINITIONS: readonly FilterDefinition[] = Object.freeze([
  {
    id: 'grayscale',
    label: 'Grayscale',
    description: 'Perceptual luminance using weighted RGB channels.',
  },
  {
    id: 'brightness',
    label: 'Brightness',
    description: 'Adds a constant offset to each color channel.',
    control: { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, unit: '' },
  },
  {
    id: 'contrast',
    label: 'Contrast',
    description: 'Expands or compresses channel values around their midpoint.',
    control: { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, unit: '' },
  },
  {
    id: 'saturation',
    label: 'Saturation',
    description: 'Moves colors toward or away from perceptual luminance.',
    control: { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, unit: '%' },
  },
  {
    id: 'highlights',
    label: 'Highlights',
    description: 'Adjusts bright tones with a smooth luminance-weighted mask.',
    control: { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, unit: '' },
  },
  {
    id: 'texture',
    label: 'Texture',
    description: 'Boosts or softens fine detail using a compact local blur.',
    control: { key: 'texture', label: 'Texture', min: -100, max: 100, step: 1, unit: '' },
  },
  {
    id: 'clarity',
    label: 'Clarity',
    description: 'Adjusts broader local contrast while protecting shadows and highlights.',
    control: { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1, unit: '' },
  },
  {
    id: 'gaussian-blur',
    label: 'Gaussian blur',
    description: 'A normalized, separable Gaussian convolution with clamped edges.',
    control: { key: 'blurRadius', label: 'Radius', min: 0, max: 16, step: 1, unit: ' px' },
  },
  {
    id: 'sobel-edges',
    label: 'Sobel edges',
    description: 'Sobel gradient magnitude with an adjustable noise threshold.',
    control: { key: 'edgeThreshold', label: 'Threshold', min: 0, max: 255, step: 1, unit: '' },
  },
])

export const FILTER_DEFINITIONS_BY_ID: Readonly<Record<FilterId, FilterDefinition>> = Object.freeze(
  Object.fromEntries(FILTER_DEFINITIONS.map((definition) => [definition.id, definition])) as Record<
    FilterId,
    FilterDefinition
  >,
)

/**
 * Applies the same algorithm used by the Rust/WASM engine, mutating `pixels` in place.
 * Spatial filters require exact canvas dimensions; point filters only require complete RGBA pixels.
 */
export function applyJavaScriptFilter(
  pixels: PixelBuffer,
  width: number,
  height: number,
  filter: FilterId,
  parameters: Readonly<FilterParameters> = DEFAULT_FILTER_PARAMETERS,
): void {
  switch (filter) {
    case 'grayscale':
      grayscale(pixels)
      return
    case 'brightness':
      adjustBrightness(pixels, parameters.brightness)
      return
    case 'contrast':
      adjustContrast(pixels, parameters.contrast)
      return
    case 'saturation':
      adjustSaturation(pixels, parameters.saturation)
      return
    case 'highlights':
      adjustHighlights(pixels, parameters.highlights)
      return
    case 'texture':
      adjustTexture(pixels, width, height, parameters.texture)
      return
    case 'clarity':
      adjustClarity(pixels, width, height, parameters.clarity)
      return
    case 'gaussian-blur':
      gaussianBlur(pixels, width, height, parameters.blurRadius)
      return
    case 'sobel-edges':
      sobelEdges(pixels, width, height, parameters.edgeThreshold)
      return
  }

  const unsupportedFilter: never = filter
  throw new RangeError(`Unsupported filter: ${String(unsupportedFilter)}.`)
}

export function grayscale(pixels: PixelBuffer): void {
  assertRgbaBuffer(pixels)

  for (let index = 0; index < pixels.length; index += 4) {
    const gray = toByte(calculateLuminance(pixels[index], pixels[index + 1], pixels[index + 2]))
    pixels[index] = gray
    pixels[index + 1] = gray
    pixels[index + 2] = gray
  }
}

export function adjustBrightness(pixels: PixelBuffer, amount: number): void {
  assertRgbaBuffer(pixels)
  assertIntegerInRange(amount, -255, 255, 'Brightness')

  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = toByte(pixels[index] + amount)
    pixels[index + 1] = toByte(pixels[index + 1] + amount)
    pixels[index + 2] = toByte(pixels[index + 2] + amount)
  }
}

export function adjustContrast(pixels: PixelBuffer, amount: number): void {
  assertRgbaBuffer(pixels)
  assertFiniteInRange(amount, -100, 100, 'Contrast')

  const factor = (259 * (amount + 255)) / (255 * (259 - amount))
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = toByte(factor * (pixels[index] - 128) + 128)
    pixels[index + 1] = toByte(factor * (pixels[index + 1] - 128) + 128)
    pixels[index + 2] = toByte(factor * (pixels[index + 2] - 128) + 128)
  }
}

export function adjustSaturation(pixels: PixelBuffer, amount: number): void {
  assertRgbaBuffer(pixels)
  assertFiniteInRange(amount, -100, 100, 'Saturation')

  const factor = 1 + amount / 100
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const gray = calculateLuminance(red, green, blue)

    pixels[index] = toByte(gray + (red - gray) * factor)
    pixels[index + 1] = toByte(gray + (green - gray) * factor)
    pixels[index + 2] = toByte(gray + (blue - gray) * factor)
  }
}

/** Adjusts bright tones with a smooth mask that is zero at and below mid-gray. */
export function adjustHighlights(pixels: PixelBuffer, amount: number): void {
  assertRgbaBuffer(pixels)
  assertFiniteInRange(amount, -100, 100, 'Highlights')
  if (amount === 0) return

  for (let index = 0; index < pixels.length; index += 4) {
    const gray = calculateLuminance(pixels[index], pixels[index + 1], pixels[index + 2])
    const normalized = Math.min(1, Math.max(0, (gray - 127.5) / 127.5))
    const mask = smoothstep(normalized)

    pixels[index] = toByte(pixels[index] + amount * mask)
    pixels[index + 1] = toByte(pixels[index + 1] + amount * mask)
    pixels[index + 2] = toByte(pixels[index + 2] + amount * mask)
  }
}

/**
 * Adjusts fine detail from a clamped-edge 3x3 binomial blur. The original
 * pixels remain untouched until the complete local-mean buffer is available.
 */
export function adjustTexture(
  pixels: PixelBuffer,
  width: number,
  height: number,
  amount: number,
): void {
  assertSpatialImage(pixels, width, height)
  assertFiniteInRange(amount, -100, 100, 'Texture')
  if (amount === 0) return

  const horizontal = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = (y * width + clampCoordinate(x - 1, width)) * 4
      const center = (y * width + x) * 4
      const right = (y * width + clampCoordinate(x + 1, width)) * 4
      const target = (y * width + x) * 3
      for (let channel = 0; channel < 3; channel += 1) {
        horizontal[target + channel] =
          pixels[left + channel] * 0.25 +
          pixels[center + channel] * 0.5 +
          pixels[right + channel] * 0.25
      }
    }
  }

  const strength = amount / 100
  for (let y = 0; y < height; y += 1) {
    const top = clampCoordinate(y - 1, height)
    const bottom = clampCoordinate(y + 1, height)
    for (let x = 0; x < width; x += 1) {
      const topIndex = (top * width + x) * 3
      const centerIndex = (y * width + x) * 3
      const bottomIndex = (bottom * width + x) * 3
      const pixelIndex = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const localMean =
          horizontal[topIndex + channel] * 0.25 +
          horizontal[centerIndex + channel] * 0.5 +
          horizontal[bottomIndex + channel] * 0.25
        const source = pixels[pixelIndex + channel]
        pixels[pixelIndex + channel] = toByte(source + strength * (source - localMean))
      }
    }
  }
}

/**
 * Adjusts broader, midtone-weighted local contrast from a clamped-edge 9x9
 * box blur. Unlike texture, clarity fades toward deep shadows and highlights.
 */
export function adjustClarity(
  pixels: PixelBuffer,
  width: number,
  height: number,
  amount: number,
): void {
  assertSpatialImage(pixels, width, height)
  assertFiniteInRange(amount, -100, 100, 'Clarity')
  if (amount === 0) return

  const radius = 4
  const weight = 1 / (radius * 2 + 1)
  const horizontal = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 3
      let red = 0
      let green = 0
      let blue = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const source = (y * width + clampCoordinate(x + offset, width)) * 4
        red += pixels[source] * weight
        green += pixels[source + 1] * weight
        blue += pixels[source + 2] * weight
      }
      horizontal[target] = red
      horizontal[target + 1] = green
      horizontal[target + 2] = blue
    }
  }

  const strength = amount / 100
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      for (let offset = -radius; offset <= radius; offset += 1) {
        const source = (clampCoordinate(y + offset, height) * width + x) * 3
        red += horizontal[source] * weight
        green += horizontal[source + 1] * weight
        blue += horizontal[source + 2] * weight
      }

      const pixelIndex = (y * width + x) * 4
      const gray = calculateLuminance(
        pixels[pixelIndex],
        pixels[pixelIndex + 1],
        pixels[pixelIndex + 2],
      )
      const midtone = Math.min(1, Math.max(0, 1 - Math.abs((gray - 127.5) / 127.5)))
      const mask = smoothstep(midtone)
      const mix = strength * mask
      const sourceRed = pixels[pixelIndex]
      const sourceGreen = pixels[pixelIndex + 1]
      const sourceBlue = pixels[pixelIndex + 2]
      pixels[pixelIndex] = toByte(sourceRed + mix * (sourceRed - red))
      pixels[pixelIndex + 1] = toByte(
        sourceGreen + mix * (sourceGreen - green),
      )
      pixels[pixelIndex + 2] = toByte(
        sourceBlue + mix * (sourceBlue - blue),
      )
    }
  }
}

/**
 * Applies a two-pass Gaussian convolution. The 2r+1 kernel and RGB-only intermediate buffer
 * intentionally mirror the optimized Rust implementation instead of comparing different algorithms.
 */
export function gaussianBlur(pixels: PixelBuffer, width: number, height: number, radius: number): void {
  assertSpatialImage(pixels, width, height)
  assertIntegerInRange(radius, 0, 64, 'Blur radius')
  if (radius === 0) {
    return
  }

  const kernel = createGaussianKernel(radius)
  const horizontal = new Float32Array(width * height * 3)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0
      let green = 0
      let blue = 0

      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceX = clampCoordinate(x + offset, width)
        const sourceIndex = (y * width + sourceX) * 4
        const weight = kernel[offset + radius]
        red += pixels[sourceIndex] * weight
        green += pixels[sourceIndex + 1] * weight
        blue += pixels[sourceIndex + 2] * weight
      }

      const targetIndex = (y * width + x) * 3
      horizontal[targetIndex] = red
      horizontal[targetIndex + 1] = green
      horizontal[targetIndex + 2] = blue
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0
      let green = 0
      let blue = 0

      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceY = clampCoordinate(y + offset, height)
        const sourceIndex = (sourceY * width + x) * 3
        const weight = kernel[offset + radius]
        red += horizontal[sourceIndex] * weight
        green += horizontal[sourceIndex + 1] * weight
        blue += horizontal[sourceIndex + 2] * weight
      }

      const targetIndex = (y * width + x) * 4
      pixels[targetIndex] = toByte(red)
      pixels[targetIndex + 1] = toByte(green)
      pixels[targetIndex + 2] = toByte(blue)
    }
  }
}

export function sobelEdges(pixels: PixelBuffer, width: number, height: number, threshold: number): void {
  assertSpatialImage(pixels, width, height)
  assertFiniteInRange(threshold, 0, 255, 'Edge threshold')

  const luminances = new Float32Array(width * height)
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4
    luminances[pixelIndex] = calculateLuminance(
      pixels[rgbaIndex],
      pixels[rgbaIndex + 1],
      pixels[rgbaIndex + 2],
    )
  }

  for (let y = 0; y < height; y += 1) {
    const top = clampCoordinate(y - 1, height)
    const bottom = clampCoordinate(y + 1, height)

    for (let x = 0; x < width; x += 1) {
      const left = clampCoordinate(x - 1, width)
      const right = clampCoordinate(x + 1, width)

      const topLeft = luminances[top * width + left]
      const topCenter = luminances[top * width + x]
      const topRight = luminances[top * width + right]
      const middleLeft = luminances[y * width + left]
      const middleRight = luminances[y * width + right]
      const bottomLeft = luminances[bottom * width + left]
      const bottomCenter = luminances[bottom * width + x]
      const bottomRight = luminances[bottom * width + right]

      const gradientX = -topLeft + topRight - 2 * middleLeft + 2 * middleRight - bottomLeft + bottomRight
      const gradientY =
        -topLeft - 2 * topCenter - topRight + bottomLeft + 2 * bottomCenter + bottomRight
      const magnitude = Math.hypot(gradientX, gradientY)
      const edge = magnitude >= threshold ? toByte(magnitude) : 0
      const targetIndex = (y * width + x) * 4
      pixels[targetIndex] = edge
      pixels[targetIndex + 1] = edge
      pixels[targetIndex + 2] = edge
    }
  }
}

function createGaussianKernel(radius: number): Float32Array {
  const sigma = Math.max(radius / 2, 0.5)
  const kernel = new Float32Array(radius * 2 + 1)
  const denominator = 2 * sigma * sigma
  let sum = 0

  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / denominator)
    kernel[offset + radius] = weight
    sum += weight
  }
  for (let index = 0; index < kernel.length; index += 1) {
    kernel[index] /= sum
  }
  return kernel
}

function assertRgbaBuffer(pixels: PixelBuffer): void {
  if (pixels.length % 4 !== 0) {
    throw new RangeError(`RGBA buffer length must be a multiple of 4; received ${pixels.length}.`)
  }
}

function assertSpatialImage(pixels: PixelBuffer, width: number, height: number): void {
  assertRgbaBuffer(pixels)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Image dimensions must be positive integers; received ${width} x ${height}.`)
  }

  const expectedLength = width * height * 4
  if (!Number.isSafeInteger(expectedLength) || pixels.length !== expectedLength) {
    throw new RangeError(`Expected ${expectedLength} RGBA bytes for ${width} x ${height}; received ${pixels.length}.`)
  }
}

function assertIntegerInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}; received ${value}.`)
  }
}

function assertFiniteInRange(value: number, min: number, max: number, label: string): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a finite number from ${min} to ${max}; received ${value}.`)
  }
}

function clampCoordinate(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value))
}

function calculateLuminance(red: number, green: number, blue: number): number {
  return RED_LUMA * red + GREEN_LUMA * green + BLUE_LUMA * blue
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function toByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}
