import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { PageHeader, Tabs, pickTab, Card, CardHeader, StatusPill, Badge, Grid, Stat, TableWrap, Money, Notice, EmptyState, LinkButton } from "@/components/ui";
import { ActionButton } from "@/components/ui/ActionButton";
import { fmtDate, fmtDateTime, fmtMoney, titleCase } from "@/lib/ui/format";
import { can } from "@/lib/security/rbac";
import { isValidISODate } from "@/lib/core/dates";
import type { JournalEntry } from "@/lib/core/types";

export const metadata: Metadata = { title: "Accounting" };
export const dynamic = "force-dynamic";

const TABS = ["chart", "journal", "trial-balance", "periods", "integrity"];

export default async function AccountingPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const tab = pickTab(q.tab, TABS);
  const { rt, actor, asOf } = await pageCtx();
  const ds = rt.dataset;
  const acct = new Map(ds.accounts.map((a) => [a.id, a]));
  const canPropose = can(actor.role, "PROPOSE_ACTIONS");
  const canLock = can(actor.role, "LOCK_PERIOD");

  const tbDate = isValidISODate(sp(q.asOf)) ? sp(q.asOf) : asOf;
  const jStatus = sp(q.status);
  const jSource = sp(q.source);
  const jPeriod = sp(q.period);
  const jSearch = sp(q.search).toLowerCase();

  const entries = [...ds.journalEntries].sort((a, b) => b.entryNumber - a.entryNumber);
  const journal = entries.filter((e) => (!jStatus || e.status === jStatus) && (!jSource || e.source === jSource) && (!jPeriod || e.periodId === jPeriod) && (!jSearch || `${e.description} ${e.id} #${e.entryNumber}`.toLowerCase().includes(jSearch)));
  const drafts = entries.filter((e) => e.status === "DRAFT" || e.status === "PENDING_APPROVAL");
  const periods = [...ds.periods].sort((a, b) => (a.id < b.id ? 1 : -1));
  const tb = tab === "trial-balance" ? rt.ledger.trialBalance(tbDate) : null;
  const integrity = tab === "integrity" ? rt.ledger.runIntegrityChecks(asOf) : null;
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const balanceOf = (id: string) => rt.ledger.accountBalance(id, asOf);

  return (
    <>
      <PageHeader title="Accounting" description="Double-entry ledger: every entry balances, locked periods reject postings, and every posting is an audited action." />
      <Grid cols={4} className="mb-5">
        <Stat label="Accounts" value={ds.accounts.filter((a) => a.isActive).length} sub={`${ds.accounts.filter((a) => a.restricted).length} restricted`} />
        <Stat label="Journal entries" value={entries.length} sub={`${entries.filter((e) => e.status === "POSTED").length} posted · ${drafts.length} draft/pending`} tone={drafts.length ? "warn" : "neutral"} />
        <Stat label="Periods" value={periods.length} sub={`${periods.filter((p) => p.status === "LOCKED").length} locked · ${periods.filter((p) => p.status === "SOFT_CLOSED").length} soft-closed`} />
        <Stat label="Integrity" value={rt.ledger.runIntegrityChecks(asOf).passed ? "Pass" : "Fail"} tone={rt.ledger.runIntegrityChecks(asOf).passed ? "ok" : "bad"} sub={`Checks as of ${fmtDate(asOf)}`} href="/accounting?tab=integrity" />
      </Grid>
      <Tabs basePath="/accounting" active={tab} tabs={[{ key: "chart", label: "Chart of accounts" }, { key: "journal", label: "Journal", count: entries.length }, { key: "trial-balance", label: "Trial balance" }, { key: "periods", label: "Periods" }, { key: "integrity", label: "Integrity checks" }]} />

      {tab === "chart" ? (
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Subtype</th>
                <th>Normal</th>
                <th>Cash flow</th>
                <th className="r">Balance</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {[...ds.accounts].sort((a, b) => a.code.localeCompare(b.code)).map((a) => (
                <tr key={a.id} className={a.isActive ? "" : "opacity-50"}>
                  <td className="mono">{a.code}</td>
                  <td>
                    <div className="font-medium">{a.name}</div>
                    {a.description ? <div className="text-[11px] text-muted">{a.description}</div> : null}
                  </td>
                  <td>{titleCase(a.type)}</td>
                  <td className="text-muted">{titleCase(a.subtype)}</td>
                  <td className="text-muted">{a.normalBalance === "DEBIT" ? "Dr" : "Cr"}</td>
                  <td className="text-muted">{a.cashFlowSection ? titleCase(a.cashFlowSection) : "—"}</td>
                  <td className="r">
                    <Money value={balanceOf(a.id)} />
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {a.restricted ? <Badge tone="warn">restricted</Badge> : null}
                      {!a.isActive ? <Badge>inactive</Badge> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "journal" ? (
        <div className="space-y-3">
          <form className="grid grid-cols-2 gap-2 md:grid-cols-5" method="get">
            <input type="hidden" name="tab" value="journal" />
            <input name="search" defaultValue={sp(q.search)} placeholder="Search description / id" className="input col-span-2 md:col-span-1" />
            <select name="status" defaultValue={jStatus} className="select">
              <option value="">Any status</option>
              {["DRAFT", "PENDING_APPROVAL", "POSTED", "REVERSED", "VOID"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select name="source" defaultValue={jSource} className="select">
              <option value="">Any source</option>
              {Array.from(new Set(entries.map((e) => e.source))).sort().map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select name="period" defaultValue={jPeriod} className="select">
              <option value="">Any period</option>
              {periods.map((p) => (
                <option key={p.id}>{p.id}</option>
              ))}
            </select>
            <button className="inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Filter</button>
          </form>
          {drafts.length ? <Notice tone="warn">{drafts.length} draft entries. Posting is a governed action: routine, reversible entries execute; non-standard entries, restricted accounts and soft-closed periods route to Approvals; locked periods are refused.</Notice> : null}
          <div className="text-[12px] text-muted">{journal.length} entries</div>
          <div className="space-y-2">
            {journal.slice(0, 120).map((e) => (
              <JournalEntryCard key={e.id} e={e} acct={acct} entryById={entryById} canPropose={canPropose} />
            ))}
            {journal.length > 120 ? <Notice>Showing the first 120 of {journal.length}. Narrow the filters to see more.</Notice> : null}
            {journal.length === 0 ? <EmptyState title="No entries match" /> : null}
          </div>
        </div>
      ) : null}

      {tab === "trial-balance" && tb ? (
        <div className="space-y-3">
          <form className="flex flex-wrap items-end gap-2" method="get">
            <input type="hidden" name="tab" value="trial-balance" />
            <label className="text-[12px] text-muted">
              As of
              <input type="date" name="asOf" defaultValue={tbDate} className="input mt-1 w-44" />
            </label>
            <button className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">Recalculate</button>
            <span className="ml-auto flex items-center gap-2 text-[12px]">
              <StatusPill status={tb.balanced ? "BALANCED" : "UNBALANCED"} label={tb.balanced ? "Balanced" : "Out of balance"} />
              <LinkButton href={`/api/reports/export?kind=trial_balance&to=${tbDate}&format=json`} size="sm">
                JSON
              </LinkButton>
            </span>
          </form>
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="r">Debit</th>
                  <th className="r">Credit</th>
                  <th className="r">Balance</th>
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="mono">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="text-muted">{titleCase(r.type)}</td>
                    <td className="r">
                      <Money value={r.debit} />
                    </td>
                    <td className="r">
                      <Money value={r.credit} />
                    </td>
                    <td className="r">
                      <Money value={r.balance} colorize />
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={3}>Totals</td>
                  <td className="r">
                    <Money value={tb.totalDebits} />
                  </td>
                  <td className="r">
                    <Money value={tb.totalCredits} />
                  </td>
                  <td className="r">{tb.balanced ? "✓" : "✗"}</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
        </div>
      ) : null}

      {tab === "periods" ? (
        <div className="space-y-3">
          <Notice>Locking a period is a YELLOW action (approval by owner/finance operator). Unlocking is RED and needs an owner and a professional. Both create approval requests; the lock/unlock itself executes only once approved.</Notice>
          <TableWrap>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Range</th>
                  <th>Status</th>
                  <th className="r">Entries</th>
                  <th>Locked</th>
                  <th>History</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => {
                  const n = entries.filter((e) => e.periodId === p.id).length;
                  return (
                    <tr key={p.id}>
                      <td className="mono font-medium">{p.id}</td>
                      <td className="whitespace-nowrap text-muted">
                        {fmtDate(p.startDate)} – {fmtDate(p.endDate)}
                      </td>
                      <td>
                        <StatusPill status={p.status} />
                      </td>
                      <td className="r">{n}</td>
                      <td className="text-muted">
                        {p.lockedAt ? (
                          <>
                            {fmtDateTime(p.lockedAt)} by {p.lockedBy} <span className="mono">{p.lockApprovalId}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="max-w-[280px] text-[11px] text-muted">{(p.tags ?? []).slice(-3).join(" · ") || "—"}</td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {p.status === "OPEN" ? <ActionButton url={`/api/accounting/periods/${p.id}/lock`} body={{ action: "SOFT_CLOSE" }} disabled={!canLock}>Soft close</ActionButton> : null}
                          {p.status !== "LOCKED" ? <ActionButton url={`/api/accounting/periods/${p.id}/lock`} body={{ action: "LOCK" }} disabled={!canLock}>Request lock</ActionButton> : null}
                          {p.status === "LOCKED" ? <ActionButton url={`/api/accounting/periods/${p.id}/lock`} body={{ action: "UNLOCK", reason: "Console unlock request" }} variant="danger" disabled={!canLock}>Request unlock</ActionButton> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ) : null}

      {tab === "integrity" && integrity ? (
        <Card padded={false}>
          <CardHeader title={`Integrity checks as of ${fmtDate(integrity.asOfDate)}`} className="px-4 pt-3" actions={<StatusPill status={integrity.passed ? "PASSED" : "FAILED"} />} />
          <TableWrap className="border-0">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Severity</th>
                  <th>Result</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {integrity.checks.map((c) => (
                  <tr key={c.key} className={c.passed ? "" : c.severity === "ERROR" ? "hl-bad" : "hl"}>
                    <td>
                      <div className="font-medium">{c.label}</div>
                      <div className="mono text-faint">{c.key}</div>
                    </td>
                    <td>
                      <Badge tone={c.severity === "ERROR" ? "bad" : "warn"}>{c.severity}</Badge>
                    </td>
                    <td>
                      <StatusPill status={c.passed ? "PASS" : "FAIL"} />
                    </td>
                    <td className="max-w-[480px] text-muted">{c.details ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
    </>
  );
}

function JournalEntryCard({ e, acct, entryById, canPropose }: { e: JournalEntry; acct: Map<string, { code: string; name: string }>; entryById: Map<string, JournalEntry>; canPropose: boolean }) {
  const total = e.lines.reduce((s, l) => s + Number(l.debit), 0);
  const reverses = e.reversesEntryId ? entryById.get(e.reversesEntryId) : undefined;
  const reversedBy = e.reversedByEntryId ? entryById.get(e.reversedByEntryId) : undefined;
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-surface-2">
        <span className="mono w-14 text-muted">#{e.entryNumber}</span>
        <span className="w-24 whitespace-nowrap">{fmtDate(e.date)}</span>
        <span className="min-w-0 flex-1 truncate font-medium" title={e.description}>
          {e.description}
        </span>
        <Badge>{e.source}</Badge>
        <StatusPill status={e.status} />
        <span className="num w-28 text-right">{fmtMoney(total)}</span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Account</th>
                <th>Memo</th>
                <th className="r">Debit</th>
                <th className="r">Credit</th>
              </tr>
            </thead>
            <tbody>
              {e.lines.map((l) => {
                const a = acct.get(l.accountId);
                return (
                  <tr key={l.id}>
                    <td>
                      <span className="mono">{a?.code ?? "?"}</span> {a?.name ?? l.accountId}
                    </td>
                    <td className="text-muted">{l.memo ?? ""}</td>
                    <td className="r">{Number(l.debit) ? fmtMoney(l.debit, l.currency) : ""}</td>
                    <td className="r">{Number(l.credit) ? fmtMoney(l.credit, l.currency) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>
            id <span className="mono">{e.id}</span>
          </span>
          <span>period {e.periodId}</span>
          <span>created {fmtDateTime(e.createdAt)} by {e.createdBy}</span>
          {e.postedAt ? <span>posted {fmtDateTime(e.postedAt)}</span> : null}
          {e.approvalId ? (
            <span>
              approval <span className="mono">{e.approvalId}</span>
            </span>
          ) : null}
          {e.sourceIds.length ? <span>sources {e.sourceIds.length}</span> : null}
          {reverses ? (
            <span>
              reverses <span className="mono">#{reverses.entryNumber}</span>
            </span>
          ) : null}
          {reversedBy ? (
            <span className="text-bad">
              reversed by <span className="mono">#{reversedBy.entryNumber}</span>
            </span>
          ) : null}
          {e.memo ? <span>memo: {e.memo}</span> : null}
        </div>
        {e.status === "DRAFT" || e.status === "PENDING_APPROVAL" ? (
          <div className="mt-2">
            <ActionButton url={`/api/accounting/journal/${e.id}/post`} body={{}} variant="primary" disabled={!canPropose}>
              Post entry (governed)
            </ActionButton>
          </div>
        ) : null}
      </div>
    </details>
  );
}
