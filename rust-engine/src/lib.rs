//! Image processing primitives compiled to WebAssembly.
//!
//! Every exported function operates in place on the flat RGBA layout used by
//! [`ImageData`](https://developer.mozilla.org/en-US/docs/Web/API/ImageData):
//! `[R, G, B, A, R, G, B, A, ...]`. Filters never modify alpha. Functions
//! which need spatial context also require the exact image dimensions so a
//! malformed buffer is rejected before any pixels are changed.

use std::fmt;

use wasm_bindgen::prelude::*;

const CHANNELS_PER_PIXEL: usize = 4;
const MAX_BLUR_RADIUS: u32 = 64;
const MIN_ADJUSTMENT: f32 = -100.0;
const MAX_ADJUSTMENT: f32 = 100.0;

// A three-tap binomial kernel isolates fine detail without introducing the
// blockier response of a box blur. Clarity deliberately uses a much broader
// local mean so the two controls affect different spatial frequencies.
const TEXTURE_KERNEL: [f32; 3] = [0.25, 0.5, 0.25];
const CLARITY_KERNEL: [f32; 9] = [1.0 / 9.0; 9];

// Rec. 601 luma coefficients. These are also used by the TypeScript reference
// implementation so the two engines perform equivalent work.
const RED_LUMA: f32 = 0.299;
const GREEN_LUMA: f32 = 0.587;
const BLUE_LUMA: f32 = 0.114;

#[derive(Debug, PartialEq)]
enum FilterError {
    InvalidRgbaLength {
        actual: usize,
    },
    EmptyDimensions,
    DimensionOverflow {
        width: u32,
        height: u32,
    },
    BufferDimensionMismatch {
        expected: usize,
        actual: usize,
        width: u32,
        height: u32,
    },
    BrightnessOutOfRange {
        amount: i16,
    },
    ContrastOutOfRange {
        amount: f32,
    },
    SaturationOutOfRange {
        amount: f32,
    },
    HighlightsOutOfRange {
        amount: f32,
    },
    TextureOutOfRange {
        amount: f32,
    },
    ClarityOutOfRange {
        amount: f32,
    },
    BlurRadiusOutOfRange {
        radius: u32,
    },
}

impl fmt::Display for FilterError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRgbaLength { actual } => write!(
                formatter,
                "RGBA buffer length must be a multiple of 4 bytes; received {actual}"
            ),
            Self::EmptyDimensions => {
                write!(formatter, "image width and height must both be non-zero")
            }
            Self::DimensionOverflow { width, height } => write!(
                formatter,
                "image dimensions {width}x{height} are too large to address"
            ),
            Self::BufferDimensionMismatch {
                expected,
                actual,
                width,
                height,
            } => write!(
                formatter,
                "RGBA buffer length does not match {width}x{height}: expected {expected} bytes, received {actual}"
            ),
            Self::BrightnessOutOfRange { amount } => write!(
                formatter,
                "brightness amount must be between -255 and 255; received {amount}"
            ),
            Self::ContrastOutOfRange { amount } => write!(
                formatter,
                "contrast amount must be a finite number between -100 and 100; received {amount}"
            ),
            Self::SaturationOutOfRange { amount } => write!(
                formatter,
                "saturation amount must be a finite number between -100 and 100; received {amount}"
            ),
            Self::HighlightsOutOfRange { amount } => write!(
                formatter,
                "highlights amount must be a finite number between -100 and 100; received {amount}"
            ),
            Self::TextureOutOfRange { amount } => write!(
                formatter,
                "texture amount must be a finite number between -100 and 100; received {amount}"
            ),
            Self::ClarityOutOfRange { amount } => write!(
                formatter,
                "clarity amount must be a finite number between -100 and 100; received {amount}"
            ),
            Self::BlurRadiusOutOfRange { radius } => write!(
                formatter,
                "blur radius must not exceed {MAX_BLUR_RADIUS}; received {radius}"
            ),
        }
    }
}

impl From<FilterError> for JsValue {
    fn from(error: FilterError) -> Self {
        JsValue::from_str(&error.to_string())
    }
}

/// Converts an RGBA buffer to perceptual grayscale.
///
/// Uses Rec. 601 luma (`0.299R + 0.587G + 0.114B`) and preserves alpha.
#[wasm_bindgen]
pub fn grayscale(pixels: &mut [u8]) -> Result<(), JsValue> {
    grayscale_impl(pixels).map_err(Into::into)
}

