/* tslint:disable */
/* eslint-disable */

/**
 * Adds `amount` to every color channel, clamped to the byte range.
 *
 * `amount` is expressed in channel values and must be in `-255..=255`.
 */
export function adjust_brightness(pixels: Uint8Array, amount: number): void;

/**
 * Adjusts broad local contrast in the midtones.
 *
 * Unlike global contrast, clarity compares each channel with a 9x9 local
 * mean. Unlike texture, it uses a broader neighborhood and a smooth midtone
 * mask, protecting deep shadows and bright highlights. `amount` must be in
 * `-100..=100`, with zero as the neutral/default value; edge samples are
 * clamped and alpha is preserved.
 */
export function adjust_clarity(pixels: Uint8Array, width: number, height: number, amount: number): void;

/**
 * Adjusts contrast around the midpoint of 128.
 *
 * `amount` is a finite adjustment value in `-100..=100`. The transform uses
 * the common contrast factor
 * `(259 * (amount + 255)) / (255 * (259 - amount))`.
 */
export function adjust_contrast(pixels: Uint8Array, amount: number): void;

/**
 * Adjusts bright tones while leaving shadows and low midtones unchanged.
 *
 * `amount` must be in `-100..=100`, with zero as the neutral/default value.
 * A smooth luminance mask begins at 50% gray and reaches full strength at
 * white, avoiding a hard tonal boundary.
 */
export function adjust_highlights(pixels: Uint8Array, amount: number): void;

/**
 * Adjusts color saturation relative to perceptual luminance.
 *
 * `amount` must be in `-100..=100`: `-100` is grayscale, `0` is unchanged,
 * and `100` doubles each channel's distance from luminance.
 */
export function adjust_saturation(pixels: Uint8Array, amount: number): void;

/**
 * Boosts or suppresses fine RGB detail relative to a 3x3 local mean.
 *
 * `amount` must be in `-100..=100`, with zero as the neutral/default value.
 * Positive values amplify the fine-scale high-pass signal; at `-100`, the
 * output is the local mean. Edge samples are clamped to the nearest pixel and
 * alpha is preserved.
 */
export function adjust_texture(pixels: Uint8Array, width: number, height: number, amount: number): void;

/**
 * Applies an optimized separable Gaussian blur to the RGB channels.
 *
 * The kernel has `2 * radius + 1` taps and sigma `max(radius / 2, 0.5)`.
 * Edge samples are clamped to the nearest pixel. Radius zero is a validated
 * no-op, and the maximum supported radius is 64.
 */
export function gaussian_blur(pixels: Uint8Array, width: number, height: number, radius: number): void;

/**
 * Converts an RGBA buffer to perceptual grayscale.
 *
 * Uses Rec. 601 luma (`0.299R + 0.587G + 0.114B`) and preserves alpha.
 */
export function grayscale(pixels: Uint8Array): void;

/**
 * Runs Sobel edge detection and writes a grayscale edge magnitude.
 *
 * Magnitudes below `threshold` are set to black; remaining magnitudes are
 * clamped to 255. Sampling at image boundaries is clamped to the nearest
 * pixel. Alpha is copied through unchanged.
 */
export function sobel_edges(pixels: Uint8Array, width: number, height: number, threshold: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly adjust_brightness: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly adjust_clarity: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly adjust_contrast: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly adjust_highlights: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly adjust_saturation: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly adjust_texture: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly gaussian_blur: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly grayscale: (a: number, b: number, c: number, d: number) => void;
    readonly sobel_edges: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
