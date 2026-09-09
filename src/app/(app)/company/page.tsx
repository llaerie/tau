import { redirect } from "next/navigation";
import { StackBar } from "@/components/charts/StackBar";
import { MetricCard } from "@/components/MetricCard";
import { Cents, TotalText } from "@/components/Money";
import { AccountsStrip } from "@/components/space/AccountsStrip";
import { BillsCard } from "@/components/space/BillsCard";
import { FlowsCard } from "@/components/space/FlowsCard";
import { MonthNav } from "@/components/space/MonthNav";
import { ProjectionSection } from "@/components/space/ProjectionSection";
import { UnresolvedCard } from "@/components/space/UnresolvedCard";
import { Card, Notice, PageHeader, Section } from "@/components/ui";
import { Waterfall } from "@/components/Waterfall";
import { requireViewer } from "@/lib/actions/helpers";
import { EMPLOYEE_CLASSIFICATION_LABELS } from "@/lib/finance/company";
import { isKnown } from "@/lib/finance/money";
import { monthFromParam } from "@/lib/month-param";
import { buildCompanyView } from "@/lib/views";

export const metadata = { title: "Company" };

export default async function CompanyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  if (!viewer.spaces.some((s) => s.kind === "company")) redirect("/");
  const month = monthFromParam((await searchParams).month);
  const v = buildCompanyView(viewer, month);
  const r = v.result;
  const lines = r.lines.filter((l) => l.kind === "outflow" || l.kind === "reserve");
  const colors = ["#2a78d6", "#eb6834", "#1baf7a", "#5C5751", "#8A847B", "#C8C2B6"];

  return (
    <>
      <PageHeader
        eyebrow="Company"
        title={v.space.name}
        description="Business cash and what it is already promised to. Revenue here is company money; it only reaches the household through salaries or distributions."
        actions={<MonthNav month={month} basePath="/company" />}
      />
      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard metric={r.cash} hint={r.runwayMonths !== null ? `${r.runwayMonths} months of known operating cost` : undefined} testId="metric-company-cash" />
        <MetricCard metric={r.revenue} hint={viewer.assumptions.company.revenueBasis === "anticipated" ? "Anticipated, not contracted" : "Contracted"} />
        <MetricCard metric={r.committed} testId="metric-company-committed" />
        <MetricCard metric={r.distributable} tone={r.distributable.total.complete ? undefined : "warn"} hint={r.distributable.total.complete ? "After every known commitment" : "Upper bound while items stay unknown"} testId="metric-company-distributable" />
      </div>

      <Section title="Monthly waterfall" description="Anticipated revenue, then everything promised before an owner distribution is possible.">
        <Card>
          <Waterfall lines={r.lines} />
          <div className="mt-4">
            <StackBar
              segments={lines.filter((l) => isKnown(l.amount)).map((l, i) => ({ label: l.label.replace(/ \(.*\)$/, ""), cents: isKnown(l.amount) ? l.amount.cents : 0, color: colors[i % colors.length] }))}
              totalCents={r.revenue.total.complete ? r.revenue.total.knownCents : undefined}
              caption="Known commitments against anticipated revenue"
            />
            {lines.some((l) => !isKnown(l.amount)) && (
              <p className="mt-2 text-xs text-unknown">Not drawn because unknown: {lines.filter((l) => !isKnown(l.amount)).map((l) => l.label).join(", ")}.</p>
            )}
          </div>
        </Card>
      </Section>

      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <Card>
          <h3 className="font-medium">Employee allocation</h3>
          <p className="mt-1 text-2xl font-semibold tracking-tight num">{isKnown(r.lines[1].amount) ? <Cents value={r.lines[1].amount.cents} /> : "Unknown"}</p>
          <p className="mt-1 text-sm text-ink-2">{EMPLOYEE_CLASSIFICATION_LABELS[viewer.assumptions.company.employeeClassification]}</p>
          {viewer.assumptions.company.employeeClassification === "unresolved" && (
            <div className="mt-3"><Notice tone="unknown">Until the classification is resolved, employer payroll costs on this allocation cannot be computed and stay unknown.</Notice></div>
          )}
        </Card>
        <Card>
          <h3 className="font-medium">Reserves</h3>
          <dl className="mt-2 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">Cash reserve target</dt><dd><TotalText total={r.reserveTarget.total} size="sm" /></dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">Monthly operating cost</dt><dd><TotalText total={r.monthlyOperatingCost} size="sm" /></dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">Income tax reserve</dt><dd>{isKnown(r.lines.find((l) => l.id === "tax-reserve")!.amount) ? <Cents value={(r.lines.find((l) => l.id === "tax-reserve")!.amount as { cents: number }).cents} /> : <span className="chip chip-unknown">Rate not set</span>}</dd></div>
          </dl>
        </Card>
      </div>

      <div className="mb-8 grid gap-3 lg:grid-cols-2">
        <FlowsCard flows={v.flows} month={month} spaceKind="company" />
        <BillsCard bills={v.data.bills} statuses={v.bills} unpaidCommittedCents={v.unpaidCommittedCents} editHref={`/accounts?space=${v.space.id}#bills`} />
      </div>

      <Section title="Accounts">
        <AccountsStrip accounts={v.data.accounts} />
      </Section>

      <Section title="Projection">
        <ProjectionSection projection={v.projection} floorCents={r.reserveTarget.total.complete ? r.reserveTarget.total.knownCents : null} />
      </Section>

      <UnresolvedCard items={r.unresolved.map((u) => ({ label: u, where: "Settings → Company" }))} />
    </>
  );
}