/// Adds `amount` to every color channel, clamped to the byte range.
///
/// `amount` is expressed in channel values and must be in `-255..=255`.
#[wasm_bindgen]
pub fn adjust_brightness(pixels: &mut [u8], amount: i16) -> Result<(), JsValue> {
    adjust_brightness_impl(pixels, amount).map_err(Into::into)
}

/// Adjusts contrast around the midpoint of 128.
///
/// `amount` is a finite adjustment value in `-100..=100`. The transform uses
/// the common contrast factor
/// `(259 * (amount + 255)) / (255 * (259 - amount))`.
#[wasm_bindgen]
pub fn adjust_contrast(pixels: &mut [u8], amount: f32) -> Result<(), JsValue> {
    adjust_contrast_impl(pixels, amount).map_err(Into::into)
}

/// Adjusts color saturation relative to perceptual luminance.
///
/// `amount` must be in `-100..=100`: `-100` is grayscale, `0` is unchanged,
/// and `100` doubles each channel's distance from luminance.
#[wasm_bindgen]
pub fn adjust_saturation(pixels: &mut [u8], amount: f32) -> Result<(), JsValue> {
    adjust_saturation_impl(pixels, amount).map_err(Into::into)
}

/// Adjusts bright tones while leaving shadows and low midtones unchanged.
///
/// `amount` must be in `-100..=100`, with zero as the neutral/default value.
/// A smooth luminance mask begins at 50% gray and reaches full strength at
/// white, avoiding a hard tonal boundary.
#[wasm_bindgen]
pub fn adjust_highlights(pixels: &mut [u8], amount: f32) -> Result<(), JsValue> {
    adjust_highlights_impl(pixels, amount).map_err(Into::into)
}

/// Boosts or suppresses fine RGB detail relative to a 3x3 local mean.
///
/// `amount` must be in `-100..=100`, with zero as the neutral/default value.
/// Positive values amplify the fine-scale high-pass signal; at `-100`, the
/// output is the local mean. Edge samples are clamped to the nearest pixel and
/// alpha is preserved.
#[wasm_bindgen]
pub fn adjust_texture(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    amount: f32,
) -> Result<(), JsValue> {
    adjust_texture_impl(pixels, width, height, amount).map_err(Into::into)
}

/// Adjusts broad local contrast in the midtones.
///
/// Unlike global contrast, clarity compares each channel with a 9x9 local
/// mean. Unlike texture, it uses a broader neighborhood and a smooth midtone
/// mask, protecting deep shadows and bright highlights. `amount` must be in
/// `-100..=100`, with zero as the neutral/default value; edge samples are
/// clamped and alpha is preserved.
#[wasm_bindgen]
pub fn adjust_clarity(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    amount: f32,
) -> Result<(), JsValue> {
    adjust_clarity_impl(pixels, width, height, amount).map_err(Into::into)
}

/// Applies an optimized separable Gaussian blur to the RGB channels.
///
/// The kernel has `2 * radius + 1` taps and sigma `max(radius / 2, 0.5)`.
/// Edge samples are clamped to the nearest pixel. Radius zero is a validated
/// no-op, and the maximum supported radius is 64.
#[wasm_bindgen]
pub fn gaussian_blur(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    radius: u32,
) -> Result<(), JsValue> {
    gaussian_blur_impl(pixels, width, height, radius).map_err(Into::into)
}

/// Runs Sobel edge detection and writes a grayscale edge magnitude.
///
/// Magnitudes below `threshold` are set to black; remaining magnitudes are
/// clamped to 255. Sampling at image boundaries is clamped to the nearest
/// pixel. Alpha is copied through unchanged.
#[wasm_bindgen]
pub fn sobel_edges(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    threshold: u8,
) -> Result<(), JsValue> {
    sobel_edges_impl(pixels, width, height, threshold).map_err(Into::into)
}

fn grayscale_impl(pixels: &mut [u8]) -> Result<(), FilterError> {
    validate_rgba_buffer(pixels)?;

    for pixel in pixels.chunks_exact_mut(CHANNELS_PER_PIXEL) {
        let gray = round_to_byte(luminance(pixel[0], pixel[1], pixel[2]));
        pixel[0] = gray;
        pixel[1] = gray;
        pixel[2] = gray;
    }

    Ok(())
}

fn adjust_brightness_impl(pixels: &mut [u8], amount: i16) -> Result<(), FilterError> {
    validate_rgba_buffer(pixels)?;
    if !(-255..=255).contains(&amount) {
        return Err(FilterError::BrightnessOutOfRange { amount });
    }

    for pixel in pixels.chunks_exact_mut(CHANNELS_PER_PIXEL) {
        for channel in &mut pixel[..3] {
            *channel = (i16::from(*channel) + amount).clamp(0, 255) as u8;
        }
    }

    Ok(())
}

