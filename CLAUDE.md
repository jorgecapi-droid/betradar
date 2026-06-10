# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BetRadar ("Tips do Dia") is a **private, personal** PWA for sports betting analysis — used only by the owner, not the public. It is the unfiltered sibling of the public **blitztips** site: same data stack, but multi-sport and without the SRIJ/compliance restrictions of the public app.

There is **no build system** — a single `index.html` with inline CSS and inline JS. Language is Portuguese (PT-PT).

## Deployment

- **Host:** Cloudflare Pages — deploy by pushing to `main`
- **No build step:** the file is deployed as-is
- **Single file:** all markup, styles and logic live in `index.html` (~8800 lines)

## Backend (not in this repo)

Same Cloudflare Worker as blitztips:
```
const WORKER_URL = 'https://betradar-proxy.jorge-capilupi.workers.dev';
```

Two ways the worker is used:
1. **Pre-computed endpoints** — `/tops`, `/analysis`, `/multiples`, `/history`, `/history/clv` (server-side scoring, same as blitztips).
2. **Generic proxy** — `apiFetch(url)` calls `WORKER_URL?target=<encoded API url>` to hit API-Sports directly. This is how BetRadar fetches sports the worker pipeline doesn't pre-compute (basketball, hockey, baseball) and on-demand detail (H2H, injuries, standings, lineups, advanced stats).

## Data sources (API-Sports)

| Const | Base | Sport |
|-------|------|-------|
| `FORM_BASE` | `v3.football.api-sports.io` | Football |
| `BBALL_BASE` | `v1.basketball.api-sports.io` | Basketball (NBA, EuroLeague) |
| `HOCKEY_BASE` | `v1.hockey.api-sports.io` | Ice hockey (NHL) |
| `BASEBALL_BASE` | `v1.baseball.api-sports.io` | Baseball (MLB) |

API keys can be stored client-side in localStorage (`br_odds_key`, `br_form_key`, `br_anthropic_key`) when the owner wants to override them. `getFormKey()` intentionally has **no hardcoded default**: API-Sports requests go through the Worker proxy, which injects the `API_FOOTBALL_KEY` Worker secret when the browser does not provide `x-apisports-key`. The Anthropic key (`br_anthropic_key`) powers the optional AI analysis (`genAI()` / `runDeepAnalysis()`) and remains user-provided.

**Security note (2026-06):** the old hardcoded API-Football key was removed from `index.html` and the key was rotated into the Worker secret. The Diagnostics panel should show `API-Football: via Worker secret` followed by `API-Football: Ultra | Activo`. If Diagnostics says "sem resposta válida" after deploy, first clear stale local keys/cache in the browser (`localStorage.removeItem('br_form_key')`, `localStorage.removeItem('br_odds_key')`, hard refresh) and verify the Worker proxy directly before re-adding any key to the client.

The `SPORTS` array (~line 1784) lists ~80 football leagues by API-Football `lid`, plus `BBALL_LEAGUES`, `HOCKEY_LEAGUES`, `BASEBALL_LEAGUES`.

## Expansion roadmap

- **Private app first.** New sports should be validated here before anything moves to the public blitztips/Worker pipeline.
- **Football Handicap 2-way is now in private validation.** BetRadar imports the worker's `tops.ah` bucket into the private picks UI and exposes it as a dedicated tab/top list. Keep it private until several settled days of `historyMarket:'ah'` are clean before opening it on blitztips.
- **Tennis and basketball are planned later.** Tennis needs explicit handling for retirements/walkovers and best-of-3/best-of-5 formats. Basketball needs a separate confidence model (pace/offense/defense/rest/injuries), not the football Dixon-Coles assumptions.
- **Country expansion should wait for structured pick identity/country config in the Worker.** Keep local labels/display flexible, but don't introduce another language/country that depends on parsing Portuguese `bet` strings.

## Data flow

1. `loadGames(forceRefresh)` — primary entry; loads cache or fetches fresh.
2. `loadWorkerAnalysis()` / worker `/tops` — pulls server-side picks and enriched analysis.
3. `extractPicks(game, sport)` — builds picks per game across markets.
4. `calcConfidence()` / `calcXG()` / `calcFairProb()` — local scoring, xG, fair-odds.
5. `fetchTeamForm` / `fetchH2H` / `fetchStandings` / `fetchAdvancedStats` / `fetchLineup` — on-demand enrichment via the proxy.
6. `renderCard(pick, index, hf, af)` — renders a pick card; `renderAll()` / `scheduleRender()` drive the UI.

A multi-layer client cache reduces API calls: `CACHE_KEY` (`betradar_cache_v32`), `BBALL_CACHE_KEY`, `FORM_CACHE_KEY`, `STATS_CACHE_KEY`, with smart expiry tied to the betting day (`smartExpiryMs`, `getBettingDayBounds`). `CALLS_SAVED_KEY` tracks calls saved.

