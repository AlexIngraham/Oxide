# Oxide Lab

Oxide Lab is a browser image-processing workbench with equivalent filters
written in TypeScript and Rust compiled to WebAssembly. It runs both engines
against the same source pixels, measures their browser execution time, checks
their output agreement, and lets the user inspect or download either result.

Uploaded images are decoded and processed in memory in the current browser
tab. The application has no image-upload endpoint, backend, account, database,
or persistent storage.

**Live demo:** [https://oxide-pied.vercel.app/](https://oxide-pied.vercel.app/)

![Oxide Lab workbench showing a Clarity adjustment, before-and-after reveal, and automatic Rust/WASM versus TypeScript benchmark](docs/oxide-lab-demo.webp)

<sub>The current 1440 × 1400 screenshot captures one automatic Clarity +35
comparison: 41.30 ms for Rust/WASM, 55.80 ms for TypeScript, and a 1.35× WASM
advantage. The reference table below aggregates four independent comparisons,
so its Clarity result is intentionally different.</sub>

## What the product does

- Loads a built-in 1536 × 1024 sample immediately, with no setup or account.
- Accepts browser-supported images through drag-and-drop or a file picker.
- Runs nine equivalent TypeScript and Rust/WASM filters.
- Provides a synchronized slider and typed numeric input for every adjustable
  parameter, including exact boundary and zero values.
- Renders a fast WASM preview after an edit, then automatically refreshes the
  full TypeScript-versus-WASM comparison when input settles.
- Keeps preview and benchmark work off the main thread in a persistent module
  worker so controls, scrolling, and the reveal remain responsive.
- Reports median execution time, throughput in megapixels per second, relative
  performance, resolution, sample count, and pixel agreement.
- Provides a draggable original/processed reveal and a switch between the
  current TypeScript and WASM outputs.
- Preserves alpha, validates malformed buffers and dimensions, and bounds the
  working canvas by resizing decoded images above its safety limits.
- Downloads the currently selected engine result as a PNG.
- Includes responsive layouts, keyboard-accessible controls, loading and empty
  states, and visible error recovery.

## Filters and parameters

Both engines use the same coefficients, kernels, edge behavior, parameter
ranges, and rounding intent. Every operation modifies RGB while preserving the
source alpha channel.

| Filter | Work performed | UI parameter |
|---|---|---|
| Grayscale | Rec. 601 luminance: `0.299R + 0.587G + 0.114B` | Fixed |
| Brightness | Adds a clamped offset to every RGB channel | −100 to +100; default +20 |
| Contrast | Expands or compresses values around 128 with the standard contrast-factor formula | −100 to +100; default +25 |
| Saturation | Moves each channel toward or away from perceptual luminance | −100% to +100%; default +35% |
| Highlights | Applies an offset through a smooth luminance mask that begins above mid-gray and strengthens toward white | −100 to +100; default 0 |
| Texture | Adds or suppresses a fine-detail high-pass derived from a clamped-edge 3 × 3 binomial blur | −100 to +100; default 0 |
| Clarity | Adjusts broader local contrast from a clamped-edge 9 × 9 mean, weighted toward midtones to protect deep shadows and highlights | −100 to +100; default 0 |
| Gaussian blur | Runs normalized horizontal and vertical Gaussian passes with clamped edge sampling | Radius 0–16 px; default 4 px |
| Sobel edges | Computes 3 × 3 Sobel gradient magnitude with an adjustable threshold | Threshold 0–255; default 80 |

Highlights is tonal rather than global brightness. Texture targets fine local
structure. Clarity operates at a broader radius and fades its effect toward
the luminance extremes. They are separate algorithms, not alternate labels
for contrast.

Radius zero and the zero-valued tonal/detail controls are validated no-ops.
The Rust blur API accepts radii through 64 for direct callers; the UI caps the
range at 16 to keep interaction practical on full-size images.

## Why Rust and WebAssembly

This project treats Rust/WASM as a measurable browser execution target, not as
an assumption that WebAssembly must always be faster. Pixel kernels suit
contiguous typed-array data, explicit numeric operations, and predictable
memory access. At the same time, crossing the WebAssembly boundary has a real
cost, and modern JavaScript engines optimize tight loops well.

The measured results reflect that tradeoff: Rust/WASM leads on some filters,
TypeScript leads on others, and some comparisons are effectively noise. The
application reports the current device's result without a hard-coded
performance claim.

## Processing model

Oxide Lab deliberately applies **one selected operation at a time**. It is not
a cumulative multi-filter stack.

Each filter or parameter change is recomputed from the immutable decoded
source, never from the previous processed canvas. This keeps editing
non-destructive, avoids accidental compounding or progressive degradation, and
preserves a clear per-algorithm interpretation for the benchmark.

~~~text
Built-in sample or local image
            │
            ▼
Browser decode → Canvas → ImageData (RGBA)
            │
            ▼
 Immutable source retained on main thread
            │
       selected filter + parameter
            │
   transferable job-owned source buffer
            ▼
Persistent serialized processing worker
       ┌───────────────┴────────────────┐
       │                                │
 90 ms preview debounce          450 ms benchmark debounce
       │                                │
 Rust/WASM preview           reusable TS and WASM buffers
       │                     reset from the same source
       │                                │
       └───────────────┬────────────────┘
                       ▼
       transferred current output/results
                       │
                       ▼
          Agreement + timing → Canvas → PNG
~~~

The worker serializes processing requests. Rapid edits restart the debounce
timers; if an older job is already active, its worker is terminated so it
cannot publish a stale result. An idle worker is reused throughout edits to
one image, retaining its WASM instance and warmed runtime state. After a
replacement image decodes successfully, the old worker is retired to release
its WASM memory before work begins on the new source.

The 90 ms preview always uses Rust/WASM. After 450 ms without another edit,
the worker runs the full comparison and returns both engine outputs. The
preview toggle and PNG download then operate on those current results.

## Benchmark methodology

The benchmark is intended to be understandable and defensible rather than a
substitute for a dedicated benchmarking laboratory:

1. Point filters on images up to 4 MP receive two untimed warm-up runs per
   engine and seven measured runs per engine.
2. Spatial filters—Texture, Clarity, Gaussian blur, and Sobel—or any image over
   4 MP receive one warm-up and three measured runs per engine to bound job
   duration.
3. TypeScript and WASM order alternates during both warm-up and measured runs.
   Successive comparisons also rotate which engine starts first.
4. The benchmark allocates two working pixel buffers once. Before every engine
   call, the appropriate buffer is reset from the worker's immutable source
   outside `performance.now()` timing.
5. The reported time is the median, not the fastest sample. Throughput is
   derived from image megapixels divided by median seconds.
6. TypeScript timing includes the kernel and any scratch allocations made by
   that operation.
7. WASM timing includes wasm-bindgen allocation, copy into linear memory, Rust
   processing and scratch allocation, and copy back to JavaScript.
8. Image decoding, the initial `getImageData`, source transfer, worker
   messaging and initialization, Canvas rendering, and PNG encoding are
   excluded for both engines.
9. Results within 3% are labeled a tie. Very short operations below the
   browser timer's useful precision are identified instead of being presented
   as a reliable winner.
10. The final buffers are compared after timing. A ±1 channel tolerance
    accounts for Rust `f32` versus JavaScript `Number` rounding.

Scheduling, JIT state, thermal conditions, hardware, browser version, image
content, and parameter values still affect a runtime result. Automatic
comparisons describe the current browser session; they are not stable,
machine-independent scores.

### Reference results

These are actual production-worker results for the built-in 1536 × 1024 image
(1,572,864 pixels / 1.57 MP) on an Apple M4 Pro running macOS 27 and Chrome
151. Four independent automatic comparisons were recorded for every row, with
the starting engine alternated. Each time is the median of the four displayed
medians; each displayed median was itself produced by the adaptive protocol
above.

Lower time is better.

| Filter and parameter | Rust/WASM median | TypeScript median | Relative result |
|---|---:|---:|---|
| Grayscale | 3.60 ms | 2.80 ms | TypeScript 1.29× faster |
| Brightness +20 | 1.50 ms | 2.60 ms | WASM 1.73× faster |
| Contrast +25 | 7.55 ms | 3.70 ms | TypeScript 2.04× faster |
| Saturation +35% | 8.85 ms | 5.05 ms | TypeScript 1.75× faster |
| Highlights +35 | 11.65 ms | 6.25 ms | TypeScript 1.86× faster |
| Texture +35 | 21.10 ms | 20.45 ms | TypeScript 1.03× faster; practical near tie |
| Clarity +35 | 42.85 ms | 54.50 ms | WASM 1.27× faster |
| Gaussian blur, radius 4 px | 44.75 ms | 60.45 ms | WASM 1.35× faster |
| Sobel edges, threshold 80 | 17.15 ms | 29.40 ms | WASM 1.71× faster |

Texture's aggregate difference is 3.08%, technically just outside the configured
3% tie threshold. It is still practically near-tied at this measurement scale
and should not be treated as evidence of a meaningful advantage. A different
browser, machine, image, power state, or parameter can change every time and
winner in the table.

### Output agreement in the reference run

Performance results are only useful when both engines perform equivalent work:

| Filters | Observed agreement |
|---|---|
| Brightness, contrast, saturation, highlights, texture | Exact byte-for-byte output |
| Grayscale, clarity, Gaussian blur | Maximum channel delta 1; no channel outside the ±1 tolerance |
| Sobel, threshold 80 | Maximum channel delta 80; 34 of 1,572,864 pixels outside tolerance |

The Sobel exceptions occur at the hard threshold. A small Rust `f32` versus
JavaScript `Number` magnitude difference can put one engine just below the
threshold and the other just above it, amplifying a sub-byte calculation
difference into a visible branch difference. Both implementations otherwise
use the same luminance coefficients, 3 × 3 kernels, clamped boundary sampling,
and threshold rule. Both preserve alpha.

## Performance and memory decisions

### Image and worker data flow

- The browser decodes and calls `getImageData` once per successful image. The
  direct ImageData buffer is retained as the immutable source instead of
  creating a redundant permanent source copy.
- Each worker request receives a job-owned source buffer through transferable
  ownership. Preview and benchmark results transfer back rather than being
  cloned by structured serialization.
- The benchmark reuses two full-size engine buffers across all warm-up and
  measured iterations, resetting them outside the timer instead of allocating
  a new output buffer for every iteration.
- Normal Canvas drawing wraps the transferred `Uint8ClampedArray` in
  `ImageData` without another typed-array copy.
- A successful replacement image terminates the prior worker, releasing its
  WebAssembly linear memory and queued state.

These changes reduce avoidable copying and allocation, but no before/after
speedup is claimed because that allocation work was not measured as a separate
controlled experiment.

### Separable Gaussian blur

A direct two-dimensional Gaussian convolution evaluates a square kernel for
each pixel, so work grows as O(r²) with radius. A Gaussian kernel is separable:
one horizontal pass followed by one vertical pass reduces convolution work to
O(r) taps per pass.

Both engines use that separable method, build the same normalized `2r + 1`
kernel, and clamp samples to the nearest edge pixel. The Rust intermediate
stores RGB only, leaving alpha in the original RGBA buffer. The earlier naive
implementation was not retained or benchmarked, so this project does not
claim a measured naive-to-separable speedup.

### Other engine decisions

- Texture uses separable 3 × 3 binomial passes; Clarity uses separable
  horizontal and vertical 9-tap mean passes for its broader neighborhood.
- Sobel luminance is calculated once per source pixel rather than once for
  every neighboring kernel sample.
- Spatial operations validate dimensions with checked multiplication before
  allocating or mutating output.
- Rust release builds use optimization level 3, link-time optimization, one
  code-generation unit, stripped symbols, and aborting panics.
- The optional wasm-opt post-pass remains disabled because the binary bundled
  with some wasm-pack releases cannot parse instructions emitted by the pinned
  Rust compiler. LLVM release optimization remains enabled.
- The generated release module is 60,165 bytes uncompressed and 23.87 kB gzip
  in the current Vite production build.

## Testing and adversarial QA

The automated suite contains:

- **27 Rust unit tests** covering deterministic fixtures, alpha preservation,
  tiny and malformed buffers, dimension mismatches, parameter extremes and
  non-finite values, blur and Sobel boundaries, and the Highlights, Texture,
  and Clarity algorithms.
- **173 Node/WASM test cases and subtests** that instantiate the generated WASM
  module, exercise all nine TypeScript filters, validate benchmark protocol
  behavior, and compare both engines across deterministic fixtures, image
  shapes, defaults, zeroes, extrema, and malformed inputs.

The final browser QA pass also covered:

- a transparent 1 × 1 PNG and a JPEG;
- overlapping uploads and successful replacement after prior edits;
- empty, invalid, unsupported, and blocked-sample recovery paths;
- 4096 × 1 and 1 × 4096 images;
- safety resizing from 5000 × 3000 to 3162 × 1897;
- rapid parameter and filter switching, plus Reset during active work;
- touch interaction at a 390 px viewport and exact reveal-divider alignment;
- current-result PNG download;
- 11 object URLs created and all 11 revoked under instrumentation; and
- production WASM MIME loading and module-worker execution under the deployed
  Content Security Policy.

GitHub Actions runs Rust formatting, Clippy with warnings denied, Rust tests,
a fresh wasm-pack build, committed-artifact drift detection, frontend install,
linting, all Node/WASM tests, TypeScript checking, and the Vite production
build. The workflow uses current `actions/checkout@v7` and
`actions/setup-node@v7` actions.

Run the equivalent checks locally:

~~~bash
cd rust-engine
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
cargo check --target wasm32-unknown-unknown --release

cd ../web
npm ci
npm run build:wasm
npm run check
~~~

`npm run check` verifies the committed WASM package, runs Oxlint and all Node
tests, typechecks the TypeScript projects, builds the Vite production bundle,
and validates its emitted assets.

## Tech stack

| Area | Technology |
|---|---|
| Processing engine | Rust 2024 edition |
| Browser bridge | WebAssembly, wasm-bindgen, wasm-pack 0.15 |
| Frontend | React 19, TypeScript 6, Vite 8 |
| Processing runtime | Serialized module Web Worker |
| Pixel IO | Canvas 2D, ImageData, typed arrays, transferable buffers |
| Tests | Rust test framework, Node test runner, browser adversarial QA |
| Quality | rustfmt, Clippy, Oxlint, TypeScript project references |
| CI and deployment | GitHub Actions, Vercel static hosting |

No runtime image-processing library, component kit, state-management library,
backend framework, or database is used.

## Repository layout

~~~text
.
├── rust-engine/
│   ├── Cargo.toml
│   └── src/lib.rs                  # Rust filters, validation, and unit tests
├── web/
│   ├── public/
│   │   └── sample-studio.webp      # Built-in sample image
│   ├── scripts/
│   │   ├── build-wasm.mjs          # Pinned wasm-pack build + manifest writer
│   │   ├── verify-wasm.mjs         # Source/artifact integrity preflight
│   │   ├── verify-dist.mjs         # Production asset and WASM validation
│   │   └── wasm-artifacts.mjs      # Shared deterministic hashing inputs
│   ├── src/
│   │   ├── engine/
│   │   │   ├── filters.ts          # Equivalent TypeScript filters
│   │   │   ├── benchmark.ts        # Timing, statistics, and agreement
│   │   │   └── wasm.ts             # Shared WASM initialization/dispatch
│   │   ├── wasm/                   # Committed wasm-pack output + manifest
│   │   ├── App.tsx                 # UI, image lifecycle, worker orchestration
│   │   ├── ParameterControl.tsx    # Synchronized slider/number input
│   │   ├── processing.worker.ts    # Serialized preview/benchmark runtime
│   │   └── processingProtocol.ts   # Typed transferable worker messages
│   └── tests/engine.test.ts        # TypeScript/WASM conformance tests
├── docs/
│   └── oxide-lab-demo.webp         # Current 1440 × 1400 product screenshot
├── .github/workflows/ci.yml
└── vercel.json
~~~

## Prerequisites

- Node.js 22.12.0 or newer. The repository includes `.node-version`; the root
  package also selects the Node 22 release line for Vercel.
- npm 11.2.0, recorded as the package manager.
- Rust 1.95.0 with `rustfmt`, `clippy`, and the `wasm32-unknown-unknown`
  target when changing or verifying the Rust engine.
- wasm-pack 0.15.0 when regenerating the committed WASM package.

The generated WASM package is intentionally committed. A fresh clone needs
only Node and npm to run or deploy the frontend; Rust and wasm-pack are needed
only when the engine changes or the generated package is being verified.

## Run locally

~~~bash
cd web
npm ci
npm run dev
~~~

Open the URL printed by Vite, normally <http://localhost:5173>. The built-in
sample loads and schedules its comparison automatically.

### Rebuild WebAssembly after Rust changes

Install the pinned tool once if needed:

~~~bash
cargo install wasm-pack --version 0.15.0 --locked
rustup target add wasm32-unknown-unknown
~~~

Then regenerate the browser package:

~~~bash
cd web
npm run build:wasm
~~~

The script writes the JavaScript/TypeScript bindings and binary to
`web/src/wasm`, removes wasm-pack's catch-all ignore file, and records a
deterministic manifest of the Rust/build inputs and generated artifact hashes.
That output should be committed with the Rust change.

### Production build and preview

~~~bash
cd web
npm run build
npm run preview
~~~

The prebuild check rejects missing, modified, or stale committed WASM. Vite
writes static output to `web/dist`; the postbuild check verifies the hashed
WASM asset, exact emitted bytes, JavaScript reference, and required public
assets before preview or deployment.

## Deployment

The repository is configured for a Vercel project whose root is the repository
root. `vercel.json` executes exactly:

~~~text
Install: npm --prefix web ci
Build:   npm --prefix web run build
Output:  web/dist
~~~

There are no required environment variables, server functions, storage
services, or application secrets. Import the repository into Vercel with the
root directory unchanged, or run `vercel --prod` from the repository root
after authenticating the Vercel CLI. The committed WASM package means the
deployment builder needs Node only; the preflight prevents deployment from a
Rust revision whose generated package is stale.

Vercel serves `.wasm` as `application/wasm`. Content-hashed files under
`/assets/` receive a one-year immutable cache policy, while HTML and the
unversioned sample retain revalidation behavior. Deployment headers include:

- `script-src 'self' 'wasm-unsafe-eval'` for WebAssembly compilation;
- `worker-src 'self'` for the emitted same-origin module worker;
- `img-src 'self' blob: data:` for local uploads and Canvas workflows;
- `X-Content-Type-Options: nosniff`; and
- restrictive frame, referrer, permissions, object, base, and form policies.

The Vite build target is frozen to Chrome/Edge 111, Firefox 114, and Safari
16.4 rather than moving silently when Vite changes its default baseline. No
`SharedArrayBuffer`, COOP/COEP headers, or client-side route rewrite is needed
for the current single-threaded worker architecture.

For another static host, serve the contents of `web/dist`, preserve
`application/wasm` for `.wasm`, and reproduce the CSP allowances above. The
production base is `/`; a deployment under a URL subdirectory must set Vite's
`base` accordingly before building.

## Built-in sample

The bundled sample is a 1536 × 1024 WebP of approximately 223 KiB. It was
generated as a self-contained demonstration asset and optimized for the
repository. Its provenance is unrelated to runtime behavior: Oxide Lab has no
AI feature, model request, or image-upload service.

## Known limitations

- Processing uses one persistent, single-threaded worker. This keeps the UI
  responsive, but a large spatial job still takes real time and a superseded
  active job must be terminated rather than cooperatively interrupted.
- Six-megapixel spatial operations can have substantial peak memory use across
  the retained source, transferable job buffer, two benchmark outputs,
  algorithm scratch space, returned results, and WASM linear memory.
- Uploads are limited to 30 MB and resized to at most 6 megapixels and 4096
  pixels on either axis. Browser decoding happens before that resize, so a
  highly compressed image with extreme source dimensions can still consume
  significant memory or fail during decode.
- Animated image uploads process the browser-decoded first frame only.
- wasm-bindgen allocates and copies the pixel buffer into and out of WASM on
  every engine call.
- Timing varies with JIT state, browser version, scheduling, system load,
  temperature, power mode, image content, and parameters.
- Rust `f32` and JavaScript `Number` rounding are usually exact or within one
  channel value, but Sobel's hard threshold can amplify a near-boundary
  difference.
- Downloads are PNG only, regardless of source format.
- Images, settings, and benchmark history are not persisted across sessions.
- The checked-in Vite base targets a root deployment; subdirectory hosts need
  an explicit base-path build.

## Future work

- Prototype an explicit WASM-memory API that reuses linear-memory allocations
  and separately exposes kernel-only versus boundary-inclusive timing.
- Evaluate portable WebAssembly SIMD after profiling confirms useful
  vectorization targets.
- Investigate threaded WASM alongside its `SharedArrayBuffer`, COOP/COEP,
  browser-support, worker-pool, and deployment tradeoffs.
- Add repeatable cross-browser performance regression baselines without
  presenting one machine's measurements as universal.

## License

Oxide Lab is available under the MIT License. See [LICENSE](LICENSE).
