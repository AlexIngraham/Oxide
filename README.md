# Oxide Lab

Browser image-processing workbench comparing **equivalent TypeScript and
Rust/WebAssembly** implementations.

Nine filters. Same source pixels. Automatic benchmarking. Pixel-level output
validation. No backend — images never leave the browser.

**Live demo:** [https://oxide-pied.vercel.app/](https://oxide-pied.vercel.app/)

![Oxide Lab workbench showing a Clarity adjustment, before-and-after reveal, and automatic Rust/WASM versus TypeScript benchmark](docs/oxide-lab-demo.webp)

<sub>Screenshot: Clarity +35 on an Apple M4 Pro / Chrome session — 41.30&nbsp;ms
Rust/WASM vs 55.80&nbsp;ms TypeScript (1.35×). The reference table below
aggregates four independent comparisons, so its Clarity row differs.</sub>

## Why I built it

WebAssembly is often pitched as “faster than JavaScript.” In practice that
depends on the workload and on boundary costs. Oxide implements the same
image-processing algorithms in both environments and measures them under the
same conditions.

On the reference M4 Pro run, WASM was **1.27–1.73× faster** for Clarity,
Gaussian blur, Sobel, and Brightness, while TypeScript won several simpler
operations. The app reports what *this* browser measured — it does not hard-code
a “Rust is faster” claim.

## Highlights

- Rust/WASM + TypeScript implementations of nine filters
- Persistent Web Worker so preview/benchmark work does not lock the UI
- Automatic warm-up + median benchmarking with alternating engine order
- Pixel-level cross-engine validation (±1 channel tolerance)
- Transferable image buffers between main thread and worker
- 27 Rust tests + 173 Node/WASM cases/subtests
- CI builds Rust → WASM, denies Clippy warnings, and verifies generated artifacts

## Architecture

Oxide applies **one selected operation at a time**, always from an immutable
decoded source (not a cumulative stack).

```text
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
       └───────────────┬────────────────┘
                       ▼
       Agreement + timing → Canvas → PNG
```

Deeper notes on workers, allocation, blur separability, and deployment headers
live in [docs/engineering.md](docs/engineering.md).

## Benchmark results

Actual production-worker results for the built-in **1536 × 1024** sample
(~1.57 MP) on an **Apple M4 Pro**, macOS 27, Chrome 151. Four independent
automatic comparisons per row; each time is the median of those medians.

Lower time is better.

| Filter and parameter | Rust/WASM | TypeScript | Relative result |
|---|---:|---:|---|
| Grayscale | 3.60 ms | 2.80 ms | TypeScript 1.29× |
| Brightness +20 | 1.50 ms | 2.60 ms | WASM 1.73× |
| Contrast +25 | 7.55 ms | 3.70 ms | TypeScript 2.04× |
| Saturation +35% | 8.85 ms | 5.05 ms | TypeScript 1.75× |
| Highlights +35 | 11.65 ms | 6.25 ms | TypeScript 1.86× |
| Texture +35 | 21.10 ms | 20.45 ms | Near tie (~1.03× TS) |
| Clarity +35 | 42.85 ms | 54.50 ms | WASM 1.27× |
| Gaussian blur, r=4 | 44.75 ms | 60.45 ms | WASM 1.35× |
| Sobel edges, thr=80 | 17.15 ms | 29.40 ms | WASM 1.71× |

**Methodology (short):** warm-ups then measured runs; engine order alternates;
buffers reset from an immutable source *outside* the timer; reported time is
the median; WASM timing includes wasm-bindgen copies; decode, Canvas I/O, and
worker messaging are excluded; ≤3% difference is a tie. Full protocol:
[docs/engineering.md](docs/engineering.md#benchmark-methodology).

**Output agreement:** brightness/contrast/saturation/highlights/texture were
byte-identical in the reference run; grayscale/clarity/blur stayed within ±1
channel; Sobel can diverge near its hard threshold because of `f32` vs JS
`Number` rounding.

## Filters

| Filter | Parameter |
|---|---|
| Grayscale | Fixed |
| Brightness / Contrast / Saturation / Highlights / Texture / Clarity | −100…+100 (saturation as %) |
| Gaussian blur | Radius 0–16 px |
| Sobel edges | Threshold 0–255 |

Both engines share coefficients, kernels, edge behavior, ranges, and rounding
intent. RGB is mutated; alpha is preserved. Algorithm detail:
[docs/engineering.md](docs/engineering.md#filters-and-parameters).

## Testing

- **27 Rust unit tests** — fixtures, alpha, malformed buffers, extrema, spatial filters
- **173 Node/WASM cases/subtests** — generated module + TypeScript filters + benchmark protocol + cross-engine agreement
- **GitHub Actions** — rustfmt, Clippy (`-D warnings`), Rust tests, fresh
  `wasm-pack` build, committed-artifact drift check, Oxlint, Node tests,
  TypeScript check, Vite production build

```bash
cd rust-engine && cargo test --all-features
cd ../web && npm ci && npm run check
```

## Tech stack

| Area | Technology |
|---|---|
| Engine | Rust → WebAssembly (wasm-bindgen / wasm-pack) |
| Frontend | React 19, TypeScript, Vite |
| Runtime | Serialized module Web Worker, Canvas 2D, transferable buffers |
| Quality | rustfmt, Clippy, Oxlint, Node test runner, GitHub Actions |
| Hosting | Vercel static (`web/dist`); no server, secrets, or image upload API |

## Run locally

Node **22.12+** and npm are enough for a fresh clone (WASM package is
committed). Rust + wasm-pack are only needed when changing the engine.

```bash
cd web
npm ci
npm run dev
```

Open the Vite URL (usually http://localhost:5173). After Rust changes:

```bash
cd web
npm run build:wasm   # commit the regenerated web/src/wasm artifacts
```

Production: `npm run build && npm run preview` from `web/`.

## Limitations and future work

**Now:** single-threaded worker; large spatial jobs still take real time;
uploads capped/resized (~30 MB / 6 MP); wasm-bindgen copies on every call;
Sobel threshold can amplify tiny float differences; no session persistence.

**Later:** reusable WASM linear-memory API with kernel-only timing; portable
SIMD after profiling; optional threaded WASM (and its COOP/COEP tradeoffs);
cross-browser performance baselines.

## License

MIT — see [LICENSE](LICENSE).

---

Engineering reference (methodology, memory decisions, deployment headers,
repo layout): [docs/engineering.md](docs/engineering.md).
