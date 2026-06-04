#!/usr/bin/env node
// Validates every football league in the SPORTS array against API-Football.
// Fetches the FULL /leagues list ONCE via the Worker proxy (which injects the
// API key — no secret needed in CI), then validates locally. One API call, no
// rate-limit risk.
//
// Hard-fails on: unknown/dead ID, country mismatch (flag vs API), and — for
// DOMESTIC leagues only — league/cup type mismatch vs the label. International
// competitions (country "World") skip the type check. Catches the cross-country
// and league-vs-cup mislabels we fixed by hand (J2 as "Camp. de Portugal",
// Uruguay as "Venezuela", Israel cup as "Premier League", etc.).

import fs from 'fs';

const WORKER = process.env.WORKER_URL || 'https://betradar-proxy.jorge-capilupi.workers.dev';
const FILE = process.env.LINT_FILE || 'index.html';
const CUP_RE = /ta[çc]a|copa|coppa|cup|coupe|pokal|beker|supercopa|supercup|super cup/i;

const html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/const SPORTS\s*=\s*\[([\s\S]*?)\];/);
const body = m ? m[1] : html;
const re = /\{group:'soccer'[^}]*?label:'([^']*)'[^}]*?lid:(\d+)\}/g;
const entries = [];
let x;
while ((x = re.exec(body))) entries.push({ label: x[1], lid: Number(x[2]) });

function flagToISO(s) {
  const cps = [...s].filter((c) => { const cp = c.codePointAt(0); return cp >= 0x1f1e6 && cp <= 0x1f1ff; });
  if (cps.length < 2) return null;
  return cps.slice(0, 2).map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 65)).join('');
}

// Fetch the full leagues list once.
const target = encodeURIComponent('https://v3.football.api-sports.io/leagues');
const res = await fetch(`${WORKER}/?target=${target}`);
const data = await res.json();
if (!Array.isArray(data?.response) || data.response.length === 0) {
  console.error('league-lint: could not load /leagues (errors=' + JSON.stringify(data?.errors) + ', results=' + data?.results + ')');
  process.exit(2);
}
const map = new Map();
for (const it of data.response) {
  map.set(it.league.id, { name: it.league.name, type: it.league.type, country: it.country?.name, code: it.country?.code });
}
console.log(`league-lint: loaded ${map.size} leagues from API-Football; checking ${entries.length} SPORTS entries...`);

const fails = [];
for (const e of entries) {
  const api = map.get(e.lid);
  if (!api) { fails.push(`lid ${e.lid} "${e.label}": not a known API-Football league id`); continue; }
  const iso = flagToISO(e.label);
  if (iso && api.code && iso !== api.code)
    fails.push(`lid ${e.lid} "${e.label}": flag ${iso} but API says ${api.name} (${api.country}/${api.code})`);
  if (api.code && api.country !== 'World') {
    const labelCup = CUP_RE.test(e.label);
    if (labelCup && api.type === 'League') fails.push(`lid ${e.lid} "${e.label}": label looks like a cup but ${api.name} is a [League]`);
    if (!labelCup && api.type === 'Cup') fails.push(`lid ${e.lid} "${e.label}": label looks like a league but ${api.name} is a [Cup]`);
  }
}

if (fails.length) {
  console.error(`\nleague-lint: ${fails.length} problem(s)\n`);
  fails.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`league-lint: OK (${entries.length} leagues valid)`);