fn adjust_contrast_impl(pixels: &mut [u8], amount: f32) -> Result<(), FilterError> {
    validate_rgba_buffer(pixels)?;
    if !amount.is_finite() || !(-100.0..=100.0).contains(&amount) {
        return Err(FilterError::ContrastOutOfRange { amount });
    }

    let factor = (259.0 * (amount + 255.0)) / (255.0 * (259.0 - amount));
    for pixel in pixels.chunks_exact_mut(CHANNELS_PER_PIXEL) {
        for channel in &mut pixel[..3] {
            *channel = round_to_byte(factor * (f32::from(*channel) - 128.0) + 128.0);
        }
    }

    Ok(())
}

fn adjust_saturation_impl(pixels: &mut [u8], amount: f32) -> Result<(), FilterError> {
    validate_rgba_buffer(pixels)?;
    if !amount.is_finite() || !(-100.0..=100.0).contains(&amount) {
        return Err(FilterError::SaturationOutOfRange { amount });
    }

    let factor = 1.0 + amount / 100.0;
    for pixel in pixels.chunks_exact_mut(CHANNELS_PER_PIXEL) {
        let gray = luminance(pixel[0], pixel[1], pixel[2]);
        for channel in &mut pixel[..3] {
            *channel = round_to_byte(gray + (f32::from(*channel) - gray) * factor);
        }
    }

    Ok(())
}

fn adjust_highlights_impl(pixels: &mut [u8], amount: f32) -> Result<(), FilterError> {
    validate_rgba_buffer(pixels)?;
    if !amount.is_finite() || !(MIN_ADJUSTMENT..=MAX_ADJUSTMENT).contains(&amount) {
        return Err(FilterError::HighlightsOutOfRange { amount });
    }
    if amount == 0.0 {
        return Ok(());
    }

    for pixel in pixels.chunks_exact_mut(CHANNELS_PER_PIXEL) {
        let mask = highlight_weight(luminance(pixel[0], pixel[1], pixel[2]));
        for channel in &mut pixel[..3] {
            *channel = round_to_byte(f32::from(*channel) + amount * mask);
        }
    }

    Ok(())
}

fn adjust_texture_impl(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    amount: f32,
) -> Result<(), FilterError> {
    let (width, height, pixel_count) = validate_spatial_buffer(pixels, width, height)?;
    if !amount.is_finite() || !(MIN_ADJUSTMENT..=MAX_ADJUSTMENT).contains(&amount) {
        return Err(FilterError::TextureOutOfRange { amount });
    }
    if amount == 0.0 {
        return Ok(());
    }

    apply_local_detail(
        pixels,
        width,
        height,
        pixel_count,
        &TEXTURE_KERNEL,
        amount / 100.0,
        |_, _, _| 1.0,
    );
    Ok(())
}

fn adjust_clarity_impl(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    amount: f32,
) -> Result<(), FilterError> {
    let (width, height, pixel_count) = validate_spatial_buffer(pixels, width, height)?;
    if !amount.is_finite() || !(MIN_ADJUSTMENT..=MAX_ADJUSTMENT).contains(&amount) {
        return Err(FilterError::ClarityOutOfRange { amount });
    }
    if amount == 0.0 {
        return Ok(());
    }

    apply_local_detail(
        pixels,
        width,
        height,
        pixel_count,
        &CLARITY_KERNEL,
        amount / 100.0,
        |red, green, blue| midtone_weight(luminance(red, green, blue)),
    );
    Ok(())
}