## Markets / tabs

`top15`, `h2h` (1X2), `totals` (O/U), `btts`, `dc`, `ah` (Handicap 2-way, worker `tops.ah`), `combo` (DC+), `corners`, `ht` (Half-time). Also: Tomorrow view (`renderTomorrow`), a betslip widget (`renderWidget`/`widgetAdd`), multiples/accumulators (`generateMultiples`, `buildMultiplesFromTops`), and a history/bankroll section.

## Synced scoring block

`index.html` contains a generated block marked `SYNC scoring.mjs`; do **not** edit that block by hand. It is generated from `../betradar-worker/scoring.mjs` by:

```
node scripts/sync-scoring.mjs --apply
node scripts/sync-scoring.mjs --check
```

The block is namespaced as `window.WorkerScoring` because this client has global functions with different contracts (notably `normalizeBookmakers`, which returns bookmaker-market objects locally while the worker version returns final picks). First consumer: `fetchFriendlies` uses `window.WorkerScoring.normalizeBookmakers` through an adapter and falls back to the old local path if unavailable. The client's `calcConfidence` remains intentionally different.

## Betting history & bankroll (client-side only)

- History lives in localStorage `betradar_v2` (`loadHistory`/`saveHistory`, repaired by `repairHistory`).
- `addBet` / `updateBet` / `deleteBet` / `editBetResult` manage entries; `checkPendingResults` / `checkPendingResultsSmart` auto-settle pending bets by re-checking fixtures.
- Corner bets require API-Football `fixtures/statistics` to expose `Corner Kicks`. Many lower leagues finish with a final score but no corner statistics; when that happens for a single corner bet, auto-check marks it `void`/`Sem dados` (profit 0, not pending, excluded from winrate/ROI/acerto stats) instead of leaving it pending forever. Multiples with an unresolved corner leg remain pending because recalculating the accumulator odd after a void leg is not implemented.
- To audit which tracked football leagues actually return complete corner data, run `node scripts/corners-coverage.mjs --days=14 --sample=5`. It samples recent finished fixtures from the tracked `SPORTS` list, calls `fixtures/statistics`, classifies each league by `Corner Kicks` coverage, and writes `scripts/corners-coverage-report.json`.
- **Missing-stats handling (2026-06-08, commit `e95d7af`).** Some leagues (e.g. Botola Pro) return `/fixtures/statistics` rows with **all values `null`** even though `coverage.fixtures.statistics_fixtures` is `true` — and API-Football confirmed there is **no field that predicts** per-fixture availability. So the display must degrade honestly instead of inventing zeros:
  - `fetchAdvancedStats` **skips fixtures whose stats are all-null** (`hasRealStats`) so they don't pollute the averages with 0s; when **no** fixture for a team carries real stats it stores a sentinel `advancedStatsCache['adv_'+name] = {noData:true, games:0}` (prevents refetch + flags the render). Corner averages are computed from the games that actually carried `Corner Kicks` only; `cornersAvg`/home/away are `null` when there's no corner coverage (no longer a diluted `0`).
  - **`getAdvStats(name)`** is the single accessor that returns the entry **only when it has real data** (hides the `noData` sentinel). **Always read advanced stats through `getAdvStats`**, never `advancedStatsCache['adv_'+name]` directly, in any numeric consumer — `calcXG`, the corners component of `calcConfidence`, `genVerdict`, `advRow`/`cornersRow`/detail-view/AI-context in `renderCard`. Direct reads are only for the no-data badge (which needs to see the sentinel).
  - `renderCard` shows an honest **"📊 Sem dados de estatística para esta liga"** badge (`noStatsBadge`) when either team has the sentinel, instead of `0 rem/j · 0% posse · 0.0 cantos` and the old `calcXG` 0.3/0.2/0.5 fallback.
  - Consumers must be **null-safe on `cornersAvg`**: the worker now also sends `cornersAvg:null` for stat-less leagues (see worker `cornersGames` gating), so guard `cornersAvg != null` before formatting it.
  - Cached entries from before this change self-heal within the 6h `ADV_CACHE_KEY` (`br_adv_cache_v1`) TTL (`FORM_CACHE_TTL`); no version bump needed.
- Bankroll in `betradar_bankroll` (`BK_KEY`); `kellyStake()` suggests stakes; `renderDetailedStats` / `drawChart` / `renderProfitChart` / `renderBankrollChart` show performance.

## Key localStorage keys

