import type { Metadata } from "next";
import { pageCtx, type SearchParams, sp } from "@/lib/ui/page";
import { PageHeader, Grid, Stat } from "@/components/ui";
import { TransactionsExplorer, type TxRow, type AccountOption } from "@/components/transactions/TransactionsExplorer";
import { AddTransactionForm, type TxSourceOption } from "@/components/transactions/AddTransactionForm";
import { canEnterManually } from "@/lib/ui/manual-entry";
import { fmtMoney } from "@/lib/ui/format";
import { can } from "@/lib/security/rbac";
import { add, abs } from "@/lib/core/money";

export const metadata: Metadata = { title: "Transactions" };
export const dynamic = "force-dynamic";

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const q = await searchParams;
  const { rt, actor } = await pageCtx();
  const ds = rt.dataset;
  const acctById = new Map(ds.accounts.map((a) => [a.id, a]));
  const sourceName = new Map<string, string>([...ds.bankAccounts.map((b) => [b.id, `${b.name} ····${b.last4}`] as [string, string]), ...ds.cards.map((c) => [c.id, `${c.name} ····${c.last4}`] as [string, string])]);

  const rows: TxRow[] = [...ds.transactions]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1))
    .map((t) => {
      const acc = t.category.accountId ? acctById.get(t.category.accountId) : undefined;
      return {
        id: t.id,
        date: t.date,
        postedDate: t.postedDate,
        amount: t.amount,
        currency: t.currency,
        description: t.descriptionRaw,
        merchant: t.merchantNormalized ?? null,
        sourceKind: t.sourceKind,
        sourceAccountId: t.sourceAccountId,
        sourceAccountName: sourceName.get(t.sourceAccountId) ?? t.sourceAccountId,
        month: t.date.slice(0, 7),
        categoryAccountId: t.category.accountId,
        categoryLabel: acc ? `${acc.code} ${acc.name}` : null,
        categoryStatus: t.category.status,
        categoryConfidence: t.category.confidence,
        categoryReason: t.category.reason ?? null,
        suggestedBy: t.category.suggestedBy ?? null,
        flags: t.flags,
        documentIds: t.documentIds,
        journalEntryId: t.journalEntryId ?? null,
        duplicateOfId: t.duplicateOfId ?? null,
        transferPairId: t.transferPairId ?? null,
      };
    });
  const accounts: AccountOption[] = ds.accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }));
  const sources = [...ds.bankAccounts.map((b) => ({ id: b.id, name: `${b.name} ····${b.last4}` })), ...ds.cards.map((c) => ({ id: c.id, name: `${c.name} ····${c.last4}` }))];
  const txSources: TxSourceOption[] = [...ds.bankAccounts.map<TxSourceOption>((b) => ({ id: b.id, name: `${b.name} ····${b.last4}`, kind: "BANK" })), ...ds.cards.map<TxSourceOption>((c) => ({ id: c.id, name: `${c.name} ····${c.last4}`, kind: "CARD" }))];
  const uncategorized = rows.filter((r) => r.categoryStatus === "UNCATEGORIZED");
  const suggested = rows.filter((r) => r.categoryStatus === "SUGGESTED");
  const missingReceipt = rows.filter((r) => r.flags.includes("MISSING_RECEIPT"));
  const flaggedAmount = rows.filter((r) => r.flags.includes("POSSIBLE_PERSONAL") || r.flags.includes("POSSIBLE_DUPLICATE")).reduce((acc, r) => add(acc, abs(r.amount)), "0.0000");
  const tab = sp(q.tab) === "exceptions" ? "exceptions" : "all";

  return (
    <>
      <PageHeader title="Transactions" description="Bank and card activity with the bookkeeping agent's category suggestions, confidence and control flags. Approvals of suggestions are governed actions." />
      <Grid cols={4} className="mb-5">
        <Stat label="Transactions" value={rows.length} sub={`${ds.bankAccounts.length} bank · ${ds.cards.length} card sources`} />
        <Stat label="Uncategorized" value={uncategorized.length} sub={`${suggested.length} suggestions awaiting approval`} tone={uncategorized.length ? "warn" : "ok"} />
        <Stat label="Missing receipts" value={missingReceipt.length} sub="Flagged MISSING_RECEIPT" tone={missingReceipt.length ? "warn" : "ok"} />
        <Stat label="Personal / duplicate flags" value={rows.length ? fmtMoney(flaggedAmount) : "—"} sub={rows.length ? "Absolute amount of flagged items" : "No transactions yet"} tone={flaggedAmount !== "0.0000" ? "bad" : "ok"} />
      </Grid>
      <AddTransactionForm sources={txSources} canEnter={canEnterManually(actor)} defaultDate={rt.asOfDate} />
      <TransactionsExplorer rows={rows} accounts={accounts} sources={sources} initialTab={tab} canPropose={can(actor.role, "PROPOSE_ACTIONS")} />
    </>
  );
}