fn gaussian_blur_impl(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    radius: u32,
) -> Result<(), FilterError> {
    let (width, height, pixel_count) = validate_spatial_buffer(pixels, width, height)?;
    if radius > MAX_BLUR_RADIUS {
        return Err(FilterError::BlurRadiusOutOfRange { radius });
    }
    if radius == 0 {
        return Ok(());
    }

    let radius = radius as usize;
    let kernel = gaussian_kernel(radius);

    // A separable convolution changes the work per pixel from O(r^2) to O(r).
    // Only RGB intermediates are stored; the original alpha bytes stay in place.
    let mut horizontal = vec![0.0_f32; pixel_count * 3];

    for y in 0..height {
        for x in 0..width {
            let destination = (y * width + x) * 3;
            let mut red = 0.0;
            let mut green = 0.0;
            let mut blue = 0.0;

            for (tap, weight) in kernel.iter().enumerate() {
                let sample_x = clamped_offset(x, tap, radius, width);
                let source = (y * width + sample_x) * CHANNELS_PER_PIXEL;
                red += f32::from(pixels[source]) * weight;
                green += f32::from(pixels[source + 1]) * weight;
                blue += f32::from(pixels[source + 2]) * weight;
            }

            horizontal[destination] = red;
            horizontal[destination + 1] = green;
            horizontal[destination + 2] = blue;
        }
    }

    for y in 0..height {
        for x in 0..width {
            let destination = (y * width + x) * CHANNELS_PER_PIXEL;
            let mut red = 0.0;
            let mut green = 0.0;
            let mut blue = 0.0;

            for (tap, weight) in kernel.iter().enumerate() {
                let sample_y = clamped_offset(y, tap, radius, height);
                let source = (sample_y * width + x) * 3;
                red += horizontal[source] * weight;
                green += horizontal[source + 1] * weight;
                blue += horizontal[source + 2] * weight;
            }

            pixels[destination] = round_to_byte(red);
            pixels[destination + 1] = round_to_byte(green);
            pixels[destination + 2] = round_to_byte(blue);
        }
    }

    Ok(())
}

fn sobel_edges_impl(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    threshold: u8,
) -> Result<(), FilterError> {
    let (width, height, pixel_count) = validate_spatial_buffer(pixels, width, height)?;

    // Computing luminance once prevents repeating the color conversion for
    // each of the nine neighboring samples.
    let mut luminances = Vec::with_capacity(pixel_count);
    for pixel in pixels.chunks_exact(CHANNELS_PER_PIXEL) {
        luminances.push(luminance(pixel[0], pixel[1], pixel[2]));
    }

    const SOBEL_X: [[f32; 3]; 3] = [[-1.0, 0.0, 1.0], [-2.0, 0.0, 2.0], [-1.0, 0.0, 1.0]];
    const SOBEL_Y: [[f32; 3]; 3] = [[-1.0, -2.0, -1.0], [0.0, 0.0, 0.0], [1.0, 2.0, 1.0]];

    for y in 0..height {
        for x in 0..width {
            let mut gradient_x = 0.0;
            let mut gradient_y = 0.0;

            for kernel_y in 0..3 {
                let sample_y = clamped_offset(y, kernel_y, 1, height);
                for kernel_x in 0..3 {
                    let sample_x = clamped_offset(x, kernel_x, 1, width);
                    let sample = luminances[sample_y * width + sample_x];
                    gradient_x += sample * SOBEL_X[kernel_y][kernel_x];
                    gradient_y += sample * SOBEL_Y[kernel_y][kernel_x];
                }
            }

            let magnitude = gradient_x.hypot(gradient_y);
            let edge = if magnitude >= f32::from(threshold) {
                round_to_byte(magnitude)
            } else {
                0
            };
            let destination = (y * width + x) * CHANNELS_PER_PIXEL;
            pixels[destination] = edge;
            pixels[destination + 1] = edge;
            pixels[destination + 2] = edge;
        }
    }

    Ok(())
}

/// Applies a separable local-mean kernel and mixes its high-pass residual back
/// into the original RGB channels. The horizontal buffer is the only working
/// allocation: the vertical pass writes its result directly into `pixels`
/// after every source-dependent horizontal sample has already been captured.
fn apply_local_detail<F>(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    pixel_count: usize,
    kernel: &[f32],
    strength: f32,
    tonal_weight: F,
) where
    F: Fn(u8, u8, u8) -> f32,
{
    debug_assert!(!kernel.is_empty() && kernel.len() % 2 == 1);
    let radius = kernel.len() / 2;
    let mut horizontal = vec![0.0_f32; pixel_count * 3];

    for y in 0..height {
        for x in 0..width {
            let destination = (y * width + x) * 3;

            for (tap, weight) in kernel.iter().copied().enumerate() {
                let sample_x = clamped_offset(x, tap, radius, width);
                let source = (y * width + sample_x) * CHANNELS_PER_PIXEL;
                horizontal[destination] += f32::from(pixels[source]) * weight;
                horizontal[destination + 1] += f32::from(pixels[source + 1]) * weight;
                horizontal[destination + 2] += f32::from(pixels[source + 2]) * weight;
            }
        }
    }

    for y in 0..height {
        for x in 0..width {
            let destination = (y * width + x) * CHANNELS_PER_PIXEL;
            let mut local_red = 0.0;
            let mut local_green = 0.0;
            let mut local_blue = 0.0;

            for (tap, weight) in kernel.iter().copied().enumerate() {
                let sample_y = clamped_offset(y, tap, radius, height);
                let source = (sample_y * width + x) * 3;
                local_red += horizontal[source] * weight;
                local_green += horizontal[source + 1] * weight;
                local_blue += horizontal[source + 2] * weight;
            }

            let red = pixels[destination];
            let green = pixels[destination + 1];
            let blue = pixels[destination + 2];
            let mix = strength * tonal_weight(red, green, blue);

            pixels[destination] =
                round_to_byte(f32::from(red) + mix * (f32::from(red) - local_red));
            pixels[destination + 1] =
                round_to_byte(f32::from(green) + mix * (f32::from(green) - local_green));
            pixels[destination + 2] =
                round_to_byte(f32::from(blue) + mix * (f32::from(blue) - local_blue));
        }
    }
}

