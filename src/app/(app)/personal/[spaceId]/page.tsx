import { notFound } from "next/navigation";
import { WithholdingForm } from "@/components/forms/WithholdingForm";
import { MetricCard } from "@/components/MetricCard";
import { Cents } from "@/components/Money";
import { AccountsStrip } from "@/components/space/AccountsStrip";
import { BillsCard } from "@/components/space/BillsCard";
import { FlowsCard } from "@/components/space/FlowsCard";
import { GoalsCard } from "@/components/space/GoalsCard";
import { MonthNav } from "@/components/space/MonthNav";
import { ProjectionSection } from "@/components/space/ProjectionSection";
import { SpendingPlanCard } from "@/components/space/SpendingPlanCard";
import { UnresolvedCard } from "@/components/space/UnresolvedCard";
import { Card, CardTitle, Notice, PageHeader, Section } from "@/components/ui";
import { Waterfall } from "@/components/Waterfall";
import { requireViewer } from "@/lib/actions/helpers";
import { canView } from "@/lib/auth/authorize";
import { monthFromParam } from "@/lib/month-param";
import { buildPersonalView } from "@/lib/views";

export const metadata = { title: "Personal" };

export default async function PersonalPage({ params, searchParams }: { params: Promise<{ spaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const { spaceId } = await params;
  // Server-side authorization: a space the viewer cannot see does not exist for them.
  if (!canView(viewer, spaceId)) notFound();
  const space = viewer.spaces.find((s) => s.id === spaceId)!;
  if (space.kind !== "personal") notFound();
  const month = monthFromParam((await searchParams).month);
  const v = buildPersonalView(viewer, spaceId, month);
  const r = v.result;
  const isMe = viewer.person?.id === v.personId;
  const owner = viewer.assumptions.owners[v.personId];
  const netUnknown = !r.net.total.complete;
  const suggestedIncomeTax = v.observedWithholdingLastMonthCents && owner?.withholding.ficaRatePct !== null && owner?.grossSalaryCents ? v.observedWithholdingLastMonthCents - Math.round((owner.grossSalaryCents * owner.withholding.ficaRatePct) / 100) : null;

  return (
    <>
      <PageHeader
        eyebrow={`${isMe ? "Personal · private to you" : "Personal"}${v.personTitle ? ` · ${v.personTitle}` : ""}`}
        title={v.personName}
        description="Gross salary, minus withholding, minus obligations, then goals in priority order, then the spending plan. Shared household costs are not here; the household budget covers them."
        actions={<MonthNav month={month} basePath={`/personal/${spaceId}`} />}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard metric={r.gross} hint="Gross W-2 pay, not a spending allowance" />
        <MetricCard metric={r.net} tone={netUnknown ? "warn" : undefined} testId="metric-personal-net" />
        <MetricCard metric={r.discretionary} tone={netUnknown ? "warn" : undefined} testId="metric-personal-available" hint={netUnknown && r.discretionaryUpperBoundCents !== null ? `At most ${r.discretionaryUpperBoundCents < 0 ? "−" : ""}$${Math.abs(r.discretionaryUpperBoundCents / 100).toLocaleString()} even with nothing withheld` : "After obligations and goals"} />
        <MetricCard metric={r.unallocated} tone={netUnknown ? "warn" : undefined} testId="metric-personal-unallocated" hint="After the spending plan" />
      </div>

      {netUnknown && (
        <div className="mb-7">
          <Card className="border-warn/30">
            <CardTitle>Net take-home is unknown</CardTitle>
            <p className="text-[13px] text-ink-2">
              Withholding has not been estimated, so nothing downstream is assumed.
              {v.observedNetLastMonthCents && v.observedWithholdingLastMonthCents && (
                <> Ledger evidence: last month&apos;s net deposit was <Cents value={v.observedNetLastMonthCents} /> with <Cents value={v.observedWithholdingLastMonthCents} /> withheld in total.</>
              )}
            </p>
            {(isMe || viewer.workspaceRole === "owner") && <WithholdingForm personId={v.personId} ficaRatePct={owner?.withholding.ficaRatePct ?? null} incomeTaxCents={owner?.withholding.incomeTaxCents ?? null} suggestedIncomeTaxCents={suggestedIncomeTax} />}
          </Card>
        </div>
      )}

      <Section title="Monthly waterfall">
        <Card>
          <div className="-mx-4 sm:-mx-5"><Waterfall lines={r.lines} /></div>
          {r.discretionary.total.complete && r.discretionary.total.knownCents < 0 && (
            <div className="mt-4"><Notice tone="bad">Obligations and goals exceed net income by <Cents value={-r.discretionary.total.knownCents} />. The priority-1 goal stays ahead of discretionary spending; the shortfall is shown rather than hidden.</Notice></div>
          )}
          {r.unallocated.total.complete && r.unallocated.total.knownCents < 0 && r.discretionary.total.knownCents >= 0 && (
            <div className="mt-4"><Notice tone="warn">The spending plan is <Cents value={-r.unallocated.total.knownCents} /> more than what is left after goals. Trim a budget or accept dipping into cash.</Notice></div>
          )}
        </Card>
      </Section>

      <div className="mb-7 grid gap-3 lg:grid-cols-2">
        <GoalsCard goals={r.goals} editHref={`/accounts?space=${spaceId}#goals`} netUnknown={netUnknown} />
        <SpendingPlanCard budgets={r.budgets} planned={r.plannedSpending} editHref={`/accounts?space=${spaceId}#budgets`} netUnknown={netUnknown} />
      </div>

      <div className="mb-7 grid gap-3 lg:grid-cols-2">
        <BillsCard bills={v.data.bills} statuses={v.bills} unpaidCommittedCents={v.unpaidCommittedCents} editHref={`/accounts?space=${spaceId}#bills`} />
        <FlowsCard flows={v.flows} month={month} spaceKind="personal" />
      </div>

      <Section title="Accounts">
        <AccountsStrip accounts={v.data.accounts} />
      </Section>

      <Section title="Projection">
        <ProjectionSection projection={v.projection} />
      </Section>

      <UnresolvedCard items={r.unresolved.map((u) => ({ label: u, where: "Settings → People" }))} />
    </>
  );
}