| Key | Purpose |
|-----|---------|
| `betradar_cache_v32` | Main games/picks cache |
| `betradar_v2` | Betting history |
| `betradar_bankroll` | Bankroll state |
| `betradar_theme` | Theme |
| `betradar_favleagues` | Favorite leagues |
| `br_odds_key` / `br_form_key` / `br_anthropic_key` | API keys |
| `br_preferred_bk` | Preferred bookmaker |
| `br_odd_snapshots` | Odds snapshots (CLV) |

## Notes for editing

- It's one huge file — when changing logic, search for the function by name (`function <name>(`) rather than scrolling.
- This is a **private tool**, so the public-compliance rules of blitztips (age gate, SRIJ badges, "no guaranteed wins") do **not** apply here.
- Scoring logic mirrors the worker's (`calcConfidenceWorker`, Dixon-Coles). Keep client and worker definitions consistent when changing pick quality rules.
- **Scoring is aligned with the worker's `calcConfidenceWorkerV2` (since 2026-06, the `#2`/`#2b` work).** `calcConfidence` reads more of the data it already caches:
  - **Predictions** (component 8): scales `winPct` (>60→+2, >50→+1) and scores the `comparison` block (`pred.total`+`pred.attack`, already in `predCache`).
  - **Real xG** (component 6): `fetchAdvancedStats` extracts `s['expected_goals']` into `advancedStatsCache.xgRealAvg`; `calcXG` prefers it (sample ≥2) over the `shotsOn*0.3` proxy. The xG→1X2/DC extension was already present here.
  - **Lineups** (component 10): confirmed XI (`lineupCache`) + opponent depleted (`injuryCache`) → +1.
  The EV cap and market logic are unchanged. Keep this in sync with the worker if either side changes its scoring. For public football the worker's `/tops` is authoritative; the client's local `calcConfidence` drives its own computed picks (incl. the sports the worker doesn't pre-compute).
- Bump cache key versions (e.g. `betradar_cache_v32` → `v33`) when the cached data shape changes, to invalidate stale client caches.
- **International friendlies (`fetchFriendlies`, league `10`):** this league uses **calendar-year** seasons (2026 friendlies → `season=2026`), unlike domestic leagues (2025-26 → `season=2025`). The season is derived from the **Lisbon date string** (`Number(today.slice(0,4))`), and the fixtures call passes Lisbon `from`/`to` dates + `&timezone=Europe/Lisbon` (was UTC — the odd one out vs the main fetch). The function fetches real odds (`/odds?league=10` per date + Worker `/data` fallback) and runs them through `extractPicks`; odds-less games keep the `'Sem odds disponíveis'` placeholder. Returns **`null` on hard failure** (vs `[]` = genuinely no friendlies) so `loadGames` can tell a failed branch from an empty day. (Season fix `eacb72b` 2026-06-04; Lisbon/timezone + null-signal `b0b10a7` 2026-06-10.)
- **Single day reference = Lisbon betting day (2026-06-10, commit `b0b10a7`).** All dataset/date filtering goes through `inBettingDay` (06:00→06:00 Lisbon): `loadGames` cache/fresh/offline paths and `renderFiltered` (main list + Hoje/Amanhã sectioning). Never use device-local `toDateString()` for dataset decisions — it made mobile and PC show disjoint datasets. Same commit: a **degraded** load (`apiErrors>=5 || leaguesOk===0 || !friendliesOk`) backfills from the previous cache only **games entirely absent** from the fresh load (never resurrects picks/odds that left a present game); healthy loads never merge. **Friendlies are eligible for betradar's Top 15 / market tops** (private app); the public-page export (`renderTop15`→public, ~line 7670) still excludes them on purpose.
- **ALWAYS validate a `lid` against API-Football before adding/editing a `SPORTS` entry** (`/leagues?id=<id>` → check `league.name`, `country`, `league.type`). The label is just a human string — a wrong `lid` silently pulls a different competition. A 2026-06 audit of all ~83 soccer `SPORTS` entries (flag-vs-country + league/cup-type checks) found and fixed several: `lid:99` "Camp. de Portugal" was the **Japanese J2/J3** → re-mapped (Liga 3 = `865`, Taça de Portugal = `96`, Taça da Liga = `97`); `lid:269` "Venezuela" was Uruguay Segunda → `299`; `lid:384` "Israel" was the State Cup → `383`; `lid:240` "Equador" was Colombia Primera B and `lid:285` "Paraguai" was Cupa României (both relabelled to reality; correct Ecuador = `242`, Paraguay = `250`/`252`). The audit's blind spot: same-country **and** same-type swaps (e.g. a 1st division labelled as a 2nd) aren't auto-detected. **This is now enforced in CI by `scripts/league-lint.mjs`** (GitHub Action on push to `index.html`): one `/leagues` call via the Worker proxy, then country + league/cup-type checks per soccer entry. Run locally before pushing: `node scripts/league-lint.mjs`.

See also the worker repo (`betradar-worker`) and the public frontend (`blitztips`).