fn validate_rgba_buffer(pixels: &[u8]) -> Result<(), FilterError> {
    if !pixels.len().is_multiple_of(CHANNELS_PER_PIXEL) {
        return Err(FilterError::InvalidRgbaLength {
            actual: pixels.len(),
        });
    }
    Ok(())
}

fn validate_spatial_buffer(
    pixels: &[u8],
    width: u32,
    height: u32,
) -> Result<(usize, usize, usize), FilterError> {
    validate_rgba_buffer(pixels)?;
    if width == 0 || height == 0 {
        return Err(FilterError::EmptyDimensions);
    }

    let width_usize = width as usize;
    let height_usize = height as usize;
    let Some(pixel_count) = width_usize.checked_mul(height_usize) else {
        return Err(FilterError::DimensionOverflow { width, height });
    };
    let Some(expected) = pixel_count.checked_mul(CHANNELS_PER_PIXEL) else {
        return Err(FilterError::DimensionOverflow { width, height });
    };
    if pixels.len() != expected {
        return Err(FilterError::BufferDimensionMismatch {
            expected,
            actual: pixels.len(),
            width,
            height,
        });
    }

    Ok((width_usize, height_usize, pixel_count))
}

fn gaussian_kernel(radius: usize) -> Vec<f32> {
    let sigma = (radius as f32 / 2.0).max(0.5);
    let denominator = 2.0 * sigma * sigma;
    let mut kernel = Vec::with_capacity(radius * 2 + 1);
    let mut sum = 0.0;

    for tap in 0..=(radius * 2) {
        let distance = tap as f32 - radius as f32;
        let weight = (-(distance * distance) / denominator).exp();
        kernel.push(weight);
        sum += weight;
    }
    for weight in &mut kernel {
        *weight /= sum;
    }

    kernel
}

#[inline]
fn luminance(red: u8, green: u8, blue: u8) -> f32 {
    RED_LUMA * f32::from(red) + GREEN_LUMA * f32::from(green) + BLUE_LUMA * f32::from(blue)
}

#[inline]
fn smoothstep(value: f32) -> f32 {
    value * value * (3.0 - 2.0 * value)
}

#[inline]
fn highlight_weight(luma: f32) -> f32 {
    let bright_tone = ((luma - 127.5) / 127.5).clamp(0.0, 1.0);
    smoothstep(bright_tone)
}

#[inline]
fn midtone_weight(luma: f32) -> f32 {
    let midtone = (1.0 - ((luma - 127.5) / 127.5).abs()).clamp(0.0, 1.0);
    smoothstep(midtone)
}

