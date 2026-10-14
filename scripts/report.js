#!/usr/bin/env node
/**
 * report.js — Read outputs/manifest.json, auto-detect features in each
 * generated HTML file, then emit:
 *   • REPORT.md          — Markdown summary with per-model notes
 *   • docs/index.html    — pretty sortable HTML (works on GitHub Pages)
 *
 * Usage:
 *   node scripts/report.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
const DOCS_DIR = path.join(ROOT, 'docs');
const MANIFEST_PATH = path.join(OUTPUTS_DIR, 'manifest.json');
const REPORT_PATH = path.join(ROOT, 'REPORT.md');
const INDEX_PATH = path.join(DOCS_DIR, 'index.html');
const DOCS_OUTPUTS_DIR = path.join(DOCS_DIR, 'outputs');
const DOCS_SCREENSHOTS_DIR = path.join(DOCS_DIR, 'screenshots');

// Known Conway patterns — used to detect which are referenced in the file body
const PATTERNS = [
    { name: 'glider', re: /glider/i },
    { name: 'blinker', re: /blinker/i },
    { name: 'block', re: /\bblock\b/i },
    { name: 'beacon', re: /beacon/i },
    { name: 'pulsar', re: /pulsar/i },
    { name: 'pentadecathlon', re: /pentadecathlon/i },
    { name: 'lwss', re: /\blwss\b|lightweight[-\s]?spaceship/i },
    { name: 'mwss', re: /\bmwss\b|medium[-\s]?spaceship/i },
    { name: 'hwss', re: /\bhwss\b|heavy[-\s]?spaceship/i },
    { name: 'gosper', re: /gosper|glider[-\s]?gun/i },
    { name: 'rpentomino', re: /r[-\s]?pentomino/i },
    { name: 'acorn', re: /\bacorn\b/i },
    { name: 'diehard', re: /\bdiehard\b/i },
];

function detectFeatures(html) {
    const text = (html || '').toString();

    const features = {
        // Rendering
        canvas: /<canvas[\s>]/i.test(text) || /getContext\s*\(\s*['"]2d['"]/i.test(text),
        webgl: /getContext\s*\(\s*['"]webgl/i.test(text),
        threejs: /\bTHREE\.|three\/build\/three|InstancedMesh|OrbitControls/i.test(text),
        // Wrap — the `(r + dr + rows) % rows` form, or the double-modulo
        // idiom `((n % N) + N) % N` that avoids negative remainders.
        toroidal: /\(\s*[\w.]+\s*\+\s*[\w.]+\s*\+\s*[\w.]+\s*\)\s*%\s*[\w.]+/i.test(text)
            || /\(\s*\(\s*[\w.]+\s*%\s*[\w.]+\s*\)\s*\+\s*[\w.]+\s*\)\s*%\s*[\w.]+/i.test(text),
        // Interaction
        click: /addEventListener\s*\(\s*['"]click/i.test(text) || /onclick=/i.test(text),
        mousedown: /addEventListener\s*\(\s*['"]mousedown/i.test(text),
        mousemove: /addEventListener\s*\(\s*['"]mousemove/i.test(text),
        dragPaint: /mousemove/i.test(text) && /mousedown/i.test(text) && /isDrawing/i.test(text),
        touch: /touchstart|touchmove|touchend/i.test(text),
        keyboard: /keydown|KeyboardEvent/i.test(text),
        // UI
        speedSlider: /type\s*=\s*['"]range['"]|input\[type="range"\]/i.test(text),
        patterns: PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name),
        randomize: /random/i.test(text),
        step: /\bstep\b/i.test(text),
        generationCount: /generation/i.test(text),
        populationCount: /(population|alive\s*cells|live\s*cells)/i.test(text),
        // Effects
        audio: /AudioContext|webkitAudioContext|createOscillator/i.test(text),
        particles: /\bparticle/i.test(text),
        glow: /shadowBlur|filter:\s*blur/i.test(text),
        // Persistence
        exportImport: /JSON\.stringify|Blob\(/i.test(text),
        localStorage: /localStorage/i.test(text),
        // Misc
        responsive: /@media/i.test(text),
        toast: /\btoast\b|notification/i.test(text),
        svg: /<svg[\s>]/i.test(text) && !/<canvas[\s>]/i.test(text),
    };

    features.patternCount = features.patterns.length;
    return features;
}

// ---------- quality scoring ----------
// Static, heuristic, and deliberately transparent: the rubric is one weighted
// checklist so it stays auditable and easy to retune from the aggregated
// checks. Static analysis cannot execute the code, so runtime defects
// (undefined identifiers, dead handlers) are outside its reach — this ranks
// implementations, it does not certify correctness.
const QUALITY_WEIGHTS = {
    correctness: 30,
    features: 25,
    performance: 20,
    hygiene: 15,
    polish: 10,
};

const GRADE_BANDS = [
    { min: 85, grade: 'A' },
    { min: 70, grade: 'B' },
    { min: 55, grade: 'C' },
    { min: 40, grade: 'D' },
    { min: 0, grade: 'F' },
];

function scoreQuality(html, f) {
    const t = (html || '').toString();
    if (!t.trim()) return null;

    const checks = [];
    const add = (group, label, weight, ok) => checks.push({ group, label, weight, ok: Boolean(ok) });

    // Rule correctness
    add('correctness', 'birth rule (3 neighbours)', 0.25, /===\s*3\b/i.test(t));
    add('correctness', 'survival rule (2 or 3)', 0.25,
        // "alive when 2 or 3" ...
        /===\s*2\b[\s\S]{0,60}===\s*3\b/i.test(t)
        || /===\s*3\b[\s\S]{0,60}===\s*2\b/i.test(t)
        || /\[\s*2\s*,\s*3\s*\]\s*\.includes/i.test(t)
        // ... or the equivalent complement "dies when <2 or >3".
        || /<\s*2\b[\s\S]{0,40}>\s*3\b/i.test(t)
        || />\s*3\b[\s\S]{0,40}<\s*2\b/i.test(t));
    add('correctness', '8-neighbour scan', 0.25,
        /for\s*\(\s*(?:let|var|const)\s+\w+\s*=\s*-1\s*;\s*\w+\s*<=\s*1\b/i.test(t)
        || /for\s*\(\s*(?:let|var|const)\s+\w+\s*=\s*-1\s*;\s*\w+\s*<\s*2\b/i.test(t)
        || /\[\s*-1\s*,\s*0\s*,\s*1\s*\]/.test(t)
        || /\[\s*\[?\s*-1\s*,\s*-1\s*\]/.test(t));
    add('correctness', 'double-buffered next state', 0.25,
        /\b(next|newgrid|newstate|nextgrid|next_gen|buffer|scratch)\w*\b/i.test(t)
        && /(new\s+Array|Array\.from|Uint8Array|Float32Array|\.map\()/i.test(t));

    // Feature completeness
    add('features', 'toroidal wrap', 0.25, f.toroidal);
    add('features', '3+ named patterns', 0.20, f.patternCount >= 3);
    add('features', 'keyboard control', 0.10, f.keyboard);
    add('features', 'pointer cell editing', 0.15, f.dragPaint || f.click);
    add('features', 'speed control', 0.10, f.speedSlider || /\bspeed\b|\bdelay\b/i.test(t));
    add('features', 'generation/population counter', 0.10, f.generationCount || f.populationCount);
    add('features', 'randomize/seed', 0.05, f.randomize);
    add('features', 'responsive layout', 0.05, f.responsive);

    // Rendering and loop profile
    add('performance', 'canvas/WebGL rendering', 0.35, f.canvas || f.webgl || f.threejs);
    add('performance', 'requestAnimationFrame loop', 0.30, /requestAnimationFrame/i.test(t));
    add('performance', 'no per-step DOM rebuild', 0.20, !/innerHTML\s*=\s*['"]['"]/i.test(t));
    add('performance', 'stops cleanly (clearInterval/cancelAnimationFrame)', 0.15,
        /clearInterval|cancelAnimationFrame/i.test(t));

    // Code hygiene
    add('hygiene', 'comments present', 0.20, /\/\/|\/\*/.test(t));
    add('hygiene', 'const/let, no var', 0.20, !/\bvar\s+\w/.test(t) && /\b(const|let)\s+\w/.test(t));
    add('hygiene', 'no eval / new Function', 0.15, !/\beval\s*\(|new\s+Function\s*\(/.test(t));
    add('hygiene', 'structured into functions/class', 0.20,
        (t.match(/\bfunction\b/g) || []).length >= 3 || /\bclass\s+\w/.test(t));
    add('hygiene', 'single stylesheet block', 0.15, (t.match(/<style/gi) || []).length <= 1);
    add('hygiene', 'no inline DOM handlers', 0.10, !/\son(?:click|change|input)\s*=/i.test(t));

    // Visual polish
    add('polish', 'stylesheet present', 0.20, /<style/i.test(t));
    add('polish', 'themed colours', 0.25, /background(?:-color)?\s*:/i.test(t) && /[^-]color\s*:/i.test(t));
    add('polish', 'viewport meta', 0.20, /name\s*=\s*['"]viewport['"]/i.test(t));
    add('polish', 'labelled controls', 0.20, /<(?:button|label|input)\b/i.test(t));
    add('polish', 'document title', 0.15, /<title>/i.test(t));

    const groups = {};
    for (const c of checks) {
        const g = (groups[c.group] = groups[c.group] || { earned: 0, weight: 0 });
        g.weight += c.weight;
        if (c.ok) g.earned += c.weight;
    }

    const parts = {};
    let total = 0;
    for (const [group, weight] of Object.entries(QUALITY_WEIGHTS)) {
        const g = groups[group];
        const ratio = g && g.weight ? g.earned / g.weight : 0;
        parts[group] = Math.round(ratio * 100);
        total += ratio * weight;
    }
    total = Math.round(total);

    return {
        total,
        grade: (GRADE_BANDS.find((b) => total >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1]).grade,
        parts,
        failed: checks.filter((c) => !c.ok).map((c) => c.label),
    };
}

function fmtBytes(n) {
    if (!n) return '?';
    if (n < 1024) return `${n}B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${(n / 1024 / 1024).toFixed(2)}MB`;
}

function fmtDuration(ms) {
    if (!ms && ms !== 0) return '?';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function escMd(s) {
    return String(s ?? '').replace(/\|/g, '\\|');
}

function escHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------- build report data ----------
function buildRows() {
    if (!fs.existsSync(MANIFEST_PATH)) return [];

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const rows = [];

    for (const entry of manifest.entries) {
        const filePath = path.join(OUTPUTS_DIR, entry.file);
        const html = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
        const features = detectFeatures(html);
        const lineCount = html ? html.split(/\r?\n/).length : 0;
        const screenshot = fs.existsSync(path.join(SCREENSHOTS_DIR, entry.slug + '.png'));
        const quality = scoreQuality(html, features);

        rows.push({
            ...entry,
            features,
            lineCount,
            quality,
            hasScreenshot: screenshot,
            screenshot: screenshot ? `screenshots/${entry.slug}.png` : null,
            outputRel: `outputs/${entry.file}`,
        });
    }
    return rows;
}

// ---------- Markdown ----------
function writeMarkdown(rows) {
    const total = rows.length;
    const withShot = rows.filter((r) => r.hasScreenshot).length;
    const canvasCount = rows.filter((r) => r.features.canvas).length;
    const domCount = rows.filter((r) => !r.features.canvas && !r.features.threejs && !r.features.svg).length;
    const threeCount = rows.filter((r) => r.features.threejs).length;
    const toroidalCount = rows.filter((r) => r.features.toroidal).length;
    const audioCount = rows.filter((r) => r.features.audio).length;
    const keyboardCount = rows.filter((r) => r.features.keyboard).length;
    const svgOnlyCount = rows.filter((r) => r.features.svg).length;
    const scored = rows.filter((r) => r.quality);
    const scoredCount = scored.length;
    const meanScore = scoredCount ? Math.round(scored.reduce((sum, r) => sum + r.quality.total, 0) / scoredCount) : 0;

    const lines = [];
    lines.push('# ConwayModelBench — Report');
    lines.push('');
    lines.push(`> Auto-generated by \`scripts/report.js\` on ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Models tested | **${total}** |`);
    lines.push(`| With screenshots | ${withShot} / ${total} |`);
    lines.push(`| Canvas 2D | ${canvasCount} |`);
    lines.push(`| DOM divs (slow) | ${domCount} |`);
    lines.push(`| Three.js / WebGL 3D | ${threeCount} |`);
    lines.push(`| SVG (non-Conway) | ${svgOnlyCount} |`);
    lines.push(`| Toroidal wrap | ${toroidalCount} |`);
    lines.push(`| Keyboard shortcuts | ${keyboardCount} |`);
    lines.push(`| Audio synthesis | ${audioCount} |`);
    if (scoredCount) lines.push(`| Mean quality score | ${meanScore} / 100 |`);
    lines.push('');
    lines.push('## All models');
    lines.push('');
    lines.push('| Model | Score | Arch | Wrap | Patterns | Files | Tokens |');
    lines.push('|---|---|---|---|---|---|---|');
    rows.forEach((r) => {
        const arch = r.features.threejs ? '3D' : r.features.svg ? 'SVG' : r.features.canvas ? 'Canvas' : 'DOM';
        const wrap = r.features.toroidal ? '✓' : '✗';
        const patterns = r.features.patternCount > 0 ? `${r.features.patternCount} (${r.features.patterns.slice(0, 4).join(', ')}${r.features.patterns.length > 4 ? ', …' : ''})` : '—';
        const files = r.htmlLength ? `${(r.htmlLength / 1024).toFixed(1)}KB · ${r.lineCount}L` : '—';
        const tokens = r.tokens?.total ? `${r.tokens.total}` : '—';
        const score = r.quality ? `**${r.quality.total}** (${r.quality.grade})` : '—';
        lines.push(`| [${escMd(r.displayName || r.model)}](${escMd(r.outputRel)}) | ${score} | ${arch} | ${wrap} | ${patterns} | ${files} | ${tokens} |`);
    });
    lines.push('');
    lines.push('## Quality rubric');
    lines.push('');
    lines.push('Heuristic, static score out of 100. It ranks implementations; it does not certify correctness, because static analysis cannot execute the code.');
    lines.push('');
    lines.push('| Dimension | Weight | Checks |');
    lines.push('|---|---|---|');
    lines.push('| Rule correctness | 30 | birth rule, survival rule, 8-neighbour scan, double-buffered next state |');
    lines.push('| Feature completeness | 25 | toroidal wrap, 3+ named patterns, keyboard, pointer editing, speed control, counters, randomize, responsive |');
    lines.push('| Rendering & loop profile | 20 | canvas/WebGL, requestAnimationFrame, no per-step DOM rebuild, clean stop |');
    lines.push('| Code hygiene | 15 | comments, const/let, no eval, structured functions, single stylesheet, no inline handlers |');
    lines.push('| Visual polish | 10 | stylesheet, themed colours, viewport meta, labelled controls, title |');
    lines.push('');
    lines.push('Grades: **A** ≥ 85, **B** ≥ 70, **C** ≥ 55, **D** ≥ 40, **F** below 40.');
    lines.push('');
    lines.push('## Methodology');
    lines.push('');
    lines.push(`- **Endpoint**: \`${rows[0] ? JSON.parse(fs.readFileSync(path.join(ROOT, 'models.json'), 'utf8')).endpoint : '?'}\` (LM Studio, OpenAI-compatible)`);
    lines.push(`- **Prompt**: \`prompt.md\` (the canonical spec for all models)`);
    lines.push('- **Test dates**: not reported. The historical batch was bulk-imported and shares a single timestamp and mtime, so no per-model run times exist; see `ANALYSIS.md`.');
    lines.push('- **Feature detection**: regex-based, see `scripts/report.js` → `detectFeatures()`');
    lines.push('- **Screenshots**: \`scripts/screenshot.js\` (Playwright headless Chromium, 1280×800 viewport)');
    lines.push('');
    fs.writeFileSync(REPORT_PATH, lines.join('\n'));
    console.log(`✓ wrote ${REPORT_PATH}`);
}

// ---------- HTML ----------
function writeHtml(rows) {
    const total = rows.length;
    const withShot = rows.filter((r) => r.hasScreenshot).length;
    const canvasCount = rows.filter((r) => r.features.canvas).length;
    const threeCount = rows.filter((r) => r.features.threejs).length;
    const toroidalCount = rows.filter((r) => r.features.toroidal).length;
    const audioCount = rows.filter((r) => r.features.audio).length;
    const scored = rows.filter((r) => r.quality);
    const meanScore = scored.length ? Math.round(scored.reduce((sum, r) => sum + r.quality.total, 0) / scored.length) : 0;

    const tags = Array.from(new Set(rows.flatMap((r) => r.tags || []))).sort();

    const cards = rows.map((r) => {
        const f = r.features;
        const arch = f.threejs ? '3D' : f.svg ? 'SVG' : f.canvas ? 'Canvas' : 'DOM';
        const tags = (r.tags || []).map((t) => `<span class="tag">${escHtml(t)}</span>`).join('');
        const screenshot = r.hasScreenshot
            ? `<a href="${escHtml(r.outputRel)}"><img src="${escHtml(r.screenshot)}" alt="${escHtml(r.displayName || r.model)}" loading="lazy"></a>`
            : `<a href="${escHtml(r.outputRel)}" class="no-shot">no screenshot</a>`;

        const featureBadges = [];
        if (f.toroidal) featureBadges.push('<span class="badge ok">toroidal</span>');
        if (f.keyboard) featureBadges.push('<span class="badge ok">keyboard</span>');
        if (f.dragPaint) featureBadges.push('<span class="badge ok">drag-paint</span>');
        if (f.touch) featureBadges.push('<span class="badge ok">touch</span>');
        if (f.audio) featureBadges.push('<span class="badge ok">audio</span>');
        if (f.particles) featureBadges.push('<span class="badge">particles</span>');
        if (f.exportImport) featureBadges.push('<span class="badge ok">export</span>');
        if (f.localStorage) featureBadges.push('<span class="badge ok">localStorage</span>');
        if (f.glow) featureBadges.push('<span class="badge">glow</span>');
        if (f.toast) featureBadges.push('<span class="badge">toast</span>');
        if (f.responsive) featureBadges.push('<span class="badge ok">responsive</span>');
        if (f.patternCount >= 3) featureBadges.push(`<span class="badge ok">${f.patternCount} patterns</span>`);
        else if (f.patternCount > 0) featureBadges.push(`<span class="badge">${f.patternCount} pattern${f.patternCount === 1 ? '' : 's'}</span>`);

        return `
        <article class="card" data-name="${escHtml((r.displayName || r.model).toLowerCase())}" data-size="${r.htmlLength || 0}" data-patterns="${f.patternCount}" data-arch="${arch.toLowerCase()}" data-score="${r.quality ? r.quality.total : ''}" data-grade="${r.quality ? r.quality.grade : ''}">
            <div class="thumb">${screenshot}</div>
            <div class="body">
                <h3>${escHtml(r.displayName || r.model)}</h3>
                <div class="meta">
                    <span class="arch arch-${arch.toLowerCase()}">${arch}</span>
                    ${tags}
                </div>
                <div class="badges">${featureBadges.join(' ')}</div>
                ${r.quality ? `<div class="score" title="Heuristic static score (${r.quality.parts.correctness}% correctness, ${r.quality.parts.features}% features, ${r.quality.parts.performance}% performance, ${r.quality.parts.hygiene}% hygiene, ${r.quality.parts.polish}% polish)">
                    <span class="grade grade-${r.quality.grade.toLowerCase()}">${r.quality.grade}</span>
                    <span class="score-track"><span class="score-fill grade-${r.quality.grade.toLowerCase()}" style="width:${r.quality.total}%"></span></span>
                    <span class="score-num">${r.quality.total}</span>
                </div>` : ''}
                <div class="stats">
                    <span><b>${r.htmlLength ? (r.htmlLength / 1024).toFixed(1) : '?'}KB</b> · ${r.lineCount}L</span>
                    ${r.tokens?.total ? `<span>${r.tokens.total} tok</span>` : ''}
                    ${r.durationMs ? `<span>${fmtDuration(r.durationMs)}</span>` : ''}
                </div>
            </div>
        </article>`;
    }).join('\n');

    const filterTags = tags.map((t) => `<button class="tag-btn" data-tag="${escHtml(t)}">${escHtml(t)}</button>`).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ConwayModelBench — Report</title>
<style>
  :root {
    --bg: #0b0f17;
    --panel: #131a26;
    --panel-2: #1a2333;
    --text: #e6edf6;
    --muted: #8b96a8;
    --accent: #00f3ff;
    --accent-2: #bc13fe;
    --border: rgba(255,255,255,0.08);
    --ok: #00f3ff;
    --warn: #ffb454;
    --bad: #ff4d6d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }
  header {
    padding: 40px 24px 24px;
    text-align: center;
    background: linear-gradient(180deg, #131a26 0%, var(--bg) 100%);
    border-bottom: 1px solid var(--border);
  }
  h1 {
    font-size: 2.4rem;
    margin: 0 0 8px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    letter-spacing: -1px;
  }
  header p { margin: 0; color: var(--muted); }
  .stats {
    display: flex;
    gap: 16px;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 24px;
  }
  .stat {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.9rem;
  }
  .stat b { color: var(--accent); font-size: 1.1rem; margin-right: 4px; }
  .toolbar {
    max-width: 1400px;
    margin: 24px auto;
    padding: 0 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
  }
  .sort-wrap { display: flex; align-items: center; }
  #sort {
    appearance: none;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 34px 10px 14px;
    font-size: 0.95rem;
    font-family: inherit;
    cursor: pointer;
    background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
  }
  #sort:hover { border-color: var(--accent); }
  #sort:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
  input[type="search"] {
    flex: 1;
    min-width: 220px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 1rem;
  }
  input[type="search"]:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .tag-btn {
    background: var(--panel);
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: all 0.15s;
  }
  .tag-btn:hover { color: var(--text); border-color: var(--accent); }
  .tag-btn.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .grid {
    max-width: 1400px;
    margin: 0 auto 60px;
    padding: 0 24px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 18px;
  }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    transition: transform 0.15s, border-color 0.15s;
  }
  .card:hover { transform: translateY(-2px); border-color: var(--accent); }
  .card.hidden { display: none; }
  .thumb {
    aspect-ratio: 16 / 10;
    background: #000;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
  .no-shot { color: var(--muted); font-size: 0.9rem; padding: 24px; }
  .body { padding: 14px; }
  h3 {
    font-size: 0.95rem;
    margin: 0 0 8px;
    color: var(--text);
    word-break: break-word;
  }
  .meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 8px;
  }
  .arch {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--panel-2);
    color: var(--muted);
  }
  .arch-canvas { background: rgba(0, 243, 255, 0.15); color: var(--ok); }
  .arch-3d { background: rgba(188, 19, 254, 0.15); color: var(--accent-2); }
  .arch-dom { background: rgba(255, 180, 84, 0.15); color: var(--warn); }
  .arch-svg { background: rgba(255, 77, 109, 0.15); color: var(--bad); }
  .tag {
    font-size: 0.7rem;
    color: var(--muted);
    background: var(--panel-2);
    padding: 2px 6px;
    border-radius: 4px;
  }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
  .badge {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--panel-2);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .badge.ok { color: var(--ok); border-color: rgba(0,243,255,0.3); background: rgba(0,243,255,0.08); }
  .stats { font-size: 0.75rem; color: var(--muted); display: flex; gap: 12px; }
  .score { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .score-track {
    flex: 1;
    height: 6px;
    background: #0e1622;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .score-fill { display: block; height: 100%; border-radius: 999px; background: currentColor; }
  .score-num { font-size: 0.75rem; font-variant-numeric: tabular-nums; color: var(--muted); min-width: 22px; text-align: right; }
  .grade {
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1;
    padding: 3px 6px;
    border-radius: 4px;
    border: 1px solid currentColor;
    background: rgba(255,255,255,0.04);
  }
  .grade-a { color: #3ddc84; }
  .grade-b { color: #00f3ff; }
  .grade-c { color: #ffb454; }
  .grade-d { color: #ff8a5c; }
  .grade-f { color: #ff4d6d; }
  .stats b { color: var(--text); font-weight: 600; }
  footer {
    text-align: center;
    color: var(--muted);
    padding: 40px 24px;
    border-top: 1px solid var(--border);
    font-size: 0.85rem;
  }
  footer a { color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>ConwayModelBench</h1>
  <p>${total} LLMs from LM Studio · same prompt · different architectures</p>
  <div class="stats">
    <div class="stat"><b>${total}</b>models</div>
    <div class="stat"><b>${withShot}</b>screenshots</div>
    <div class="stat"><b>${canvasCount}</b>canvas</div>
    <div class="stat"><b>${threeCount}</b>3D</div>
    <div class="stat"><b>${toroidalCount}</b>toroidal</div>
    <div class="stat"><b>${audioCount}</b>audio</div>
    <div class="stat"><b>${meanScore}</b>mean score</div>
  </div>
</header>

<div class="toolbar">
  <input type="search" id="search" placeholder="Filter by model name…" autocomplete="off">
  <div class="filters" id="filters">
    <button class="tag-btn active" data-tag="__all">all</button>
    ${filterTags}
  </div>
  <label class="sort-wrap">
    <select id="sort" aria-label="Sort models">
      <option value="score-desc">Quality: high to low</option>
      <option value="score-asc">Quality: low to high</option>
      <option value="default">As generated</option>
      <option value="size-desc">Largest file</option>
      <option value="patterns-desc">Most patterns</option>
      <option value="name-asc">Name (A-Z)</option>
    </select>
  </label>
</div>

<main class="grid" id="grid">
${cards}
</main>

<footer>
  Generated by <code>scripts/report.js</code> · ${new Date().toISOString()}
</footer>

<script>
(function () {
  const cards = Array.from(document.querySelectorAll('.card'));
  const grid = document.getElementById('grid');
  const search = document.getElementById('search');
  const sort = document.getElementById('sort');
  const filterBtns = Array.from(document.querySelectorAll('.tag-btn'));
  let activeTag = '__all';

  cards.forEach((card, index) => { card.dataset.order = String(index); });

  function metric(card, key) {
    const value = parseInt(card.dataset[key], 10);
    return Number.isFinite(value) ? value : -1;
  }

  const comparators = {
    'default': (a, b) => Number(a.dataset.order) - Number(b.dataset.order),
    'score-desc': (a, b) => metric(b, 'score') - metric(a, 'score'),
    'score-asc': (a, b) => metric(a, 'score') - metric(b, 'score'),
    'size-desc': (a, b) => metric(b, 'size') - metric(a, 'size'),
    'patterns-desc': (a, b) => metric(b, 'patterns') - metric(a, 'patterns'),
    'name-asc': (a, b) => (a.dataset.name || '').localeCompare(b.dataset.name || ''),
  };

  function applySort() {
    const compare = comparators[sort.value] || comparators['default'];
    cards.slice().sort(compare).forEach((card) => grid.appendChild(card));
  }

  function apply() {
    const q = (search.value || '').toLowerCase().trim();
    for (const card of cards) {
      const name = card.dataset.name || '';
      const tagsAttr = (card.querySelector('.meta')?.textContent || '').toLowerCase();
      const matchesQuery = !q || name.includes(q);
      const matchesTag = activeTag === '__all' || tagsAttr.includes(activeTag);
      card.classList.toggle('hidden', !(matchesQuery && matchesTag));
    }
  }

  sort.addEventListener('change', applySort);
  search.addEventListener('input', apply);
  for (const btn of filterBtns) {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.toggle('active', b === btn));
      activeTag = btn.dataset.tag;
      apply();
    });
  }

  applySort();
})();
</script>
</body>
</html>`;

    fs.writeFileSync(INDEX_PATH, html);
    console.log(`✓ wrote ${INDEX_PATH}`);
}

// ---------- main ----------
// docs/index.html references assets with paths relative to itself
// (`screenshots/<slug>.png`, `outputs/<file>`). Mirror exactly the referenced
// files next to it so the docs folder is self-contained and opens correctly
// both from file:// and when GitHub Pages serves `docs/` as the site root.
function syncDocsAssets(rows) {
    const targets = [
        {
            dir: DOCS_OUTPUTS_DIR,
            source: OUTPUTS_DIR,
            ext: '.html',
            files: rows.map((r) => r.file).filter(Boolean),
        },
        {
            dir: DOCS_SCREENSHOTS_DIR,
            source: SCREENSHOTS_DIR,
            ext: '.png',
            files: rows.filter((r) => r.hasScreenshot).map((r) => `${r.slug}.png`),
        },
    ];
    for (const { dir, source, ext, files } of targets) {
        fs.mkdirSync(dir, { recursive: true });
        const wanted = new Set(files);
        for (const name of wanted) {
            const from = path.join(source, name);
            if (!fs.existsSync(from)) continue;
            const to = path.join(dir, name);
            const current = fs.existsSync(to) ? fs.statSync(to) : null;
            const fresh = fs.statSync(from);
            if (!current || current.size !== fresh.size || current.mtimeMs < fresh.mtimeMs) {
                fs.copyFileSync(from, to);
            }
        }
        let pruned = 0;
        for (const name of fs.readdirSync(dir)) {
            // Only manage the generated asset types; leave anything else alone.
            if (wanted.has(name) || path.extname(name) !== ext) continue;
            fs.rmSync(path.join(dir, name), { force: true });
            pruned++;
        }
        const label = path.relative(ROOT, dir).split(path.sep).join('/');
        console.log(`\u2713 synced ${label} (${wanted.size} files${pruned ? `, ${pruned} pruned` : ''})`);
    }
}

function main() {
    const rows = buildRows();
    if (!rows.length) {
        console.log('No manifest entries found. Run `npm run bench` first.');
        return;
    }
    syncDocsAssets(rows);
    writeMarkdown(rows);
    writeHtml(rows);
}

main();
