import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "extension.toml");

const content = await readFile(manifestPath, "utf8");
const match = content.match(/^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m);

if (!match) {
  throw new Error("Could not find version in extension.toml");
}

const major = Number(match[1]);
const minor = Number(match[2]);
const patch = Number(match[3]) + 1;
const nextVersion = `${major}.${minor}.${patch}`;

const updated = content.replace(match[0], `version = "${nextVersion}"`);
await writeFile(manifestPath, updated, "utf8");
console.log(`Bumped extension version to ${nextVersion}`);
