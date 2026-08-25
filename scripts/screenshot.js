#!/usr/bin/env node
/**
 * screenshot.js — For each HTML file in outputs/, launch it in headless Chromium,
 * click the Randomize button (or equivalent), wait for the grid to populate,
 * and save a full-page screenshot to screenshots/.
 *
 * Usage:
 *   node scripts/screenshot.js                  # screenshot every output
 *   node scripts/screenshot.js --model foo      # screenshot one output
 *   node scripts/screenshot.js --force          # overwrite existing screenshots
 *   node scripts/screenshot.js --no-randomize   # just load, don't click anything
 *   node scripts/screenshot.js --wait 800       # ms to wait after randomize (default 600)
 */

const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
const MANIFEST_PATH = path.join(OUTPUTS_DIR, 'manifest.json');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const force = flag('force');
const noRandomize = flag('no-randomize');
const onlyModel = (() => {
    const i = args.indexOf('--model');
    return i >= 0 ? args[i + 1] : null;
})();
const wait = (() => {
    const i = args.indexOf('--wait');
    return i >= 0 ? parseInt(args[i + 1], 10) : 600;
})();

// Prefer the installed Playwright from this repo
const { chromium } = require('playwright');

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function readManifest() {
    if (!fs.existsSync(MANIFEST_PATH)) return { entries: [] };
    try {
        return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
        return { entries: [] };
    }
}

// Find a likely "Randomize" button by id, label, text, or class.
const RANDOMIZE_CANDIDATES = [
    '#randomBtn', '#randomize', '#btn-random', '#randomize-btn',
    '#btnRandom',
];

async function findRandomizeSelector(page) {
    // 1. Try known id selectors
    for (const sel of RANDOMIZE_CANDIDATES) {
        try {
            const el = await page.$(sel);
            if (el) return sel;
        } catch { /* selector error, skip */ }
    }
    // 2. Fall back: any button whose visible text matches /random/i (return its selector)
    return await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], [role="button"]'));
        const hit = buttons.find((b) => /random/i.test(b.textContent || b.value || ''));
        if (!hit) return null;
        // Build a unique selector
        if (hit.id) return `#${hit.id}`;
        if (hit.textContent) {
            // Use XPath by text - but Playwright supports text= selector
            return `text=/random/i`;
        }
        return null;
    });
}

async function screenshotOne(page, filePath, outPath) {
    const fileUrl = url.pathToFileURL(filePath).toString();
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(300); // let initial render settle

    if (!noRandomize) {
        const sel = await findRandomizeSelector(page);
        if (sel) {
            try {
                await page.click(sel, { timeout: 1500 });
            } catch {
                // ignore click errors
            }
        }
    }

    await page.waitForTimeout(wait);
    await page.screenshot({ path: outPath, fullPage: true });
}

async function main() {
    ensureDir(SCREENSHOTS_DIR);

    // Build worklist: prefer manifest entries; otherwise fall back to *.html in outputs/
    const manifest = readManifest();
    let work;
    if (manifest.entries.length) {
        work = manifest.entries
            .filter((e) => !onlyModel || e.model === onlyModel)
            .map((e) => ({
                model: e.model,
                displayName: e.displayName,
                file: path.join(OUTPUTS_DIR, e.file),
                png: path.join(SCREENSHOTS_DIR, e.slug + '.png'),
            }));
    } else {
        const files = fs.readdirSync(OUTPUTS_DIR).filter((f) => f.endsWith('.html'));
        work = files
            .filter((f) => !onlyModel || f.includes(onlyModel))
            .map((f) => ({
                model: f.replace(/\.html$/, ''),
                displayName: f,
                file: path.join(OUTPUTS_DIR, f),
                png: path.join(SCREENSHOTS_DIR, f.replace(/\.html$/, '.png')),
            }));
    }

    if (!work.length) {
        console.log('Nothing to screenshot.');
        return;
    }

    console.log(`▶ ${work.length} output(s) to screenshot`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    let ok = 0, skipped = 0, failed = 0;
    for (let i = 0; i < work.length; i++) {
        const w = work[i];
        const skip = !force && fs.existsSync(w.png);
        process.stdout.write(`[${i + 1}/${work.length}] ${w.displayName || w.model}  `);
        if (skip) {
            console.log('⏭ already exists');
            skipped++;
            continue;
        }
        try {
            await screenshotOne(page, w.file, w.png);
            console.log(`✓ ${path.basename(w.png)}`);
            ok++;
        } catch (e) {
            console.log(`✗ ${e.message.slice(0, 100)}`);
            failed++;
        }
    }

    await browser.close();
    console.log(`\n──── ${ok} new · ${skipped} skipped · ${failed} failed ────`);
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});