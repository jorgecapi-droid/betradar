#!/usr/bin/env node
import fs from 'node:fs';

const WORKER_URL = 'https://betradar-proxy.jorge-capilupi.workers.dev';
const FORM_BASE = 'https://v3.football.api-sports.io';
const FINISHED = new Set(['FT', 'AET', 'PEN']);

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [k, v = '1'] = arg.replace(/^--/, '').split('=');
  return [k, v];
}));

const days = Math.max(1, Number(args.days || 14));
const sample = Math.max(1, Number(args.sample || 5));
const concurrency = Math.max(1, Number(args.concurrency || 4));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path) {
  const target = `${FORM_BASE}${path}`;
  const url = `${WORKER_URL}/?target=${encodeURIComponent(target)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  const json = await res.json();
  if (json?.errors && Object.keys(json.errors).length) {
    throw new Error(`API errors ${JSON.stringify(json.errors).slice(0, 180)} ${path}`);
  }
  return json;
}

function parseSports() {
  const html = fs.readFileSync('index.html', 'utf8');
  const out = [];
  const re = /\{group:'soccer',icon:'[^']*',label:'([^']+)',lid:(\d+)\}/g;
  for (const m of html.matchAll(re)) {
    out.push({ label: m[1], lid: Number(m[2]) });
  }
  const seen = new Set();
  return out.filter((x) => {
    if (seen.has(x.lid)) return false;
    seen.add(x.lid);
    return true;
  });
}

function dateLisbonMinus(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
}

function cornerCount(statsPayload) {
  const rows = statsPayload?.response || [];
  if (rows.length < 2) return { complete: false, partial: false, total: null };
  let found = 0;
  let total = 0;
  for (const team of rows) {
    const stat = (team.statistics || []).find((s) => /corner kicks/i.test(s.type || ''));
    const value = Number.parseInt(stat?.value, 10);
    if (Number.isFinite(value)) {
      found += 1;
      total += value;
    }
  }
  return { complete: found >= 2, partial: found > 0, total: found > 0 ? total : null };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function grade(row) {
  if (row.checked === 0) return 'sem amostra';
  if (row.completeRate >= 0.9 && row.checked >= Math.min(3, sample)) return 'completo';
  if (row.completeRate >= 0.6) return 'maioria';
  if (row.completeRate > 0) return 'fraco';
  return 'sem cantos';
}

function printSection(title, rows) {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log('  - nenhuma');
    return;
  }
  rows.forEach((r) => {
    const pct = r.checked ? `${Math.round(r.completeRate * 100)}%` : 'n/d';
    console.log(`  - ${r.label} (lid ${r.lid}): ${r.complete}/${r.checked} completos (${pct})`);
  });
}

async function main() {
  const leagues = parseSports();
  const byLid = new Map(leagues.map((x) => [x.lid, { ...x, fixtures: [] }]));
  console.log(`A auditar cantos: ${leagues.length} ligas, últimos ${days} dias, até ${sample} jogos/liga...`);

  for (let i = 0; i < days; i += 1) {
    const date = dateLisbonMinus(i);
    process.stdout.write(`fixtures ${date}...\r`);
    try {
      const data = await api(`/fixtures?date=${date}&timezone=Europe/Lisbon`);
      for (const f of data.response || []) {
        const lid = f.league?.id;
        if (!byLid.has(lid)) continue;
        const status = String(f.fixture?.status?.short || '').toUpperCase();
        if (!FINISHED.has(status)) continue;
        byLid.get(lid).fixtures.push(f);
      }
    } catch (e) {
      console.warn(`\nAviso: falhou fixtures ${date}: ${e.message}`);
    }
    await sleep(200);
  }
  console.log('');

  const jobs = [];
  for (const row of byLid.values()) {
    row.fixtures.sort((a, b) => new Date(b.fixture?.date || 0) - new Date(a.fixture?.date || 0));
    for (const f of row.fixtures.slice(0, sample)) {
      jobs.push({ row, fixture: f });
    }
  }

  let done = 0;
  await mapLimit(jobs, concurrency, async ({ row, fixture }) => {
    try {
      const data = await api(`/fixtures/statistics?fixture=${fixture.fixture.id}`);
      const corners = cornerCount(data);
      if (!row.audit) row.audit = [];
      row.audit.push({
        fixtureId: fixture.fixture.id,
        match: `${fixture.teams?.home?.name || '?'} vs ${fixture.teams?.away?.name || '?'}`,
        date: fixture.fixture?.date,
        complete: corners.complete,
        partial: corners.partial,
        total: corners.total,
      });
    } catch (e) {
      if (!row.audit) row.audit = [];
      row.audit.push({
        fixtureId: fixture.fixture.id,
        match: `${fixture.teams?.home?.name || '?'} vs ${fixture.teams?.away?.name || '?'}`,
        date: fixture.fixture?.date,
        complete: false,
        partial: false,
        error: e.message,
      });
    }
    done += 1;
    process.stdout.write(`estatísticas ${done}/${jobs.length}\r`);
    await sleep(150);
  });
  console.log('');

  const rows = [...byLid.values()].map((row) => {
    const audit = row.audit || [];
    const checked = audit.length;
    const complete = audit.filter((x) => x.complete).length;
    const partial = audit.filter((x) => x.partial && !x.complete).length;
    const out = {
      lid: row.lid,
      label: row.label,
      finishedFound: row.fixtures.length,
      checked,
      complete,
      partial,
      completeRate: checked ? complete / checked : 0,
      grade: null,
      samples: audit,
    };
    out.grade = grade(out);
    return out;
  }).sort((a, b) => b.completeRate - a.completeRate || b.checked - a.checked || a.label.localeCompare(b.label));

  printSection('✅ Dados completos / fiáveis', rows.filter((r) => r.grade === 'completo'));
  printSection('🟡 Maioria com cantos', rows.filter((r) => r.grade === 'maioria'));
  printSection('🟠 Fraco / irregular', rows.filter((r) => r.grade === 'fraco'));
  printSection('❌ Sem cantos na amostra', rows.filter((r) => r.grade === 'sem cantos'));
  printSection('⚪ Sem jogos terminados na amostra', rows.filter((r) => r.grade === 'sem amostra'));

  const outPath = 'scripts/corners-coverage-report.json';
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), days, sample, rows }, null, 2));
  console.log(`\nRelatório guardado em ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
