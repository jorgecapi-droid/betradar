#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlock, extractBlock, normalizeEol } from '../../betradar-worker/scripts/scoring-sync-block.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_SOURCE = path.resolve(repoRoot, '..', 'betradar-worker', 'scoring.mjs');
const DEFAULT_HTML = path.resolve(repoRoot, 'index.html');

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function resolveInputPath(value, fallback) {
  if (!value) return fallback;
  return path.resolve(process.cwd(), value);
}

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--check') ? 'check' : null;
if (!mode) {
  console.error('Usage: node scripts/sync-scoring.mjs --apply|--check [--source ../betradar-worker/scoring.mjs] [--html index.html]');
  process.exit(2);
}

const sourcePath = resolveInputPath(argValue('--source', null), DEFAULT_SOURCE);
const htmlPath = resolveInputPath(argValue('--html', null), DEFAULT_HTML);

function dominantEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

function replaceOrInsertBlock(html, block) {
  const existing = extractBlock(html);
  if (existing) return html.replace(existing, block);
  const anchor = '// ── EXTRACT PICKS';
  const pos = html.indexOf(anchor);
  if (pos < 0) throw new Error(`Cannot find insertion anchor: ${anchor}`);
  return `${html.slice(0, pos)}${block}\n\n${html.slice(pos)}`;
}

const source = fs.readFileSync(sourcePath, 'utf8');
const generated = buildBlock(source);
const html = fs.readFileSync(htmlPath, 'utf8');
const existing = extractBlock(html);

if (mode === 'check') {
  if (!existing) {
    console.error(`Missing scoring sync block in ${htmlPath}. Run: node scripts/sync-scoring.mjs --apply`);
    process.exit(1);
  }
  if (normalizeEol(existing).trim() !== normalizeEol(generated).trim()) {
    console.error('scoring.mjs sync block is stale. Run: node scripts/sync-scoring.mjs --apply');
    process.exit(1);
  }
  console.log('scoring.mjs sync block is up to date');
  process.exit(0);
}

const eol = dominantEol(html);
const next = replaceOrInsertBlock(normalizeEol(html), generated).replace(/\n/g, eol);
fs.writeFileSync(htmlPath, next, 'utf8');
console.log(`Updated scoring sync block in ${path.relative(process.cwd(), htmlPath)}`);
