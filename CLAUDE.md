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

API keys are stored client-side in localStorage (`br_odds_key`, `br_form_key`, `br_anthropic_key`) — `getFormKey()` has a hardcoded default. The Anthropic key (`br_anthropic_key`) powers the optional AI analysis (`genAI()` / `runDeepAnalysis()`).

The `SPORTS` array (~line 1784) lists ~80 football leagues by API-Football `lid`, plus `BBALL_LEAGUES`, `HOCKEY_LEAGUES`, `BASEBALL_LEAGUES`.

## Data flow

1. `loadGames(forceRefresh)` — primary entry; loads cache or fetches fresh.
2. `loadWorkerAnalysis()` / worker `/tops` — pulls server-side picks and enriched analysis.
3. `extractPicks(game, sport)` — builds picks per game across markets.
4. `calcConfidence()` / `calcXG()` / `calcFairProb()` — local scoring, xG, fair-odds.
5. `fetchTeamForm` / `fetchH2H` / `fetchStandings` / `fetchAdvancedStats` / `fetchLineup` — on-demand enrichment via the proxy.
6. `renderCard(pick, index, hf, af)` — renders a pick card; `renderAll()` / `scheduleRender()` drive the UI.

A multi-layer client cache reduces API calls: `CACHE_KEY` (`betradar_cache_v32`), `BBALL_CACHE_KEY`, `FORM_CACHE_KEY`, `STATS_CACHE_KEY`, with smart expiry tied to the betting day (`smartExpiryMs`, `getBettingDayBounds`). `CALLS_SAVED_KEY` tracks calls saved.

## Markets / tabs

`top15`, `h2h` (1X2), `totals` (O/U), `btts`, `combo` (DC+), `corners`, `ht` (Half-time). Also: Tomorrow view (`renderTomorrow`), a betslip widget (`renderWidget`/`widgetAdd`), multiples/accumulators (`generateMultiples`, `buildMultiplesFromTops`), and a history/bankroll section.

## Betting history & bankroll (client-side only)

- History lives in localStorage `betradar_v2` (`loadHistory`/`saveHistory`, repaired by `repairHistory`).
- `addBet` / `updateBet` / `deleteBet` / `editBetResult` manage entries; `checkPendingResults` / `checkPendingResultsSmart` auto-settle pending bets by re-checking fixtures.
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
- Bump cache key versions (e.g. `betradar_cache_v32` → `v33`) when the cached data shape changes, to invalidate stale client caches.

See also the worker repo (`betradar-worker`) and the public frontend (`blitztips`).
