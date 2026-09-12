import { inArray } from "drizzle-orm";
import { ActivityFilters } from "@/components/activity/ActivityFilters";
import { ActivityList, type ActivityRow } from "@/components/activity/ActivityList";
import { RecordExpense, type ExpenseAccount } from "@/components/activity/RecordExpense";
import { CsvImport } from "@/components/forms/CsvImport";
import { Disclosure } from "@/components/money/Panels";
import { EmptyState, PageHeader, monthLabel } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEdit } from "@/lib/auth/authorize";
import { loadSpaceData } from "@/lib/data/spaces";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { TRANSACTION_KIND_LABELS, TREATMENT_LABELS, type TransactionKind } from "@/lib/finance/classify";
import { todayIso } from "@/lib/ids";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : "";
  const spaceFilter = typeof sp.space === "string" ? sp.space : "all";
  const reviewOnly = sp.review === "1";
  const mine = viewer.spaces.find((x) => x.kind === "personal" && x.personId === viewer.person?.id);
  // Only the viewer's own spaces are loaded. The partner's personal space is never queried here.
  const spaces = viewer.spaces.filter((x) => x.kind !== "personal" || x.id === mine?.id);
  const selected = spaces.filter((x) => spaceFilter === "all" || (spaceFilter === "me" ? x.id === mine?.id : x.kind === spaceFilter));
  const db = getDb();
  const persons = viewer.persons.map((p) => ({ id: p.id, name: p.name }));
  const personName = (id: string) => persons.find((p) => p.id === id)?.name ?? "someone";

  const rows: ActivityRow[] = [];
  const seen = new Set<string>();
  const accountsForForm: ExpenseAccount[] = [];
  let categories: { id: string; name: string }[] = [];
  for (const space of selected.length ? selected : spaces) {
    const data = loadSpaceData(viewer, space);
    categories = data.categories.map((c) => ({ id: c.id, name: c.name }));
    const accountName = (id: string | null) => (id ? data.accounts.find((a) => a.id === id)?.name ?? "other account" : null);
    const editable = canEdit(viewer, space.id);
    for (const a of data.accounts.filter((x) => !x.isArchived)) accountsForForm.push({ id: a.id, name: a.name, spaceId: space.id, spaceName: space.name, spaceKind: space.kind });
    const txnIds = data.transactions.map((t) => t.id);
    const shares = txnIds.length ? db.select().from(s.expenseShares).where(inArray(s.expenseShares.transactionId, txnIds)).all() : [];
    for (const t of data.transactions) {
      if (seen.has(t.id)) continue;
      if (!data.accountIds.has(t.accountId)) continue; // counter-side rows belong to the paying space
      seen.add(t.id);
      const sign = t.kind === "income" ? 1 : t.kind === "transfer" || t.kind === "cc_payment" || t.kind === "savings_allocation" ? 0 : -1;
      rows.push({
        id: t.id,
        date: t.date,
        description: t.description,
        amountCents: t.amountCents,
        signedCents: sign === 0 ? -t.amountCents : sign * t.amountCents,
        kind: t.kind,
        kindLabel: TRANSACTION_KIND_LABELS[t.kind as TransactionKind],
        spaceId: space.id,
        spaceName: space.name,
        spaceKind: space.kind,
        accountName: accountName(t.accountId) ?? "account",
        counterAccountName: accountName(t.counterAccountId),
        categoryName: data.categories.find((c) => c.id === t.categoryId)?.name ?? null,
        beneficiary: t.beneficiary,
        purpose: t.purpose,
        treatmentLabel: t.treatment ? TREATMENT_LABELS[t.treatment] ?? t.treatment : null,
        reviewStatus: t.reviewStatus,
        source: t.source,
        voidedAt: t.voidedAt,
        voidReason: t.voidReason,
        documentId: t.documentId,
        shares: shares.filter((x) => x.transactionId === t.id).map((x) => ({ personId: x.personId, name: personName(x.personId), cents: x.cents })),
        canEdit: editable,
      });
    }
  }
  const filtered = rows
    .filter((r) => (!q || r.description.toLowerCase().includes(q) || (r.categoryName ?? "").toLowerCase().includes(q) || r.accountName.toLowerCase().includes(q)))
    .filter((r) => !month || r.date.startsWith(month))
    .filter((r) => !reviewOnly || (r.reviewStatus === "review_required" && !r.voidedAt))
    .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description))
    .slice(0, 300);
  const months = Array.from(new Set(rows.map((r) => r.date.slice(0, 7)))).sort().reverse();
  const monthLabels = Object.fromEntries(months.map((m) => [m, monthLabel(m)]));
  const canImport = accountsForForm.length > 0;
  const reviewCount = rows.filter((r) => r.reviewStatus === "review_required" && !r.voidedAt).length;
  const spaceOptions = [
    { value: "all", label: "All visible" },
    ...(spaces.some((x) => x.kind === "company") ? [{ value: "company", label: "Company" }] : []),
    ...(spaces.some((x) => x.kind === "household") ? [{ value: "household", label: "Household" }] : []),
    ...(mine ? [{ value: "me", label: "My money" }] : []),
  ];

  return (
    <>
      <PageHeader title="Activity" description="Everything recorded in the spaces you can see. Your partner's private entries are never loaded here." actions={<RecordExpense accounts={accountsForForm} categories={categories} persons={persons} meId={viewer.person?.id ?? null} today={todayIso()} />} />

      {reviewCount > 0 && !reviewOnly && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--fd-radius-card)] border border-line bg-warn-soft px-4 py-3" data-testid="review-queue">
          <p className="text-[14px]">
            <strong className="font-semibold">{reviewCount} entr{reviewCount === 1 ? "y needs" : "ies need"} your review.</strong>{" "}
            <span className="text-ink-2">Each one is missing a purpose, a beneficiary or a treatment, so it is not counted as settled.</span>
          </p>
          <a href="/activity?review=1" className="btn btn-secondary shrink-0">Review them</a>
        </div>
      )}

      <ActivityFilters
        initial={{ q: typeof sp.q === "string" ? sp.q : "", space: spaceFilter, month, reviewOnly }}
        spaceOptions={spaceOptions}
        months={months}
        monthLabels={monthLabels}
        reviewCount={reviewCount}
        shownCount={filtered.length}
        totalCount={rows.length}
      />

      {filtered.length === 0 ? (
        <EmptyState title="No entries match">Try another month, another space, or clear the filters above.</EmptyState>
      ) : (
        <ActivityList rows={filtered} persons={persons} meId={viewer.person?.id ?? null} />
      )}

      {canImport && (
        <div className="mt-6">
          <Disclosure title="Import a CSV statement" hint="Rows arrive unreviewed. Nothing is counted until you give each one a purpose and a treatment." testId="csv-import">
            <CsvImport accounts={accountsForForm.filter((a) => canEdit(viewer, a.spaceId))} allAccounts={accountsForForm.map((a) => ({ id: a.id, name: a.name, spaceName: a.spaceName }))} />
          </Disclosure>
        </div>
      )}
    </>
  );
}
