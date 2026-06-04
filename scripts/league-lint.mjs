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

// Division-tier extraction (PT/EN/ES/IT/DE/FR). Returns the set of numeric tiers
// (2,3,4) a competition name signals; empty = top flight or a cup (no tier word).
// This is what closes part of the "same country + same type" blind spot: a 2nd
// division mislabelled as a 1st (or vice-versa) shows up as disjoint tier sets.
// It does NOT catch same-tier swaps (e.g. Taça de Portugal vs Taça da Liga) —
// those still need the human eyeball on the printed name table below.
const ORDINAL = {
  segunda: 2, segon: 2, second: 2, seconde: 2, seconda: 2, zweite: 2, deuxieme: 2, dos: 2,
  terceira: 3, tercera: 3, third: 3, terza: 3, dritte: 3, troisieme: 3, tres: 3,
  quarta: 4, cuarta: 4, fourth: 4, vierte: 4, quatrieme: 4,
};
function tierOf(text) {
  const t = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tiers = new Set();
  for (const mm of t.matchAll(/\b([2-4])\b/g)) tiers.add(Number(mm[1])); // "2", "2.", "Ligue 2"
  if (/\biii\b/.test(t)) tiers.add(3);
  else if (/\biv\b/.test(t)) tiers.add(4);
  else if (/\bii\b/.test(t)) tiers.add(2);
  for (const [w, n] of Object.entries(ORDINAL)) if (new RegExp(`\\b${w}`).test(t)) tiers.add(n);
  return tiers;
}

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
const resolved = [];
for (const e of entries) {
  const api = map.get(e.lid);
  if (!api) { fails.push(`lid ${e.lid} "${e.label}": not a known API-Football league id`); continue; }
  resolved.push({ lid: e.lid, label: e.label, api });
  const iso = flagToISO(e.label);
  if (iso && api.code && iso !== api.code)
    fails.push(`lid ${e.lid} "${e.label}": flag ${iso} but API says ${api.name} (${api.country}/${api.code})`);
  if (api.code && api.country !== 'World') {
    const labelCup = CUP_RE.test(e.label);
    if (labelCup && api.type === 'League') fails.push(`lid ${e.lid} "${e.label}": label looks like a cup but ${api.name} is a [League]`);
    if (!labelCup && api.type === 'Cup') fails.push(`lid ${e.lid} "${e.label}": label looks like a league but ${api.name} is a [Cup]`);
    // Division-tier consistency — catches a 1st division mislabelled as a 2nd/3rd
    // (or vice-versa) within the same country+type, which the checks above miss.
    const lt = tierOf(e.label), at = tierOf(api.name);
    if (lt.size && at.size && ![...lt].some((n) => at.has(n)))
      fails.push(`lid ${e.lid} "${e.label}": label is tier ${[...lt].join('/')} but ${api.name} is tier ${[...at].join('/')}`);
    else if (lt.size && !at.size)
      fails.push(`lid ${e.lid} "${e.label}": label is tier ${[...lt].join('/')} but ${api.name} reads as a top flight`);
    else if (at.size && !lt.size)
      fails.push(`lid ${e.lid} "${e.label}": label gives no tier but ${api.name} is tier ${[...at].join('/')} (lower division?)`);
  }
}

if (fails.length) {
  console.error(`\nleague-lint: ${fails.length} problem(s)\n`);
  fails.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}

// Print the resolved name table so a human can eyeball same-tier swaps (e.g. one
// cup mislabelled as another in the same country) that no heuristic can catch.
console.log('\nResolved leagues (eyeball for same-tier same-country swaps):');
for (const r of resolved.sort((a, b) => a.lid - b.lid))
  console.log(`  ${String(r.lid).padStart(4)}  ${r.label.replace(/[^\x20-\x7e]/g, '').trim().padEnd(28)} → ${r.api.name} [${r.api.type}] (${r.api.country})`);
console.log(`\nleague-lint: OK (${entries.length} leagues valid)`);
