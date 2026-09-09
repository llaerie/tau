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
import { UnresolvedCard } from "@/components/space/UnresolvedCard";
import { Card, Notice, PageHeader, Section } from "@/components/ui";
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
  const impliedPct = v.observedNetLastMonthCents && v.observedWithholdingLastMonthCents ? Math.round((v.observedWithholdingLastMonthCents / (v.observedNetLastMonthCents + v.observedWithholdingLastMonthCents)) * 1000) / 10 : null;

  return (
    <>
      <PageHeader
        eyebrow={isMe ? "Personal · private to you" : "Personal"}
        title={v.personName}
        description="Gross salary from the company, minus withholding, minus obligations, then goals in priority order. Only what is left is discretionary."
        actions={<MonthNav month={month} basePath={`/personal/${spaceId}`} />}
      />
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard metric={r.gross} hint="Gross, not a spending allowance" />
        <MetricCard metric={r.net} tone={netUnknown ? "warn" : undefined} testId="metric-personal-net" />
        <MetricCard metric={r.obligations} />
        <MetricCard metric={r.discretionary} tone={netUnknown ? "warn" : undefined} testId="metric-personal-available" hint={netUnknown && r.discretionaryUpperBoundCents !== null ? `At most ${r.discretionaryUpperBoundCents < 0 ? "−" : ""}$${Math.abs(r.discretionaryUpperBoundCents / 100).toLocaleString()} even with nothing withheld` : undefined} />
      </div>

      {netUnknown && (
        <div className="mb-8">
          <Card className="border-warn/30">
            <h3 className="font-medium">Net take-home is unknown</h3>
            <p className="mt-1 text-sm text-ink-2">
              No withholding estimate has been entered, so nothing downstream is assumed.
              {impliedPct !== null && (
                <>
                  {" "}Ledger evidence: last month&apos;s net deposit was <Cents value={v.observedNetLastMonthCents!} /> with <Cents value={v.observedWithholdingLastMonthCents!} /> withheld, which implies about {impliedPct}%.
                </>
              )}
            </p>
            {(isMe || viewer.workspaceRole === "owner") && <WithholdingForm personId={v.personId} current={owner?.withholdingRatePct ?? null} suggested={impliedPct} />}
          </Card>
        </div>
      )}

      <Section title="Monthly waterfall">
        <Card>
          <Waterfall lines={r.lines} />
          {r.discretionary.total.complete && r.discretionary.total.knownCents < 0 && (
            <div className="mt-4"><Notice tone="bad">Obligations and goals exceed net income by <Cents value={-r.discretionary.total.knownCents} />. The friends-travel goal is kept ahead of discretionary spending; the shortfall is shown rather than hidden.</Notice></div>
          )}
        </Card>
      </Section>

      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <GoalsCard goals={r.goals} editHref={`/accounts?space=${spaceId}#goals`} netUnknown={netUnknown} />
        <BillsCard bills={v.data.bills} statuses={v.bills} unpaidCommittedCents={v.unpaidCommittedCents} editHref={`/accounts?space=${spaceId}#bills`} />
      </div>

      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <FlowsCard flows={v.flows} month={month} spaceKind="personal" />
        <Card>
          <h3 className="font-medium">Accounts</h3>
          <div className="mt-3"><AccountsStrip accounts={v.data.accounts} /></div>
        </Card>
      </div>

      <Section title="Projection">
        <ProjectionSection projection={v.projection} />
      </Section>

      <UnresolvedCard items={r.unresolved.map((u) => ({ label: u, where: "Settings → Owners" }))} />
    </>
  );
}
