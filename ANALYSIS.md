# Cross-cutting analysis

> Curated from manually reading ~10 of the 59 historical outputs. Not auto-generated.

## Three architectural schools

| Approach | What it does | Used by | Performance |
|---|---|---|---|
| **DOM divs + CSS Grid** | One `<div>` per cell, classes flip alive/dead | `ConwayGameofLife.html` (baseline), Qwen3-distill, Qwen3.5-27b-distill-Opus, CyberLife | 🐢 Slow at 50×50+ |
| **Canvas 2D** | Single `<canvas>`, redraw each frame | GLM-4.7-Flash, Qwen3.5-4b, kat-coder, Qwen3.6-27b, Devstral-wow | 🚀 Fast |
| **Three.js / WebGL** | True 3D with InstancedMesh | Qwen3.5-35b-a3b 3D, Gemini-3.0-preview 3D | 🚀🚀 Massive |

Every "best" 2D implementation uses Canvas 2D. DOM grids cap out around 50×50 before the browser starts sweating. The 3D implementations are impressive demos but ship with bugs.

## 🥇 Best implementations

### `ConwayGameofLife-GLM-47-Flash.html` — **Top 2D overall**
725 lines. Canvas 2D with toroidal wrap, 5 patterns (glider, LWSS, pulsar, Gosper glider gun), touch support, toast notifications, responsive design. Most polished and bug-free of the bunch.

### `ConwayGameofLife-kat-coder-25-dev.html` — **Top 2D features**
566 lines. Canvas 2D with 6 named presets (glider, LWSS, pulsar, pentadecathlon, Gosper, R-pentomino), density slider (variable cell size), glow effects, keyboard shortcuts (Space/N/C/R), clean class-based architecture.

### `ConwayGameofLife-Qwen3.6-27b.html` — **Most ambitious Qwen**
536 lines. Canvas 2D with 8 patterns (adds Acorn, Diehard, R-Pentomino), zoom slider, FPS counter, cells colored by neighbor count, touch support, keyboard shortcuts. Uses a `Set` dedup trick for pulsar symmetry.

### `ConwayGameofLife-Gemini-30-preview_3d.html` — **Most ambitious overall**
618 lines. True 3D Conway via Three.js. 4 different 3D rule sets (Conway 3D 4/5/5/5, Carter Bays 5/6/6/6, Architect 4/5/2/6, Pyro 4/4/5/5), 20–40³ voxels, audio synthesis (pentatonic notes triggered by activity), population history charts (short + long term), heatmap coloring by cell age, draggable collapsible UI, audio toggle, symmetrical random seeding.

### `ConwayGameofLife-Qwen3.5-27b-distill-opus4.6-v2_ui_improved_v1.html` — **Best UI styling**
382 lines. "CyberLife" cyberpunk theme (Orbitron font, neon cyan, glassmorphism, decorative corner brackets). CSS-only effects, no external deps. Demonstrates that styling quality is independent of code complexity.

## ❌ Notable failure modes

### 🪦 `oblaci-polja-nemotron-3-nano.html` — **Doesn't even attempt Conway**
33 lines. Pure SVG of clouds, sun, mountains, river — in Croatian. The 3-nano model apparently interpreted the prompt as a static landscape image. Total hallucination.

### 🪦 `ConwayGameofLife_Taalas_ASIC_v1.html` — **Architecturally broken (132 lines)**
- CSS grid configured for **10×10 cells** but the script creates a **50×50 grid**.
- `applyRules()` modifies classes in place during iteration (no double-buffer — every step sees partially-updated state).
- Rebuilds the entire DOM with `grid.innerHTML = ''` on every step.
- A `for (let i = 0; i < 10; i++)` loop runs `applyRules` 10 times immediately, then has `setTimeout` inside that loop... tangled mess.

