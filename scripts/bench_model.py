#!/usr/bin/env python3
"""Automated ConwayModelBench runner for testing a model, capturing screenshots, and compiling reports."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_ENDPOINT = "http://192.168.31.13:1234/v1"


def verify_workspace(root: Path) -> None:
    if not (root / "models.json").is_file() or not (root / "scripts" / "bench.js").is_file():
        sys.exit(f"Error: bench-conway must be run inside ConwayModelBench workspace. Not found at {root}")


def check_lmstudio_model(endpoint: str, model_id: str) -> bool:
    url = endpoint.rstrip("/") + "/models"
    req = Request(url, headers={"User-Agent": "ConwayModelBench/0.1"})
    try:
        with urlopen(req, timeout=5) as resp:
            data = json.load(resp)
            available = [m.get("id") for m in data.get("data", [])]
            return model_id in available
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        print(f"Warning: Could not query LM Studio endpoint {url}: {exc}")
        return False


def append_model_entry(text: str, entry: dict) -> str:
    """Append one model entry while preserving the file's existing layout.

    models.json is hand-formatted with one aligned line per model, so
    re-serialising the whole document via json.dumps would rewrite every line
    and bury the real change in formatting churn. Only the new entry line is
    inserted.
    """
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.split(newline)
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == '"models": [')
        end = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == "]")
    except StopIteration:
        data = json.loads(text)
        data.setdefault("models", []).append(entry)
        return json.dumps(data, indent=2, ensure_ascii=False) + newline

    # The previous final entry loses its "last element" status, so it needs a comma.
    if end - 1 > start and not lines[end - 1].rstrip().endswith(","):
        lines[end - 1] = lines[end - 1].rstrip() + ","

    new_line = (
        f'    {{ "id": {json.dumps(entry["id"])}, '
        f'"displayName": {json.dumps(entry["displayName"])}, '
        f'"tags": {json.dumps(entry["tags"])} }}'
    )
    lines.insert(end, new_line)
    return newline.join(lines)


def ensure_model_registered(root: Path, model_id: str, display_name: str | None, tags: list[str]) -> None:
    models_file = root / "models.json"
    text = models_file.read_text(encoding="utf-8")
    if any(m.get("id") == model_id for m in json.loads(text).get("models", [])):
        return  # Already registered

    clean_name = display_name or model_id.split("/")[-1].replace("-", " ").title()
    models_file.write_text(
        append_model_entry(text, {"id": model_id, "displayName": clean_name, "tags": tags or []}),
        encoding="utf-8",
    )
    print(f"Registered new model in models.json: {clean_name} ({model_id})")


def run_node_step(root: Path, script: str, model_id: str, force: bool, env: dict[str, str]) -> None:
    cmd = ["node", str(root / "scripts" / script), "--model", model_id]
    if force:
        cmd.append("--force")
    print(f"Executing: {' '.join(cmd)}")
    res = subprocess.run(cmd, cwd=root, env=env, check=False)
    if res.returncode != 0:
        sys.exit(f"Error: {script} failed with exit code {res.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Conway's Game of Life benchmark on a specified model")
    parser.add_argument("--model-id", required=True, help="LM Studio model ID")
    parser.add_argument("--endpoint", default=os.getenv("LMSTUDIO_ENDPOINT", DEFAULT_ENDPOINT), help="LM Studio base URL")
    parser.add_argument("--display-name", help="Friendly model display name")
    parser.add_argument("--tags", nargs="*", default=[], help="Model family / architecture tags")
    parser.add_argument("--force", action="store_true", help="Force re-run even if outputs exist")
    parser.add_argument("--skip-model-check", action="store_true", help="Skip checking LM Studio /models endpoint")

    args = parser.parse_args()
    workspace_root = Path.cwd().resolve()
    verify_workspace(workspace_root)

    print(f"=== ConwayModelBench Runner ===")
    print(f"Workspace: {workspace_root}")
    print(f"Model ID:  {args.model_id}")
    print(f"Endpoint:  {args.endpoint}")

    if not args.skip_model_check:
        loaded = check_lmstudio_model(args.endpoint, args.model_id)
        if not loaded:
            print(f"Warning: Model '{args.model_id}' was not reported as loaded by {args.endpoint}.")
            print("Proceeding anyway assuming LM Studio or proxy handles model routing...")

    ensure_model_registered(workspace_root, args.model_id, args.display_name, args.tags)

    env = dict(os.environ)
    env["LMSTUDIO_ENDPOINT"] = args.endpoint

    # 1. Benchmark generation
    print("\n[Step 1/3] Generating Conway implementation via LM Studio...")
    run_node_step(workspace_root, "bench.js", args.model_id, args.force, env)

    # 2. Screenshot capture
    print("\n[Step 2/3] Capturing Playwright visual screenshot...")
    run_node_step(workspace_root, "screenshot.js", args.model_id, args.force, env)

    # 3. Report compilation
    print("\n[Step 3/3] Compiling REPORT.md and docs/index.html...")
    rep_cmd = ["node", str(workspace_root / "scripts" / "report.js")]
    res = subprocess.run(rep_cmd, cwd=workspace_root, env=env, check=False)
    if res.returncode != 0:
        sys.exit(f"Error: report.js failed with exit code {res.returncode}")

    print("\n=== Benchmark Complete ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
