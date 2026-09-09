# Security and Data Handling

All company financial data is treated as highly sensitive. This document lists the controls
implemented in Phase One and the ones that must be in place before real data is loaded (Phase Two).

## Implemented in Phase One

| Control | Where |
|---|---|
| Authentication (lab): signed HMAC session cookie carrying the actor and role | `lib/security/session.ts`, `lib/ui/session.ts` |
| Authorization: role-based permission matrix, `requirePermission` on every API route | `lib/security/rbac.ts` |
| Least privilege: VIEWER cannot request actions; agents can never approve; RED requires OWNER plus the relevant professional | `lib/approvals/approval-engine.ts` |
| Household/personal data separation: `VIEW_HOUSEHOLD` is never granted to any business role; the household dashboard is a separate system | `lib/security/rbac.ts`, `lib/knowledge/policies.ts` |
| Sensitive-field handling: payroll line detail redacted for roles without `VIEW_PAYROLL_DETAIL`; identifiers (last4, EIN/SSN-like) masked without `VIEW_SENSITIVE_IDENTIFIERS`; `redactForModel` before anything reaches a model | `lib/security/redaction.ts` |
| Secrets: read from environment only; `assertNoSecretsInText` runs before any prompt is sent; `.env` is gitignored; no hardcoded credentials | `lib/security/secrets.ts`, `lib/models/guards.ts` |
| EIN: stored only as a reference to a secrets vault entry, never as a value in the dataset | `lib/knowledge/finance-bible.ts` |
| Audit log: hash-chained, append-only in memory; Postgres triggers reject UPDATE/DELETE/TRUNCATE on `audit_events` | `lib/audit`, `prisma/rls.sql` |
| Row-level security on payroll tables keyed by `app.role` | `prisma/rls.sql` |
| No financial data in client-side logs: API handlers return sanitized errors; pages pass plain JSON props; nothing is console-logged from handlers | `app/api/**` |
| Model data handling: prompts contain retrieved snippets only (narrow retrieval), never whole datasets; no production data is used for training | `lib/retrieval`, `lib/agents` |
| Encryption in transit: the app is meant to run behind TLS (reverse proxy / platform); provider SDKs use HTTPS | deployment |

## Required before Phase Two (real data, read-only)

- Replace lab auth with a real identity provider (OIDC) and MFA for OWNER/CPA roles.
- Encrypt object storage at rest with customer-managed keys; enable Postgres TDE or disk encryption.
- Backups: nightly `pg_dump` to encrypted storage with 35-day retention; quarterly restore drill.
  Restore procedure: provision Postgres 16, `prisma db push`, `pg_restore`, run `npm run db:rls`,
  verify `verifyChain()` on the audit log, and re-run `runIntegrityChecks` for the latest period.
- Secrets manager (e.g. cloud KMS-backed) for API keys and the EIN reference.
- Rate limiting and request logging (without payloads) at the edge.
- Data retention schedule confirmed by the CPA (policy parameters are UNCONFIRMED defaults today).
- A written contract review before any model provider receives real financial data; zero-data-
  retention terms where available.

## Things the system will never do (enforced, not just documented)

- Execute payments, run or change payroll, file or sign tax documents, respond to tax
  authorities, change entity structure, delete financial records (`PHASE_ONE_PROHIBITED_KINDS`).
- Treat unknown configuration as zero.
- Alter a locked period silently.
- Present synthetic data as live data (every page shows the synthetic banner; `isLive=false`
  on the not-connected bank adapter).
