# Finance Desk

A crisp finance workspace for a small S corporation (Will, CEO), the shared household of its
two people, and each person's private money (Will and Arielle, Creative Director). Company,
household and the two personal spaces are kept separate; they connect through classified
transactions, per-space permissions and consolidated views that show the spaces side by side
without ever blending them into one balance.

> `SPEC.md` was not present in the repository when this was built. The specification the app was
> built against is reconstructed in [`docs/ASSUMED_SPEC.md`](docs/ASSUMED_SPEC.md); the plan is in
> [`docs/PLAN.md`](docs/PLAN.md) and progress in [`CHECKLIST.md`](CHECKLIST.md).

## What it answers

1. What cash belongs to the business.
2. What is already committed to employees, payroll, taxes and bills.
3. What can fund the shared household.
4. What each person actually has available after personal goals.
5. How a proposed purchase changes cash flow and savings goals.

Every primary number has a **Where this comes from** control showing its formula, inputs,
assumptions and caveats. Unknown inputs (tax rates, payroll classification, overhead, balances)
stay unknown and are reported as "known so far · N unknown". They are never treated as zero.

## Run the demo (no accounts, no API keys)

```bash
pnpm install
pnpm demo            # http://localhost:3000, synthetic data, persona sign-in
```

The demo seeds a workspace for Will and Arielle into `./data/finance-desk.db`: plan figures
follow the stated plan, balances and bills are synthetic and labelled as such. Changes persist;
**Settings → Reset demo data** restores the original set. Or run the production build:

```bash
pnpm build && pnpm start:demo
```

## Live mode (real data)

```bash
export FINANCE_DESK_MODE=live
export AUTH_SECRET="$(openssl rand -hex 32)"     # required, 32+ chars
export FINANCE_DESK_DB=./data/finance-desk.db     # optional, private SQLite file
export ANTHROPIC_API_KEY=sk-ant-...               # optional, enables Claude in the assistant
export FINANCE_DESK_MODEL=claude-opus-5           # optional
pnpm build && pnpm start
```

Live mode uses email + password accounts (scrypt), signed HTTP-only session cookies, per-space
roles (owner / editor / viewer) enforced on the server for every read, action and API route, and
private SQLite storage. Demo persona sign-in is refused. A missing `AUTH_SECRET` is a startup
error; there is no fallback to demo access. Owners create invite links from Settings and share
them themselves; Finance Desk sends nothing.

Copy `.env.example` to `.env.local` if you prefer a file.

## Assistant

`/assistant` answers questions using tools that call the same deterministic engine as the
dashboards. With `ANTHROPIC_API_KEY` set, Claude runs a tool-use loop and explains the results.
Without it, replies are clearly labelled **deterministic previews**: the question is routed to the
tools and their output is rendered with fixed wording. No number is ever produced by the model.

## Data in and out

Manual entry and CSV import (`/transactions`, `/transactions/import`) are the two ways data gets
in. No bank, payroll, accounting or payment integration is connected, and the UI says so.
`/api/export` returns a JSON export of everything the signed-in user may see.

## Checks

```bash
pnpm test        # financial engine and auth unit tests (Vitest)
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm build       # production build
pnpm test:e2e    # Playwright: desktop + mobile, demo and live-mode behaviour
pnpm check       # all of the above
```

## Layout

```
src/lib/finance      pure, tested engine: money/unknowns, waterfalls, goals, classification,
                     projection, purchase scenarios, CSV parsing
src/lib/db           Drizzle schema, migrations (drizzle/), synthetic seed
src/lib/auth         passwords, sessions, authorization helpers
src/lib/actions      server actions (every one checks the viewer's space role)
src/lib/views        turns stored data into engine inputs and results for the screens
src/lib/assistant    tool definitions, Claude loop, deterministic preview
src/app              routes; src/components: UI
e2e                  Playwright suites
```
