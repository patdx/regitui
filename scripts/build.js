#!/usr/bin/env node
/*
 * Copy the browser host (core + wrapper + HTML) into ./dist as separate files.
 * No bundler — open dist/index.html via any static file server.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const files = ["core.js", "browser.js", "index.html"];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const name of files) {
  const src = path.join(root, name);
  if (!fs.existsSync(src)) {
    console.error(`build: missing ${name}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(dist, name));
}

console.log(`built ${files.length} files → ${path.relative(root, dist)}/`);
for (const name of files) console.log(`  ${name}`);
