import Link from "next/link";
import { and, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { TransactionForm } from "@/components/forms/TransactionForm";
import { TransactionRowActions } from "@/components/forms/TransactionRowActions";
import { Cents } from "@/components/Money";
import { ButtonLink, Card, EmptyState, PageHeader, dateLabel, monthLabel } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEdit } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { TRANSACTION_KIND_LABELS, monthPeriod, type TransactionKind } from "@/lib/finance/classify";
import { monthFromParam } from "@/lib/month-param";
import { addMonth } from "@/lib/views";

export const metadata = { title: "Transactions" };

const KIND_TONE: Record<TransactionKind, string> = {
  income: "chip-good",
  expense: "chip-neutral",
  bill_payment: "chip-neutral",
  transfer: "chip-accent",
  cc_payment: "chip-accent",
  savings_allocation: "chip-accent",
  payroll_withholding: "chip-unknown",
};

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const month = monthFromParam(sp.month);
  const spaceParam = typeof sp.space === "string" ? sp.space : "";
  const kindParam = typeof sp.kind === "string" ? sp.kind : "";
  const visibleSpaces = viewer.spaces;
  const selected = visibleSpaces.find((x) => x.id === spaceParam) ?? null;
  const spaceIds = selected ? [selected.id] : visibleSpaces.map((x) => x.id);

  const db = getDb();
  const accounts = spaceIds.length ? db.select().from(s.accounts).where(inArray(s.accounts.spaceId, spaceIds)).all() : [];
  const accountIds = accounts.map((a) => a.id);
  const period = monthPeriod(month);
  const rows = accountIds.length
    ? db
        .select()
        .from(s.transactions)
        .where(and(or(inArray(s.transactions.accountId, accountIds), inArray(s.transactions.counterAccountId, accountIds)), gte(s.transactions.date, period.from), lte(s.transactions.date, period.to)))
        .orderBy(desc(s.transactions.date), desc(s.transactions.createdAt))
        .all()
        .filter((t) => !kindParam || t.kind === kindParam)
    : [];
  // All accounts the viewer can see, for transfer targets and labels.
  const allAccounts = db.select().from(s.accounts).where(inArray(s.accounts.spaceId, visibleSpaces.map((x) => x.id))).all();
  const accountName = new Map(allAccounts.map((a) => [a.id, a.name]));
  const spaceName = new Map(visibleSpaces.map((x) => [x.id, x.name]));
  const spaceOfAccount = new Map(allAccounts.map((a) => [a.id, a.spaceId]));
  const categories = db.select().from(s.categories).where(eq(s.categories.workspaceId, viewer.workspace.id)).all();
  const bills = db.select().from(s.bills).where(and(inArray(s.bills.spaceId, visibleSpaces.map((x) => x.id)), eq(s.bills.isActive, true))).all();
  const goals = db.select().from(s.goals).where(inArray(s.goals.spaceId, visibleSpaces.map((x) => x.id))).all();
  const editableSpaces = visibleSpaces.filter((x) => canEdit(viewer, x.id));
  const query = (p: Record<string, string>) => "/transactions?" + new URLSearchParams({ month, ...(spaceParam ? { space: spaceParam } : {}), ...(kindParam ? { kind: kindParam } : {}), ...p }).toString();

  return (
    <>
      <PageHeader
        eyebrow="Ledger"
        title="Transactions"
        description="Every transaction has one kind, and each dollar is counted once. Transfers, card payments and savings moves are never spending."
        actions={
          <>
            <ButtonLink href="/transactions/import" variant="secondary">Import CSV</ButtonLink>
            <a href="#add" className="btn btn-primary">Add transaction</a>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-sm">
          <Link className="btn btn-ghost btn-sm" href={query({ month: addMonth(month, -1) })} aria-label="Previous month">‹</Link>
          <span className="min-w-[8rem] text-center font-medium">{monthLabel(month)}</span>
          <Link className="btn btn-ghost btn-sm" href={query({ month: addMonth(month, 1) })} aria-label="Next month">›</Link>
        </div>
        <div className="flex flex-wrap gap-1">
          <Link href={query({ space: "" })} className={`chip ${!selected ? "chip-accent" : "chip-neutral"}`}>All spaces</Link>
          {visibleSpaces.map((x) => (
            <Link key={x.id} href={query({ space: x.id })} className={`chip ${selected?.id === x.id ? "chip-accent" : "chip-neutral"}`}>{x.name}</Link>
          ))}
        </div>
        <form className="ml-auto" action="/transactions" method="get">
          <input type="hidden" name="month" value={month} />
          {spaceParam && <input type="hidden" name="space" value={spaceParam} />}
          <select name="kind" className="input !min-h-[34px] !py-1 text-sm" defaultValue={kindParam} aria-label="Filter by kind">
            <option value="">All kinds</option>
            {Object.entries(TRANSACTION_KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm ml-1">Filter</button>
        </form>
      </div>

      <Card className="!p-0">
        {rows.length === 0 ? (
          <div className="p-4"><EmptyState title="No transactions in this view">Change the month or filters, add one below, or import a CSV.</EmptyState></div>
        ) : (
          <div className="table-wrap">
            <table className="data" data-testid="transactions-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Kind</th>
                  <th>Account</th>
                  <th className="r">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const isOut = t.kind !== "income";
                  const inScope = accountIds.includes(t.accountId);
                  const counterInScope = t.counterAccountId ? accountIds.includes(t.counterAccountId) : false;
                  const shownAsIncoming = !inScope && counterInScope;
                  const sign = t.kind === "payroll_withholding" ? "" : shownAsIncoming || !isOut ? "+" : "−";
                  return (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-ink-2">{dateLabel(t.date)}</td>
                      <td>
                        <span className="font-medium">{t.description}</span>
                        <span className="block text-xs text-ink-3">
                          {spaceName.get(spaceOfAccount.get(t.accountId) ?? "") ?? "Other space"}
                          {t.source !== "manual" && ` · ${t.source}`}
                        </span>
                      </td>
                      <td><span className={`chip ${KIND_TONE[t.kind]}`}>{TRANSACTION_KIND_LABELS[t.kind]}</span></td>
                      <td className="text-ink-2">
                        {accountName.get(t.accountId) ?? "Hidden account"}
                        {t.counterAccountId && <span className="block text-xs text-ink-3">→ {accountName.get(t.counterAccountId) ?? "account in a space you cannot see"}</span>}
                      </td>
                      <td className="r whitespace-nowrap">
                        <span className={t.kind === "payroll_withholding" ? "text-ink-3" : ""}>{sign}<Cents value={t.amountCents} cents /></span>
                      </td>
                      <td className="r">{canEdit(viewer, t.spaceId) && <TransactionRowActions id={t.id} kind={t.kind} hasCounter={!!t.counterAccountId} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <section id="add" className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Add a transaction</h2>
        {editableSpaces.length === 0 ? (
          <Card>You have view-only access to every space here.</Card>
        ) : (
          <Card>
            <TransactionForm
              spaces={editableSpaces.map((x) => ({ id: x.id, name: x.name }))}
              accounts={allAccounts.map((a) => ({ id: a.id, name: a.name, spaceId: a.spaceId, type: a.type }))}
              categories={categories.map((c) => ({ id: c.id, name: c.name, group: c.group }))}
              bills={bills.map((b) => ({ id: b.id, name: b.name, spaceId: b.spaceId }))}
              goals={goals.map((g) => ({ id: g.id, name: g.name, spaceId: g.spaceId }))}
              defaultSpaceId={selected && canEdit(viewer, selected.id) ? selected.id : editableSpaces[0].id}
            />
          </Card>
        )}
      </section>
    </>
  );
}
