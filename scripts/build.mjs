#!/usr/bin/env node
/**
 * Build script for qexow-bridge.exe using Node.js built-in SEA.
 * Replaces the broken `pkg` approach.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

fs.mkdirSync(DIST, { recursive: true });

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: ROOT, ...opts });
  if (result.status !== 0) {
    console.error(`Command failed: ${cmd}`);
    process.exit(result.status || 1);
  }
}

// ── Step 1: Bundle with esbuild into a single CJS file ───────────────────────
console.log("\n[BUILD] Step 1: Bundling broker with esbuild...");
run(`npx esbuild antigravity-broker.js --bundle --platform=node --format=cjs --outfile=dist/broker-bundle.cjs --external:fsevents`);

// ── Step 2: Write SEA config ──────────────────────────────────────────────────
console.log("\n[BUILD] Step 2: Writing SEA config...");
const seaConfig = {
  main: path.join(DIST, "broker-bundle.cjs"),
  output: path.join(DIST, "broker-sea.blob"),
  disableExperimentalSEAWarning: true,
};
fs.writeFileSync(path.join(DIST, "sea-config.json"), JSON.stringify(seaConfig, null, 2));

// ── Step 3: Generate SEA blob ─────────────────────────────────────────────────
console.log("\n[BUILD] Step 3: Generating SEA blob...");
run(`node --experimental-sea-config dist/sea-config.json`);

// ── Step 4: Copy node.exe to bridge-core exe ──────────────────────────────────────
console.log("\n[BUILD] Step 4: Copying node.exe -> dist/bridge-core.exe...");
const nodeExe = process.execPath;
const coreExe = path.join(DIST, "bridge-core.exe");
fs.copyFileSync(nodeExe, coreExe);

// ── Step 5: Inject blob via postject ─────────────────────────────────────────
console.log("\n[BUILD] Step 5: Injecting blob into bridge-core.exe via postject...");
run(`npx postject dist/bridge-core.exe NODE_SEA_BLOB dist/broker-sea.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite`);

// ── Step 6: Compile qexow-bridge.exe via csc.exe ──────────────────────────────────────────────
console.log("\n[BUILD] Step 6: Compiling qexow-bridge.exe via native C# compiler with resources...");
const cscPath = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
if (fs.existsSync(cscPath)) {
  run(`"${cscPath}" /target:winexe /out:dist\\qexow-bridge.exe /resource:dist\\bridge-core.exe src\\tray\\BridgeTray.cs`);
} else {
  console.warn("[BUILD] WARNING: csc.exe not found, skipping qexow-bridge.exe compilation.");
}

// Clean up all dist files except qexow-bridge.exe
console.log("\n[BUILD] Step 7: Cleaning up dist directory...");
for (const file of fs.readdirSync(DIST)) {
  if (file !== "qexow-bridge.exe") {
    try {
      fs.rmSync(path.join(DIST, file), { recursive: true, force: true });
    } catch (e) {
      console.warn(`[BUILD] Could not delete ${file}: ${e.message}`);
    }
  }
}

console.log("\n[BUILD] ✅ Build complete! Outputs:");
console.log(`  dist/qexow-bridge.exe`);
