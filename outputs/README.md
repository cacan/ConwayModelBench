# `outputs/` — Generated HTML files

This directory contains one HTML file per model run.

## Naming

Each model gets a **slug** (lowercase, alphanumeric + dots + dashes) derived from the model's id in `models.json`. Files are written as:

```
outputs/
├── {slug}.html                # canonical name (overwritten on re-run)
├── {slug}__2025-01-15T12-30-45__abc123.html   # dated historical snapshot
└── manifest.json              # metadata for all runs
```

The canonical name is what `screenshot.js`, `report.js`, and the `docs/index.html` reference. The dated snapshots are kept as a permanent historical record.

## Manifest

`outputs/manifest.json` looks like:

```json
{
  "generated": "2025-01-15T12:30:45.123Z",
  "endpoint": "http://192.168.31.13:1234/v1",
  "entries": [
    {
      "model": "glm-47-flash",
      "displayName": "GLM 4.7 Flash",
      "slug": "glm-47-flash",
      "file": "glm-47-flash__2025-01-15T12-30-45__a1b2c3.html",
      "canonicalFile": "glm-47-flash.html",
      "timestamp": "2025-01-15T12:30:45.123Z",
      "durationMs": 3200,
      "contentLength": 18932,
      "htmlLength": 18932,
      "tokens": { "prompt": 612, "completion": 1850, "total": 2462 },
      "tags": ["glm"]
    },
    ...
  ]
}
```

## Migrating from the legacy layout

If you have legacy `ConwayGameofLife-*.html` files in the repo root, run once:

```bash
node scripts/migrate.js
```

This moves everything into `outputs/` with normalized slugs and writes the initial manifest.