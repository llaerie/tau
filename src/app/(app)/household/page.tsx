import { redirect } from "next/navigation";
import { StackBar } from "@/components/charts/StackBar";
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
import { monthFromParam } from "@/lib/month-param";
import { buildHouseholdView } from "@/lib/views";

export const metadata = { title: "Household" };

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.spaces.some((s) => s.kind === "household")) redirect("/");
  const month = monthFromParam((await searchParams).month);
  const v = buildHouseholdView(viewer, month);
  const r = v.result;
  const shortfall = r.surplus.total.complete && r.surplus.total.knownCents < 0;

  return (
    <>
      <PageHeader eyebrow="Household" title="Shared household" description="Funded by each person's contribution and any planned company distribution. Shared bills and goals come out of that, in order." actions={<MonthNav month={month} basePath="/household" />} />
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard metric={r.funding} testId="metric-household-funding" />
        <MetricCard metric={r.bills} />
        <MetricCard metric={r.surplus} testId="metric-household-surplus" />
        <MetricCard metric={r.cash} />
      </div>

      {shortfall && (
        <div className="mb-6">
          <Notice tone="bad">
            Planned funding does not cover shared bills and goals. The gap is <Cents value={-r.surplus.total.knownCents} />. Options: raise a contribution, plan a company distribution (see what the company can afford on its page), or lower a goal. Nothing here was adjusted automatically.
          </Notice>
        </div>
      )}

      <Section title="Monthly waterfall">
        <Card>
          <Waterfall lines={r.lines} />
          {r.contributionSplit && (
            <div className="mt-4">
              <StackBar segments={r.contributionSplit.map((c, i) => ({ label: `${c.name} (${(c.shareBps / 100).toFixed(0)}%)`, cents: c.amountCents, color: i === 0 ? "#2a78d6" : "#eb6834" }))} caption="Contribution split" />
            </div>
          )}
        </Card>
      </Section>

      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <GoalsCard goals={r.goals} editHref={`/accounts?space=${v.space.id}#goals`} title="Shared goals" />
        <BillsCard bills={v.data.bills} statuses={v.bills} unpaidCommittedCents={v.unpaidCommittedCents} editHref={`/accounts?space=${v.space.id}#bills`} />
      </div>

      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <FlowsCard flows={v.flows} month={month} spaceKind="household" />
        <Card>
          <h3 className="font-medium">Accounts</h3>
          <div className="mt-3"><AccountsStrip accounts={v.data.accounts} /></div>
        </Card>
      </div>

      <Section title="Projection">
        <ProjectionSection projection={v.projection} />
      </Section>

      <UnresolvedCard items={r.unresolved.map((u) => ({ label: u, where: "Settings → Household" }))} />
    </>
  );
}
