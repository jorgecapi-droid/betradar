# AGENTS.md

The full project guidance for AI coding agents is in **`CLAUDE.md`** (same folder) — **read it first**. It is not Claude-specific: it applies to any agent (Codex included). Keep `CLAUDE.md` as the single source of truth.

**This repo:** BetRadar — the owner's private multi-sport tips PWA (single `index.html`, inline, no build) on Cloudflare Pages. Uses the same `betradar-worker` backend (also as a generic `?target=` proxy).

**House rules:**
- Pushing to `main` deploys (Cloudflare Pages). **Ask the user before committing or pushing.**
- Private tool — the public SRIJ compliance rules of blitztips do not apply here.
- When you change significant logic, update `CLAUDE.md` so it stays accurate.