### 🪦 `ConwayGameofLife-Qwen3.5-4b-v1.html` — **Completely broken (291 lines)**
- Rule is inverted: `if (state === 0 && neighbors > 0) → 1` (resurrects *any* cell with neighbors, not just exactly 3).
- `createGrid` does `grid[i].push(1)` after the array is already filled with 0s — wrong shape entirely.
- Click handler: `const y = e.clientY - top` — `top` is never defined.
- `drawGrid()` ignores the y coordinate entirely.
- The 4b model is too small to produce a working implementation.

### 🪦 `ConwayGameofLife-Qwen3-distill-claude-opus-4.6-v1.html` — **Click Play = nothing happens**
The `update()` function only recurses from within itself via `requestAnimationFrame`, but nothing ever calls `update()` initially. Clicking Play sets `running=true` but the simulation never starts. The whole file is otherwise well-written — a subtle, classic single-line bug that completely kills the app.

### 🪦 `ConwayGameofLife-Qwen3.5-35b-a3b-v3-3D.html` — **3D with a `ReferenceError`**
Line 322: `y * COLOR_SPACING` — `COLOR_SPACING` is never defined. The dead-cell rendering branch will throw as soon as anything dies. Also `stepOnce()` toggles `isPlaying` twice in a row in a confused way.

### 🪦 `ConwayGameofLife-Devstral-small-2-24b-instruct-2512_wow.html` — **Two `<style>` blocks**
A duplicate `<style>` block at the bottom of `<body>` overrides the earlier buttons (purple gradient on hover), and the particle system is wired up but `isDrawing` is set on `this` in one method but read as a local in the event listener — drag-paint never works.

### 🪦 `ConwayGameofLife.html` (baseline) — **CSS commas missing**
Line 16: `linear-gradient(135deg #1a2a6c, #b21f1f)` — missing comma after `135deg`. The gradient silently fails. Line 116, 123, 128 same issue.

## Insights

**Model-size → quality correlation is strong.** The 3-nano and 4b parameter models produced broken or unrelated output; the 9b+ models produced functional code; the 27b+ models produced polished, feature-rich implementations.

**Distillation doesn't fully transfer capability.** `Qwen3-distill-claude-opus-4.6` (an older distill) shipped with a broken Play button; `Qwen3.6-35b-a3b-distill-opus-4.6` (newer, larger base) produced a polished version. The base-model quality matters even when the teacher is Opus.

**Canvas 2D is the sweet spot.** Every modern/best-rated implementation uses Canvas 2D — it handles 100×100 grids easily, unlike DOM grids. DOM grids max out around 50×50 before the browser chokes.

**3D is where ambition outruns capability.** Both 3D files have at least one non-trivial bug (the `ReferenceError` in Qwen 3D, indexing complexity in Gemini 3D). They're impressive demos, but ship with defects.

**B3/S23 vs. variations:** Almost everyone implemented vanilla Conway correctly. Only Gemini 3D offered alternative rule sets — and even then it used slightly off numbers (e.g. its "Conway 3D" is `4555` which is actually a different automaton called *Carter Bays*).

**Code length correlates poorly with quality.** Devstral's 660-line class-based version is worse than kat-coder's clean 566-line functional version. More code ≠ better code.

**The most common bug pattern: missing initial frame request.** Many implementations set up `requestAnimationFrame` recursion inside the update function but never call it once to start. Classic single-line mistake that fully breaks the simulation.

**The second most common bug: in-place mutation during neighbor count.** Without a double-buffer, the second half of the grid sees cells already updated by the first half, producing a wrong next state.

## What I look for in a "good" output

1. **Correct B3/S23 logic** with a clear double-buffer
2. **Canvas 2D** (not DOM grids)
3. **Toroidal wrap** (no edge special-casing)
4. **Speed control** that's actually controllable (not just `setInterval(..., 100)`)
5. **3+ named patterns** loadable
6. **Click and drag** to paint cells
7. **Generation + population counters**
8. **Polished styling** with reasonable color/contrast
9. **No console errors** when loaded

A model that hits all 9 is "production-quality." Most "wow" 3D demos only hit 4-5. Most small models hit 1-3.