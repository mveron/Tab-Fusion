import { mkdir, rm, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");
const releaseDir = resolve(rootDir, "release");
const zipPath = resolve(releaseDir, "tab-fusion.zip");

async function main() {
  await mkdir(releaseDir, { recursive: true });
  await rm(zipPath, { force: true });

  await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${distDir}\\*' -DestinationPath '${zipPath}' -Force`,
  ]);

  const latestPath = resolve(rootDir, "tab_fusion.zip");
  await copyFile(zipPath, latestPath);
  console.log(`Packaged extension at ${zipPath}`);
}

void main();