#[inline]
fn round_to_byte(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

#[inline]
fn clamped_offset(index: usize, tap: usize, radius: usize, limit: usize) -> usize {
    if tap <= radius {
        index.saturating_sub(radius - tap)
    } else {
        index.saturating_add(tap - radius).min(limit - 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grayscale_has_deterministic_rec_601_output_and_preserves_alpha() {
        let mut pixels = [255, 0, 0, 200, 0, 255, 0, 100, 0, 0, 255, 17];

        grayscale_impl(&mut pixels).unwrap();

        assert_eq!(
            pixels,
            [76, 76, 76, 200, 150, 150, 150, 100, 29, 29, 29, 17]
        );
    }

    #[test]
    fn color_filters_accept_empty_well_formed_buffers() {
        let mut pixels = [];

        grayscale_impl(&mut pixels).unwrap();
        adjust_brightness_impl(&mut pixels, 25).unwrap();
        adjust_contrast_impl(&mut pixels, 25.0).unwrap();
        adjust_saturation_impl(&mut pixels, 25.0).unwrap();
        adjust_highlights_impl(&mut pixels, 25.0).unwrap();

        assert!(pixels.is_empty());
    }

    #[test]
    fn rejects_incomplete_pixels_without_mutating_the_buffer() {
        let original = [10, 20, 30, 255, 1, 2];
        let mut pixels = original;

        let error = grayscale_impl(&mut pixels).unwrap_err();

        assert_eq!(error, FilterError::InvalidRgbaLength { actual: 6 });
        assert_eq!(pixels, original);
    }

    #[test]
    fn brightness_clamps_extremes_and_preserves_alpha() {
        let mut lighter = [10, 250, 128, 7];
        adjust_brightness_impl(&mut lighter, 255).unwrap();
        assert_eq!(lighter, [255, 255, 255, 7]);

        let mut darker = [10, 250, 128, 9];
        adjust_brightness_impl(&mut darker, -255).unwrap();
        assert_eq!(darker, [0, 0, 0, 9]);
    }

    #[test]
    fn brightness_rejects_out_of_range_amount_before_mutating() {
        let original = [10, 20, 30, 40];
        let mut pixels = original;

        let error = adjust_brightness_impl(&mut pixels, 256).unwrap_err();

        assert_eq!(error, FilterError::BrightnessOutOfRange { amount: 256 });
        assert_eq!(pixels, original);
    }

    #[test]
    fn zero_contrast_and_saturation_are_identity_operations() {
        let original = [17, 91, 203, 44, 255, 0, 127, 88];
        let mut contrast = original;
        let mut saturation = original;

        adjust_contrast_impl(&mut contrast, 0.0).unwrap();
        adjust_saturation_impl(&mut saturation, 0.0).unwrap();

        assert_eq!(contrast, original);
        assert_eq!(saturation, original);
    }

    #[test]
    fn minimum_saturation_matches_grayscale_and_preserves_alpha() {
        let mut saturated = [255, 0, 0, 63, 5, 100, 220, 127];
        let mut grayscale = saturated;

        adjust_saturation_impl(&mut saturated, -100.0).unwrap();
        grayscale_impl(&mut grayscale).unwrap();

        assert_eq!(saturated, grayscale);
        assert_eq!(saturated[3], 63);
        assert_eq!(saturated[7], 127);
    }

    #[test]
    fn contrast_and_saturation_reject_non_finite_and_out_of_range_values() {
        let original = [10, 20, 30, 40];

        for amount in [f32::NAN, f32::INFINITY, -101.0, 101.0] {
            let mut pixels = original;
            assert!(matches!(
                adjust_contrast_impl(&mut pixels, amount),
                Err(FilterError::ContrastOutOfRange { .. })
            ));
            assert_eq!(pixels, original);

            assert!(matches!(
                adjust_saturation_impl(&mut pixels, amount),
                Err(FilterError::SaturationOutOfRange { .. })
            ));
            assert_eq!(pixels, original);
        }
    }

    #[test]
    fn highlights_use_a_smooth_bright_tone_mask_and_preserve_alpha() {
        let original = [100, 100, 100, 7, 191, 191, 191, 31, 255, 255, 255, 127];
        let mut raised = original;
        let mut lowered = original;

        adjust_highlights_impl(&mut raised, 100.0).unwrap();
        adjust_highlights_impl(&mut lowered, -100.0).unwrap();

        assert_eq!(
            raised,
            [100, 100, 100, 7, 241, 241, 241, 31, 255, 255, 255, 127]
        );
        assert_eq!(
            lowered,
            [100, 100, 100, 7, 141, 141, 141, 31, 155, 155, 155, 127]
        );
    }

    #[test]
    fn highlights_zero_is_an_exact_identity_operation() {
        let original = [17, 91, 203, 44, 255, 0, 127, 88];
        let mut pixels = original;

        adjust_highlights_impl(&mut pixels, 0.0).unwrap();

        assert_eq!(pixels, original);
    }

    #[test]
    fn highlights_reject_invalid_amounts_and_malformed_pixels_before_mutating() {
        let original = [10, 20, 30, 40];
        for amount in [f32::NAN, f32::NEG_INFINITY, -100.1, 100.1] {
            let mut pixels = original;
            assert!(matches!(
                adjust_highlights_impl(&mut pixels, amount),
                Err(FilterError::HighlightsOutOfRange { .. })
            ));
            assert_eq!(pixels, original);
        }

        let malformed_original = [1, 2, 3, 4, 5, 6];
        let mut malformed = malformed_original;
        assert_eq!(
            adjust_highlights_impl(&mut malformed, 25.0),
            Err(FilterError::InvalidRgbaLength { actual: 6 })
        );
        assert_eq!(malformed, malformed_original);
    }

    #[test]
    fn texture_has_a_known_fine_detail_response_and_preserves_alpha() {
        let original = [80, 100, 120, 1, 160, 150, 140, 2, 80, 100, 120, 3];
        let mut enhanced = original;
        let mut softened = original;

        adjust_texture_impl(&mut enhanced, 3, 1, 100.0).unwrap();
        adjust_texture_impl(&mut softened, 3, 1, -100.0).unwrap();

        assert_eq!(enhanced, [60, 88, 115, 1, 200, 175, 150, 2, 60, 88, 115, 3]);
        assert_eq!(
            softened,
            [100, 113, 125, 1, 120, 125, 130, 2, 100, 113, 125, 3]
        );
    }

    #[test]
    fn clarity_has_a_known_broad_midtone_response_and_preserves_alpha() {
        let original = [100, 100, 100, 5, 150, 150, 150, 17, 100, 100, 100, 231];
        let mut enhanced = original;
        let mut softened = original;

        adjust_clarity_impl(&mut enhanced, 3, 1, 100.0).unwrap();
        adjust_clarity_impl(&mut softened, 3, 1, -100.0).unwrap();

        assert_eq!(
            enhanced,
            [95, 95, 95, 5, 191, 191, 191, 17, 95, 95, 95, 231]
        );
        assert_eq!(
            softened,
            [105, 105, 105, 5, 109, 109, 109, 17, 105, 105, 105, 231]
        );
    }

    #[test]
    fn clarity_midtone_mask_protects_black_and_white() {
        let original = [0, 0, 0, 11, 255, 255, 255, 29];
        let mut pixels = original;

        adjust_clarity_impl(&mut pixels, 2, 1, 100.0).unwrap();

        assert_eq!(pixels, original);
    }

    #[test]
    fn local_detail_controls_handle_single_pixels_and_zero_as_exact_no_ops() {
        let original = [12, 34, 56, 78];

        for amount in [-100.0, 0.0, 100.0] {
            let mut texture = original;
            let mut clarity = original;

            adjust_texture_impl(&mut texture, 1, 1, amount).unwrap();
            adjust_clarity_impl(&mut clarity, 1, 1, amount).unwrap();

            assert_eq!(texture, original);
            assert_eq!(clarity, original);
        }
    }

    #[test]
    fn local_detail_controls_reject_invalid_amounts_before_mutating() {
        let original = [10, 20, 30, 40];

        for amount in [f32::NAN, f32::INFINITY, -101.0, 101.0] {
            let mut texture = original;
            assert!(matches!(
                adjust_texture_impl(&mut texture, 1, 1, amount),
                Err(FilterError::TextureOutOfRange { .. })
            ));
            assert_eq!(texture, original);

            let mut clarity = original;
            assert!(matches!(
                adjust_clarity_impl(&mut clarity, 1, 1, amount),
                Err(FilterError::ClarityOutOfRange { .. })
            ));
            assert_eq!(clarity, original);
        }
    }

    #[test]
    fn local_detail_controls_validate_dimensions_even_when_amount_is_zero() {
        let original = [10, 20, 30, 40, 50, 60, 70, 80];

        let mut malformed = [1, 2, 3, 4, 5, 6];
        assert_eq!(
            adjust_texture_impl(&mut malformed, 1, 1, 0.0),
            Err(FilterError::InvalidRgbaLength { actual: 6 })
        );

        let mut zero_dimensions = original;
        assert_eq!(
            adjust_clarity_impl(&mut zero_dimensions, 0, 2, 0.0),
            Err(FilterError::EmptyDimensions)
        );
        assert_eq!(zero_dimensions, original);

        let mut mismatched = original;
        assert_eq!(
            adjust_texture_impl(&mut mismatched, 2, 2, 0.0),
            Err(FilterError::BufferDimensionMismatch {
                expected: 16,
                actual: 8,
                width: 2,
                height: 2,
            })
        );
        assert_eq!(mismatched, original);
    }

    #[test]
    fn gaussian_radius_zero_is_a_valid_no_op() {
        let original = [10, 20, 30, 40, 200, 210, 220, 230];
        let mut pixels = original;

        gaussian_blur_impl(&mut pixels, 2, 1, 0).unwrap();

        assert_eq!(pixels, original);
    }

    #[test]
    fn gaussian_blur_preserves_constant_images_and_every_alpha_value() {
        let mut pixels = [
            50, 100, 150, 0, 50, 100, 150, 31, 50, 100, 150, 127, 50, 100, 150, 255,
        ];

        gaussian_blur_impl(&mut pixels, 2, 2, 2).unwrap();

        assert_eq!(
            pixels,
            [
                50, 100, 150, 0, 50, 100, 150, 31, 50, 100, 150, 127, 50, 100, 150, 255,
            ]
        );
    }

    #[test]
    fn gaussian_blur_has_known_symmetric_impulse_response() {
        let mut pixels = [0, 0, 0, 1, 255, 255, 255, 2, 0, 0, 0, 3];

        gaussian_blur_impl(&mut pixels, 3, 1, 1).unwrap();

        assert_eq!(pixels, [27, 27, 27, 1, 201, 201, 201, 2, 27, 27, 27, 3]);
    }

    #[test]
    fn gaussian_blur_handles_a_single_pixel() {
        let mut pixels = [12, 34, 56, 78];

        gaussian_blur_impl(&mut pixels, 1, 1, MAX_BLUR_RADIUS).unwrap();

        assert_eq!(pixels, [12, 34, 56, 78]);
    }

    #[test]
    fn gaussian_blur_rejects_excessive_radius_without_mutating() {
        let original = [10, 20, 30, 40];
        let mut pixels = original;

        let error = gaussian_blur_impl(&mut pixels, 1, 1, MAX_BLUR_RADIUS + 1).unwrap_err();

        assert_eq!(
            error,
            FilterError::BlurRadiusOutOfRange {
                radius: MAX_BLUR_RADIUS + 1
            }
        );
        assert_eq!(pixels, original);
    }

    #[test]
    fn sobel_detects_a_known_vertical_edge_and_preserves_alpha() {
        let mut pixels = [
            0, 0, 0, 1, 0, 0, 0, 2, 255, 255, 255, 3, 0, 0, 0, 4, 0, 0, 0, 5, 255, 255, 255, 6, 0,
            0, 0, 7, 0, 0, 0, 8, 255, 255, 255, 9,
        ];

        sobel_edges_impl(&mut pixels, 3, 3, 255).unwrap();

        for y in 0..3 {
            let row = y * 12;
            assert_eq!(&pixels[row..row + 3], &[0, 0, 0]);
            assert_eq!(&pixels[row + 4..row + 7], &[255, 255, 255]);
            assert_eq!(&pixels[row + 8..row + 11], &[255, 255, 255]);
        }
        assert_eq!(
            [
                pixels[3], pixels[7], pixels[11], pixels[15], pixels[19], pixels[23], pixels[27],
                pixels[31], pixels[35]
            ],
            [1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
    }

    #[test]
    fn sobel_threshold_suppresses_weak_edges() {
        let mut pixels = [0, 0, 0, 1, 0, 0, 0, 2, 10, 10, 10, 3];

        sobel_edges_impl(&mut pixels, 3, 1, 50).unwrap();

        assert_eq!(pixels, [0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3]);
    }

    #[test]
    fn sobel_handles_a_single_pixel() {
        let mut pixels = [201, 99, 3, 17];

        sobel_edges_impl(&mut pixels, 1, 1, 0).unwrap();

        assert_eq!(pixels, [0, 0, 0, 17]);
    }

    #[test]
    fn spatial_filters_reject_zero_and_mismatched_dimensions() {
        let original = [10, 20, 30, 40, 50, 60, 70, 80];

        let mut zero_dimensions = original;
        assert_eq!(
            gaussian_blur_impl(&mut zero_dimensions, 0, 2, 1),
            Err(FilterError::EmptyDimensions)
        );
        assert_eq!(zero_dimensions, original);

        let mut mismatched = original;
        assert_eq!(
            sobel_edges_impl(&mut mismatched, 2, 2, 10),
            Err(FilterError::BufferDimensionMismatch {
                expected: 16,
                actual: 8,
                width: 2,
                height: 2,
            })
        );
        assert_eq!(mismatched, original);
    }

    #[test]
    fn gaussian_kernel_is_normalized_and_symmetric() {
        let kernel = gaussian_kernel(5);

        assert!((kernel.iter().sum::<f32>() - 1.0).abs() < 1.0e-6);
        for index in 0..kernel.len() {
            assert!((kernel[index] - kernel[kernel.len() - index - 1]).abs() < f32::EPSILON);
        }
    }
}
