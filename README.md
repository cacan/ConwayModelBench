# ConwayModelBench

> **Same prompt. Many models. Real outputs, side-by-side.**
> A personal benchmark of LLMs served by [LM Studio](https://lmstudio.ai/), asked to implement Conway's Game of Life as a web page.

![Status](https://img.shields.io/badge/models-59-00f3ff?style=flat-square)
![Status](https://img.shields.io/badge/endpoint-LM%20Studio-blueviolet?style=flat-square)
![Status](https://img.shields.io/badge/license-MIT-green?style=flat-square)

**[📊 Live report →](docs/index.html)** · **[📋 Raw data →](REPORT.md)** · **[⚙️ Setup](#setup)** · **[🤖 Add a model](#adding-a-model)**

---

## What is this?

This repo is my **personal LLM test ground**. I take whatever models I have loaded into LM Studio and ask each one the same prompt:

> _Create Conway game of life as a web page_

That's it. No requirements. No scoring rubric. Just one sentence.

The output of every model is saved, screenshotted, and folded into a sortable comparison report. The dataset currently has **59 models** spanning Qwen, GLM, Gemini, Devstral, Nemotron, Gemma, Orinth, Kat-Coder, Taalas, and several "historical" small models, plus 3D and SVG variants.

## Headline findings

> 📌 Full per-model breakdown in **[REPORT.md](REPORT.md)** · cross-cutting analysis in **[ANALYSIS.md](ANALYSIS.md)**

The actual prompt was just one sentence. Models had to figure out everything else themselves. Here's how they split:

| Architecture | Count | Notes |
|---|---|---|
| **Canvas 2D** | 33 | The sweet spot — fast, scales to big grids |
| **Three.js 3D** | 12 | The show-offs — Gemini went full audio + rule sets + 40³ voxels |
| **DOM divs** | 15 | The old-school approach — slow at large grids but works |
| **SVG** | 1 | `2GB_qwen3-glm-distill` draws its grid with SVG instead of canvas |

And the features:
- **32 / 59** implemented toroidal wrap (no edge special-casing)
- **8 / 59** added keyboard shortcuts
- **2 / 59** did audio synthesis (both Gemini 3D variants)

### Best 2D implementations

| Model | Highlights |
|---|---|
| **GLM 4.7 Flash** | Toroidal wrap, 5 patterns (glider/LWSS/pulsar/Gosper gun), touch + toast notifications |
| **Kat Coder 2.5 Dev** | 6 presets, density slider, glow effects, keyboard shortcuts |
| **Qwen3.6 27B** | 8 patterns (incl. Acorn, Diehard, R-Pentomino), zoom slider, FPS counter |

### Most ambitious (3D)

- **Gemini 3.0 Preview 3D** — True 3D Conway with **4 rule sets** (Conway 3D, Carter Bays, Architect, Pyro), audio synthesis, population charts, draggable UI.

### Notable failures

- **Removed 2026-10-14:** both `oblaci-polja-nemotron-3-nano` entries were dropped from the dataset. One rendered a Croatian landscape and the other a non-Conway 3D scene, so neither was a comparable Conway result.
- **`ConwayGameofLife_Qwen3.5-4b-v1`** — Rule logic inverted (`neighbors > 0 → alive`), undefined `top` variable, 2D grid drawn as 1D.
- **`ConwayGameofLife_Taalas_ASIC_v1`** — 50×50 grid in a 10×10 CSS Grid, in-place mutation during iteration, DOM rebuild every step.
- **`ConwayGameofLife-Qwen3-distill-claude-opus-4.6-v1`** — Click Play = nothing happens. `requestAnimationFrame` recursion never kicks off.

## Repo structure

```
ConwayModelBench/
├── README.md           # ← you are here
├── REPORT.md           # auto-generated summary table
├── ANALYSIS.md         # curated cross-cutting insights
├── prompt.md              # the canonical shared prompt
├── models.json            # model IDs + endpoint config
├── package.json
├── LICENSE
├── scripts/
│   ├── bench.js          # POST prompt to each model → save HTML
│   ├── screenshot.js     # Playwright → PNG per output
│   ├── report.js         # Generate REPORT.md + docs/index.html
│   └── migrate.js        # one-shot migration of legacy files
├── outputs/              # generated HTMLs (one per model run)
│   ├── manifest.json     # metadata: model, timestamp, tokens, file path
│   └── *.html
├── screenshots/          # PNG captures (one per output)
└── docs/
    └── index.html        # pretty sortable HTML report (GitHub Pages-ready)
```

## Setup

### 1. Run LM Studio

1. Open LM Studio.
2. Load any model you want to test.
3. Make sure the **local server** is started (default `http://localhost:1234`).
   - If you're running this repo on a different machine, override the endpoint via env var:
     ```bash
     export LMSTUDIO_ENDPOINT="http://192.168.31.13:1234/v1"
     ```
     Or edit `models.json` directly.

### 2. Install dependencies

```bash
npm install
```

(Playwright will be installed; you may need `npx playwright install chromium` on first run.)

### 3. Migrate the existing 59 files into `outputs/` (one-time)

```bash
node scripts/migrate.js
```

It moves all `ConwayGameofLife-*.html` files from the repo root into `outputs/{slug}.html`, removes the unrelated `Croatian-History-Timeline-*.md`, and writes `outputs/manifest.json`.

### 4. Run the benchmark

```bash
# Run all models in models.json
node scripts/bench.js

# Or a subset:
node scripts/bench.js --model glm-47-flash --model kat-coder-25-dev

# Show what would happen without doing it
node scripts/bench.js --dry-run

# List configured models
node scripts/bench.js --list

# Re-run even if output already exists
node scripts/bench.js --force
```

Each model gets:
- The prompt from `prompt.md` (`"Create Conway game of life as a web page"`)
- The system prompt from `models.json`
- `temperature`, `max_tokens`, etc. from `defaultParams`

The HTML response is extracted (handles ```` ```html ```` fences, raw `<html>...</html>`, etc.) and saved as:
- `outputs/{slug}.html` — the canonical name (overwritten on re-run)
- `outputs/{slug}__{iso-date}__{hash}.html` — a dated historical snapshot

Plus an entry in `outputs/manifest.json` with timing and token usage.

### 5. Generate screenshots

```bash
node scripts/screenshot.js              # all outputs that don't have a screenshot yet
node scripts/screenshot.js --force     # overwrite existing
node scripts/screenshot.js --model foo # just one model
```

Each output is launched in headless Chromium, the Randomize button is auto-clicked, and a 1280×800 screenshot is saved to `screenshots/`.

### 6. Generate the report

```bash
node scripts/report.js
```

This writes:
- `REPORT.md` — a Markdown summary table with feature counts
- `docs/index.html` — a pretty sortable HTML report (works on GitHub Pages)

### One-shot: do it all

```bash
npm run all    # bench + screenshots + report
```

> **Heads up**: `npm run all` doesn't include `migrate.js` because that's a one-time step. Future bench runs are handled by `npm run bench`.

## Adding a model

1. Find out the model's ID as served by LM Studio. Run:
   ```bash
   curl http://localhost:1234/v1/models
   ```
   Look for the `id` field.

2. Add an entry to `models.json`:
   ```json
   { "id": "your-model-id", "displayName": "Your Model Display Name", "tags": ["family"] }
   ```

3. Run:
   ```bash
   node scripts/bench.js --model your-model-id
   node scripts/screenshot.js --model your-model-id
   node scripts/report.js
   ```

## Publishing

GitHub Pages serves the report from the root of the `gh-pages` branch. That branch is **generated** — do not edit it by hand.

[`.github/workflows/mirror-gh-pages.yml`](.github/workflows/mirror-gh-pages.yml) rewrites `gh-pages` to match `main` on every push to `main`, so the live report at [cacan.github.io/ConwayModelBench/docs/index.html](https://cacan.github.io/ConwayModelBench/docs/index.html) always tracks the latest commit. It is safe to re-run: when `gh-pages` already matches, the job exits without committing.

Because `docs/index.html` links to `screenshots/` and `outputs/` relative to itself, `node scripts/report.js` copies exactly those referenced files into `docs/screenshots/` and `docs/outputs/`. Those copies are committed so the report works both from `file://` and from the Pages root.

## The shared prompt

See [`prompt.md`](prompt.md). It's deliberately minimal:

> Create Conway game of life as a web page

No requirements list. No scoring rubric. The lack of specification is the test: **what does a model pick when you ask for "a web page" without saying how good it needs to be?**

If you want to re-run the bench with stricter requirements (e.g. "must use Canvas 2D, must have 3 named patterns, must be responsive"), edit `prompt.md` before running `node scripts/bench.js`.

## Methodology notes

- **Endpoint**: `http://192.168.31.13:1234/v1` (configurable via `LMSTUDIO_ENDPOINT`)
- **Default params**: `temperature=0.2, max_tokens=65536 (64K, effectively unbounded for this task), stream=false`
- **Feature detection**: regex-based (see `scripts/report.js` → `detectFeatures()`). It's intentionally simple and easy to audit.
- **Screenshots**: Playwright headless Chromium, 1280×800 viewport. The "Randomize" button is auto-detected (by id, label, or button text matching `/random/i`).

## Known limitations

- **Feature detection is regex-based** — it can miss things and produce false positives. The Markdown report is more conservative than the HTML one.
- **The screenshot script clicks "Randomize"**, but models with non-standard button ids (e.g. custom text without the word "random") won't get randomized. Pass `--no-randomize` if you want a clean grid.
- **The 3D models don't screenshot well** because they need user interaction (drag to rotate). The 3D screenshots are mostly just an initial frame.
- **Model IDs change** when LM Studio updates. If a model's id changes, you need to update `models.json`.

## License

MIT. See [LICENSE](LICENSE).

The HTML outputs in `outputs/` were generated by their respective models and are reproduced here for comparison. Each output's license is whatever the underlying model's terms-of-use allow.
