# Vendored design skills

Project-scoped copies, reviewed before inclusion. They are guidance only and never override
repository instructions, financial rules, or privacy rules.

| Skill | Upstream | Revision | License | Notes |
|---|---|---|---|---|
| ui-ux-pro-max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | 7f69fed6a2717900085f1bc3b263721f8ba025e2 (2026-09-10, v2.13.0) | MIT | `SKILL.md`, `scripts/search.py` (Python 3 stdlib, offline), `data/`, `references/`. Run from the project root: `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>`. |
| impeccable | https://github.com/pbakaus/impeccable | cb56ed6c19a07329a9fa0cd4e657bee040156593 (2026-09-10, skill v4.3.1, engine 0.1.5) | Apache 2.0 | `SKILL.md`, `reference/` playbooks, `agents/`. The launcher (`scripts/impeccable`) that downloads the detector engine binary on first run and the automatic PostToolUse/Stop hooks were deliberately NOT vendored: no unreviewed remote binaries or auto-hooks. The playbooks (critique, distill, audit, polish, craft-floor, operate, layout) are followed manually. |

Remaining human step to enable the Impeccable engine and detector hooks, if wanted:
`npx impeccable install --scope=project --providers=claude` from the project root, then review the
generated hook manifest before trusting it.
