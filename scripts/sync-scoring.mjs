#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const START = '// ⇩ SYNC scoring.mjs (canónico: betradar-worker/scoring.mjs) ⇩';
const END = '// ⇧ SYNC scoring.mjs ⇧';
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

function normalizeEol(s) {
  return String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function dominantEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}

function extractExports(source) {
  const names = [];
  source.replace(/^export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/gm, (_, name) => {
    names.push(name);
    return _;
  });
  source.replace(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=/gm, (_, name) => {
    names.push(name);
    return _;
  });
  const unique = [...new Set(names)];
  if (!unique.length) throw new Error('No named exports found in scoring.mjs');
  return unique;
}

function stripExports(source) {
  return source
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+let\s+/gm, 'let ')
    .replace(/^export\s+var\s+/gm, 'var ')
    .replace(/^export\s+class\s+/gm, 'class ')
    .replace(/^export\s+default\s+/gm, '');
}

function buildBlock(source) {
  const normalized = normalizeEol(source).trimEnd();
  const names = extractExports(normalized);
  const body = stripExports(normalized)
    .split('\n')
    .map(line => line ? `  ${line}` : '')
    .join('\n');
  const returned = names.map(name => `    ${name},`).join('\n');
  return [
    START,
    'window.WorkerScoring = (() => {',
    body,
    '',
    '  return Object.freeze({',
    returned,
    '  });',
    '})();',
    END,
  ].join('\n');
}

function extractBlock(html) {
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start < 0 || end < 0 || end < start) return null;
  return html.slice(start, end + END.length);
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
