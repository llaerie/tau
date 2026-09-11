# Operations Guide (Phase One Training Lab)

## Requirements

- Node.js 20+ (built with 22).
- PostgreSQL 16 only if you want the Postgres store; the lab runs fully in memory by default.
- No API keys are required. Without keys the deterministic local model provider serves every role.

## Install and run

```bash
cp .env.example .env          # optional; defaults are fine for the lab
npm install
npm run lab:seed              # generates the synthetic company and writes .tau/lab-snapshot.json
npm run dev                   # http://localhost:3000
```

The dashboard, API and CLI scripts all share the same runtime (`lib/db/runtime.ts`). State lives in
`.tau/lab-snapshot.json` (gitignored). Delete it, or use Settings → Reset lab data, to start over.

## Everyday commands

| Command | What it does |
|---|---|
| `npm test` | Vitest suite (engines, governance, knowledge, agents, workflows, evals harness). Needs no database or network. |
| `npm run typecheck` | Strict TypeScript check of the whole repository |
| `npm run lint` | ESLint (Next.js rules) |
| `npm run build` | Production build of the dashboard |
| `npm run evals` | Runs the CFO Academy evaluation suite. Exits 1 if any case fails. Options: `-- --dir tax`, `-- --capability thirteen_week_cash`, `-- --id <case>`, `-- --limit 50`, `-- --apply` (writes competency scores into the lab snapshot) |
| `npm run evals:report` | Regenerates `docs/READINESS_REPORT.md` and `evals/results/readiness.json` from the latest run |
| `npm run lab:brief` | Prints the weekly CFO brief (`-- --json` for JSON, `-- --as-of YYYY-MM-DD`) |
| `npm run lab:close -- --period 2026-07` | Runs the 21-step month-end close simulation. Add `--lock --approval <id>` to lock with an approved LOCK_PERIOD approval |
| `npm run lab:cpa -- --from 2026-01-01 --to 2026-06-30 --out docs/cpa-package.md` | Generates the CPA package |

## Using PostgreSQL

```bash
# create role/database once (example)
su postgres -c "psql -c \"CREATE ROLE tau LOGIN PASSWORD 'tau'\" -c \"CREATE DATABASE tau_cfo OWNER tau\""
export DATABASE_URL=postgresql://tau:tau@localhost:5432/tau_cfo
npm run db:generate && npm run db:push && npm run db:rls
npm run db:seed
TAU_STORE=postgres npm run dev
```

`npm run db:rls` applies row-level security on payroll tables and the triggers that make
`audit_events` insert-only. The integration tests in `tests/db` run only when `DATABASE_URL` is
reachable and refuse to run against a non-synthetic company profile.

## Model providers

Set `TAU_MODEL_PROVIDER` to `auto` (default), `anthropic`, `openai` or `local`. With `auto`, the
registry uses Anthropic if `ANTHROPIC_API_KEY` is set, else OpenAI if `OPENAI_API_KEY` is set, else
local. Model ids come from `TAU_REASONING_MODEL`, `TAU_FAST_MODEL`, `TAU_VERIFICATION_MODEL` (Anthropic)
and `TAU_OPENAI_*_MODEL` (OpenAI-compatible; `OPENAI_BASE_URL` supported). Every remote model falls
back to the next provider and finally to local on error, timeout or refusal; fallback events are shown
in Settings → Model providers and recorded in audit events.

Numbers never come from a model. When a remote reasoning model is active it may rewrite the narrative
sections of a response; a numeric guard rejects any narrative containing a number that is not in the
deterministic results.

## Roles in the lab

Settings → Session lets you switch between OWNER, FINANCE_OPERATOR, CPA and VIEWER. Permissions are
enforced server-side; for example VIEWER cannot post entries or read the audit log, and an actor cannot
approve a request they raised.

## Backups (memory store)

`.tau/lab-snapshot.json` is the entire lab state. Copy it to back up; restore by copying it back.
For PostgreSQL use `pg_dump`/`pg_restore` and re-run `npm run db:rls` after a restore.

## Adding company facts

Company → "Complete the Finance Setup" lists every unknown. Answering a field records who confirmed it,
supersedes the previous value, and unblocks the capabilities that depend on it. Professional-review
fields (owner compensation, related-party revenue, China worker classification, CPA responsibilities)
stay flagged until a CPA or attorney confirms them.

## Ingesting CPA feedback

Reports → CPA package produces the package. Feedback from the CPA is added as Professional Guidance
(`ingestCpaFeedback`); once approved by the OWNER or CPA it becomes a versioned company policy that
agents cite in future answers.
