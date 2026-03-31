import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const trackedOutputs = [
  path.join(root, "themes", "vscode-2026-port-theme.json"),
  path.join(root, "generated", "vscode", "2026-dark.resolved.json"),
  path.join(root, "generated", "vscode", "2026-light.resolved.json")
];

function runGenerate() {
  const result = spawnSync("node", [path.join(root, "scripts", "generate.mjs")], {
    cwd: root,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error(`generate.mjs failed with exit code ${result.status}`);
  }
}

async function fingerprint() {
  const map = {};

  for (const filePath of trackedOutputs) {
    const content = await readFile(filePath);
    map[path.relative(root, filePath).replace(/\\/g, "/")] = createHash("sha256")
      .update(content)
      .digest("hex");
  }

  return map;
}

runGenerate();
const first = await fingerprint();
runGenerate();
const second = await fingerprint();

if (JSON.stringify(first) !== JSON.stringify(second)) {
  throw new Error("Generation is not deterministic for tracked outputs.");
}

console.log("Deterministic generation verified.");
