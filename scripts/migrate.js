#!/usr/bin/env node
/**
 * migrate.js — One-shot migration of legacy ConwayGameofLife-*.html files
 * in the repo root into outputs/, with normalized slugs, and build the
 * initial manifest.json.
 *
 * Run this once after cloning to bootstrap the bench dataset from the
 * existing per-model files.
 *
 * Mapping strategy:
 *   1. Try the model's `id` from models.json directly as the slug.
 *   2. Fall back to slugifying the filename suffix (strip ConwayGameofLife- / _
 *      prefix) and looking that up in models.json.
 *   3. Otherwise generate a slug from the filename suffix and use it as-is
 *      (this lets the bench keep files even if models.json doesn't know about
 *      them yet).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODELS_PATH = path.join(ROOT, 'models.json');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');
const MANIFEST_PATH = path.join(OUTPUTS_DIR, 'manifest.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

function readText(p) { return fs.readFileSync(p, 'utf8'); }

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// Files that should be skipped when scanning the repo root
const SKIP_FILES = new Set([
    'index.html',          // nothing here yet, but cheap insurance
]);

// Suffix-extractor: drops common ConwayGameofLife prefixes (with - or _)
function dropPrefix(name) {
    return name
        .replace(/^ConwayGameofLife[_-]/i, '')
        .replace(/^conway[_-]?game[_-]?of[_-]?life[_-]/i, '')
        .replace(/^Conway[_-]?GOL[_-]/i, '');
}

function slugify(s) {
    return String(s)
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function main() {
    const config = JSON.parse(readText(MODELS_PATH));
    const modelsById = new Map((config.models || []).map((m) => [m.id, m]));
    const idsBySlug = new Map((config.models || []).map((m) => [slugify(m.id), m.id]));

    ensureDir(OUTPUTS_DIR);

    // Collect HTML files in repo root (NOT in subdirectories like node_modules/ or outputs/)
    const files = fs.readdirSync(ROOT).filter((f) => {
        if (!f.endsWith('.html')) return false;
        if (SKIP_FILES.has(f)) return false;
        const stat = fs.statSync(path.join(ROOT, f));
        return stat.isFile();
    });

    console.log(`Found ${files.length} HTML files in repo root`);

    const now = new Date().toISOString();
    const entries = [];
    const issues = [];

    for (const f of files) {
        const suffix = dropPrefix(f.replace(/\.html$/, ''));
        const candidateSlug = slugify(suffix);

        // Try exact ID match first, then slugified match
        let id = modelsById.has(f.replace(/\.html$/, '')) ? f.replace(/\.html$/, '') : null;
        if (!id) id = idsBySlug.get(candidateSlug) || null;
        if (!id) id = suffix; // fall back: use the suffix as the id

        const slug = slugify(id);
        const outName = `${slug}.html`;
        const src = path.join(ROOT, f);
        const dst = path.join(OUTPUTS_DIR, outName);

        if (fs.existsSync(dst) && !args.includes('--force')) {
            issues.push(`⚠  ${f} → ${outName} (already exists, skipping)`);
            continue;
        }

        const content = fs.readFileSync(src, 'utf8');
        const model = modelsById.get(id);

        if (!dryRun) {
            fs.writeFileSync(dst, content, 'utf8');
            // Remove the original from the repo root
            fs.unlinkSync(src);
        }

        entries.push({
            model: id,
            displayName: (model && model.displayName) || id,
            slug,
            file: outName,
            canonicalFile: outName,
            timestamp: now,
            durationMs: null,
            contentLength: content.length,
            htmlLength: content.length,
            tokens: { prompt: null, completion: null, total: null },
            tags: (model && model.tags) || ['historical'],
            migratedFrom: f,
        });

        console.log(`  ${f} → outputs/${outName}  [${model ? 'known' : 'unknown'}]`);
    }

    if (!dryRun) {
        const manifest = {
            generated: now,
            endpoint: config.endpoint,
            entries,
        };
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
        console.log(`\n✓ wrote ${MANIFEST_PATH} with ${entries.length} entries`);
    }

    if (issues.length) {
        console.log(`\nIssues:`);
        for (const i of issues) console.log('  ' + i);
    }

    // Also remove the unrelated historical .md file if present
    const staleMd = path.join(ROOT, 'Croatian-History-Timeline-Qwen3.6-35b-a3b.md');
    if (!dryRun && fs.existsSync(staleMd)) {
        fs.unlinkSync(staleMd);
        console.log(`\n✓ removed unrelated ${path.basename(staleMd)}`);
    }
}

main();