#!/usr/bin/env node
/**
 * bench.js — Send the canonical Conway's Game of Life prompt to each model
 * listed in models.json against an LM Studio (OpenAI-compatible) endpoint,
 * and save the resulting HTML to outputs/.
 *
 * Usage:
 *   node scripts/bench.js                       # run all models in models.json
 *   node scripts/bench.js --model foo --model bar  # run subset
 *   node scripts/bench.js --force               # overwrite existing outputs
 *   node scripts/bench.js --list                # list models and exit
 *   node scripts/bench.js --dry-run             # show what would happen
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const MODELS_PATH = path.join(ROOT, 'models.json');
const PROMPT_PATH = path.join(ROOT, 'prompt.md');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const MANIFEST_PATH = path.join(OUTPUTS_DIR, 'manifest.json');

// ---------- CLI args ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const flags = {
    list: flag('list'),
    dryRun: flag('dry-run'),
    force: flag('force'),
};
const onlyModels = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
        onlyModels.push(args[++i]);
    }
}

// ---------- helpers ----------
function readText(p) {
    return fs.readFileSync(p, 'utf8');
}

function slugify(s) {
    return String(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function shortHash(s, n = 6) {
    return crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
}

function extractHtml(text) {
    if (!text) return null;

    const looksLikeHtml = (s) => /<html[\s>]/i.test(s) || /<!doctype\s+html/i.test(s);

    // 1. Fenced blocks. Models often emit prose plus several fences, and the
    //    first fence is not necessarily the page. Prefer the fence that is a
    //    full HTML document; otherwise stitch every fence together, since
    //    markup and script are sometimes split across separate blocks.
    const fences = [...text.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
    if (fences.length) {
        const htmlFence = fences.find((m) => looksLikeHtml(m[2]));
        const stitched = fences.map((m) => m[2].trim()).filter(Boolean).join('\n');
        if (htmlFence) {
            const candidate = htmlFence[2].trim();
            if (/<\/html>/i.test(candidate)) return candidate;
            if (/<\/html>/i.test(stitched)) return stitched;
            return candidate;
        }
        if (looksLikeHtml(stitched)) return stitched;
        return fences[0][2].trim();
    }

    // 2. <!DOCTYPE html ... </html>
    const docMatch = text.match(/(<!DOCTYPE[\s\S]*?<html[\s\S]*?<\/html>)/i);
    if (docMatch) return docMatch[1].trim();

    // 3. <html ... </html>
    const htmlMatch = text.match(/(<html[\s\S]*?<\/html>)/i);
    if (htmlMatch) return htmlMatch[1].trim();

    return null;
}

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function loadManifest() {
    if (!fs.existsSync(MANIFEST_PATH)) return { entries: [] };
    try {
        return JSON.parse(readText(MANIFEST_PATH));
    } catch {
        return { entries: [] };
    }
}

function saveManifest(m) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

async function callLmStudio(endpoint, model, systemPrompt, userPrompt, params) {
    const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;
    const body = {
        model,
        messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: userPrompt },
        ],
        ...params,
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    return await res.json();
}

function fmtDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

async function listAvailableModels(endpoint) {
    try {
        const res = await fetch(`${endpoint.replace(/\/+$/, '')}/models`);
        if (!res.ok) return [];
        const j = await res.json();
        return (j.data || []).map((m) => m.id);
    } catch {
        return [];
    }
}

// ---------- main ----------
async function main() {
    const config = JSON.parse(readText(MODELS_PATH));
    const endpoint = config.endpoint || process.env.LMSTUDIO_ENDPOINT || 'http://localhost:1234/v1';
    const defaultParams = config.defaultParams || {};
    const systemPrompt = config.systemPrompt || '';
    const models = config.models || [];

    let modelsToRun = models;
    if (onlyModels.length) {
        modelsToRun = models.filter((m) => onlyModels.includes(m.id));
        if (!modelsToRun.length) {
            console.error(`❌ No models matched: ${onlyModels.join(', ')}`);
            console.error(`Available IDs:`);
            for (const m of models) console.error(`  - ${m.id}`);
            process.exit(1);
        }
    }

    if (flags.list) {
        console.log('Configured models:');
        for (const m of models) {
            console.log(`  ${m.id.padEnd(50)}  ${m.displayName || ''}`);
        }
        console.log(`\nEndpoint: ${endpoint}`);
        console.log(`Default params: ${JSON.stringify(defaultParams)}`);
        return;
    }

    const userPrompt = readText(PROMPT_PATH);
    ensureDir(OUTPUTS_DIR);
    const manifest = loadManifest();
    const existing = new Map(manifest.entries.map((e) => [e.model, e]));

    console.log(`▶ Endpoint: ${endpoint}`);
    console.log(`▶ Models to run: ${modelsToRun.length}`);

    if (flags.dryRun) {
        for (const m of modelsToRun) {
            const slug = slugify(m.id);
            console.log(`  → ${slug} (${m.displayName || m.id})`);
        }
        return;
    }

    // Connectivity check
    console.log('  Probing /v1/models ...');
    const available = await listAvailableModels(endpoint);
    if (available.length) {
        console.log(`  Found ${available.length} models served by LM Studio`);
    } else {
        console.log(`  ⚠️  Could not reach ${endpoint}/models — make sure LM Studio is running.`);
    }

    const results = [];
    for (let i = 0; i < modelsToRun.length; i++) {
        const m = modelsToRun[i];
        const slug = slugify(m.id);
        const outputFile = `${slug}.html`;

        if (!flags.force && existing.has(m.id) && fs.existsSync(path.join(OUTPUTS_DIR, existing.get(m.id).file))) {
            console.log(`\n[${i + 1}/${modelsToRun.length}] ${m.displayName || m.id}`);
            console.log(`  ⏭  already exists (${existing.get(m.id).file}), use --force to overwrite`);
            results.push({ model: m.id, status: 'skipped', entry: existing.get(m.id) });
            continue;
        }

        console.log(`\n[${i + 1}/${modelsToRun.length}] ${m.displayName || m.id}`);
        console.log(`  → POST ${endpoint}/chat/completions (model=${m.id})`);

        const t0 = Date.now();
        let response;
        try {
            response = await callLmStudio(endpoint, m.id, systemPrompt, userPrompt, defaultParams);
        } catch (e) {
            console.log(`  ✗ ${e.message}`);
            results.push({ model: m.id, status: 'error', error: e.message });
            continue;
        }
        const elapsed = Date.now() - t0;

        const choice = response.choices?.[0];
        const content = choice?.message?.content || '';
        const usage = response.usage || {};

        const html = extractHtml(content);
        if (!html) {
            console.log(`  ✗ could not extract HTML from response (${content.length} chars returned)`);
            results.push({ model: m.id, status: 'extract-failed', contentLength: content.length });
            continue;
        }

        const isoDate = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const hash = shortHash(html + m.id + isoDate);
        const datedFile = `${slug}__${isoDate}__${hash}.html`;
        const datedPath = path.join(OUTPUTS_DIR, datedFile);

        fs.writeFileSync(datedPath, html, 'utf8');
        // Stable canonical filename (overwritten on re-run with --force)
        fs.writeFileSync(path.join(OUTPUTS_DIR, outputFile), html, 'utf8');

        const entry = {
            model: m.id,
            displayName: m.displayName || m.id,
            slug,
            file: datedFile,
            canonicalFile: outputFile,
            timestamp: new Date().toISOString(),
            durationMs: elapsed,
            contentLength: content.length,
            htmlLength: html.length,
            tokens: {
                prompt: usage.prompt_tokens || null,
                completion: usage.completion_tokens || null,
                total: usage.total_tokens || null,
            },
            tags: m.tags || [],
        };

        // Replace previous entry for this model
        const idx = manifest.entries.findIndex((e) => e.model === m.id);
        if (idx >= 0) manifest.entries[idx] = entry;
        else manifest.entries.push(entry);
        saveManifest(manifest);

        console.log(`  ✓ saved ${datedFile} (${fmtDuration(elapsed)}, ${html.length} chars, ${usage.total_tokens || '?'} tok)`);
        results.push({ model: m.id, status: 'ok', entry });
    }

    const ok = results.filter((r) => r.status === 'ok').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const failed = results.length - ok - skipped;
    console.log(`\n──── ${ok} ok · ${skipped} skipped · ${failed} failed ────`);
    if (failed > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
