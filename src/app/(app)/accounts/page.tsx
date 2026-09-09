import { and, eq, inArray } from "drizzle-orm";
import { AccountForm, BillForm, GoalForm } from "@/components/forms/RecordForms";
import { AmountText, Cents } from "@/components/Money";
import { Card, EmptyState, PageHeader, Section } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEdit } from "@/lib/auth/authorize";
import { loadSpaceData } from "@/lib/data/spaces";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { amountFromNullable } from "@/lib/finance/money";
import Link from "next/link";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const spaceParam = typeof sp.space === "string" ? sp.space : "";
  const space = viewer.spaces.find((x) => x.id === spaceParam) ?? viewer.spaces[0];
  if (!space) return <PageHeader title="No spaces" />;
  const data = loadSpaceData(viewer, space);
  const editable = canEdit(viewer, space.id);
  const categories = getDb().select().from(s.categories).where(and(eq(s.categories.workspaceId, viewer.workspace.id), inArray(s.categories.group, [space.kind]))).all();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader eyebrow="Records" title="Accounts, bills & goals" description="Balances, recurring bills and savings goals per space. Leave a balance or amount blank when you do not know it; it will show as unknown rather than zero." />
      <div className="mb-6 flex flex-wrap gap-1">
        {viewer.spaces.map((x) => (
          <Link key={x.id} href={`/accounts?space=${x.id}`} className={`chip ${space.id === x.id ? "chip-accent" : "chip-neutral"}`}>{x.name}</Link>
        ))}
        {!editable && <span className="chip chip-warn">view only</span>}
      </div>

      <Section title="Accounts" id="accounts" description="Balance = opening balance plus every transaction since that date.">
        <Card className="!p-0">
          {data.accounts.length === 0 ? (
            <div className="p-4"><EmptyState title="No accounts yet" /></div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Account</th><th>Type</th><th className="r">Opening</th><th className="r">Balance today</th><th></th></tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.id} className={a.isArchived ? "opacity-50" : ""}>
                      <td>{a.name}<span className="block text-xs text-ink-3">{a.institution ?? ""}{a.isArchived ? " · archived" : ""}</span></td>
                      <td className="text-ink-2">{a.type.replace("_", " ")}</td>
                      <td className="r">{a.openingBalanceCents === null ? <span className="chip chip-unknown">Not entered</span> : <><Cents value={a.openingBalanceCents} /><span className="block text-xs text-ink-3">as of {a.openingBalanceAsOf}</span></>}</td>
                      <td className="r"><AmountText amount={a.balance} /><span className="block text-xs text-ink-3">{a.transactionCount} txns</span></td>
                      <td className="r">{editable && <AccountForm spaceId={space.id} account={{ id: a.id, name: a.name, type: a.type, institution: a.institution, openingBalanceCents: a.openingBalanceCents, openingBalanceAsOf: a.openingBalanceAsOf, isArchived: a.isArchived }} today={today} compact />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {editable && <div className="mt-3"><Card><h3 className="mb-2 font-medium">Add account</h3><AccountForm spaceId={space.id} today={today} /></Card></div>}
      </Section>

      <Section title="Recurring bills" id="bills" description="Counted as committed until a bill payment is recorded for the period.">
        <Card className="!p-0">
          {data.bills.length === 0 ? (
            <div className="p-4"><EmptyState title="No bills yet" /></div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Bill</th><th className="r">Amount</th><th>Cadence</th><th>Due</th><th></th></tr></thead>
                <tbody>
                  {data.bills.map((b) => (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td className="r"><AmountText amount={amountFromNullable(b.amountCents, "not entered")} /></td>
                      <td className="text-ink-2">{b.cadence}</td>
                      <td className="text-ink-2">{b.dueDay ?? "—"}</td>
                      <td className="r">{editable && <BillForm spaceId={space.id} categories={categories} bill={b} compact />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {editable && <div className="mt-3"><Card><h3 className="mb-2 font-medium">Add bill</h3><BillForm spaceId={space.id} categories={categories} /></Card></div>}
      </Section>

      <Section title="Goals" id="goals" description="Priority 1 is funded first. A lower priority goal only gets money once every higher one is fully funded.">
        <Card className="!p-0">
          {data.goals.length === 0 ? (
            <div className="p-4"><EmptyState title="No goals yet" /></div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>#</th><th>Goal</th><th className="r">Monthly</th><th className="r">Target</th><th className="r">Saved</th><th></th></tr></thead>
                <tbody>
                  {data.goals.map((g) => (
                    <tr key={g.id}>
                      <td className="num text-ink-3">{g.priority}</td>
                      <td>{g.name}{g.rule && <span className="block text-xs text-ink-3">{g.rule}</span>}</td>
                      <td className="r"><AmountText amount={amountFromNullable(g.monthlyTargetCents, "not set")} /></td>
                      <td className="r">{g.targetTotalCents === null ? <span className="text-ink-3">—</span> : <Cents value={g.targetTotalCents} />}</td>
                      <td className="r"><Cents value={g.savedCents} /></td>
                      <td className="r">{editable && <GoalForm spaceId={space.id} goal={g} compact />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {editable && <div className="mt-3"><Card><h3 className="mb-2 font-medium">Add goal</h3><GoalForm spaceId={space.id} /></Card></div>}
      </Section>
    </>
  );
}
