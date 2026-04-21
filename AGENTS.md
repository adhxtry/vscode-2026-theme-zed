# AGENTS.md

## Developer Commands
- `npm run generate` — fetch upstream, resolve includes, merge, write all outputs
- `npm run verify` — run `generate` twice, compare SHA-256 hashes of `themes/` and `generated/` outputs; fails if non-deterministic
- `npm run bump:patch` — increment patch in `extension.toml` only

## Generated Outputs (do not edit manually)
- `themes/vscode-2026-port-theme.json` — Zed theme (main extension file)
- `generated/vscode/2026-dark.resolved.json`
- `generated/vscode/2026-light.resolved.json`
- `metadata/upstream-sources.json` — provenance: URL and SHA256 per fetched file

## CI Flow
`.github/workflows/update-themes.yml` (workflow_dispatch + weekly Monday 06:00 UTC):
1. `npm run generate`
2. If `git diff --quiet`, stop (no PR)
3. `npm run bump:patch` then create PR

## Architecture
- Entrypoint: `scripts/generate.mjs` (all theme resolution and VS Code→Zed scope mapping)
- `extension.toml` is the Zed manifest — NOT `package.json` (package.json is minimal, only holds scripts)
- Single ESM package, no workspaces
- Upstream is live `main` branch — `generate` output changes when VS Code updates