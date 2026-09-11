import { redirect } from "next/navigation";
import { StackBar } from "@/components/charts/StackBar";
import { MetricCard } from "@/components/MetricCard";
import { AmountText, Cents, TotalText } from "@/components/Money";
import { AccountsStrip } from "@/components/space/AccountsStrip";
import { BillsCard } from "@/components/space/BillsCard";
import { FlowsCard } from "@/components/space/FlowsCard";
import { MonthNav } from "@/components/space/MonthNav";
import { ProjectionSection } from "@/components/space/ProjectionSection";
import { UnresolvedCard } from "@/components/space/UnresolvedCard";
import { Card, CardTitle, Notice, PageHeader, Section } from "@/components/ui";
import { Waterfall } from "@/components/Waterfall";
import { requireViewer } from "@/lib/actions/helpers";
import { ALLOCATION_KIND_LABELS } from "@/lib/assumptions";
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
  const committedLines = r.lines.filter((l) => (l.kind === "outflow" || l.kind === "reserve") && l.id !== "planned-distribution" && !viewer.assumptions.company.allocations.some((a) => a.kind === "household" && l.id === `alloc-${a.id}`));
  const colors = ["#2a78d6", "#eb6834", "#1baf7a", "#475569", "#8b95a7", "#cbd2dc", "#94a3b8"];
  const taxLine = r.lines.find((l) => l.id === "tax-reserve")!;

  return (
    <>
      <PageHeader
        eyebrow="Company"
        title={v.space.name}
        description="Business cash and what it is already promised to. Revenue is company money; it reaches the household only as salary or a distribution."
        actions={<MonthNav month={month} basePath="/company" />}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard metric={r.cash} hint={r.runwayMonths !== null ? `${r.runwayMonths} months of known operating cost` : undefined} testId="metric-company-cash" />
        <MetricCard metric={r.revenue} hint={viewer.assumptions.company.revenueBasis === "anticipated" ? "Anticipated, not contracted" : "Contracted"} />
        <MetricCard metric={r.committed} testId="metric-company-committed" />
        <MetricCard metric={r.distributable} tone={r.distributable.total.complete ? undefined : "warn"} hint={r.distributable.total.complete ? "After every known commitment" : "Upper bound while items stay unknown"} testId="metric-company-distributable" />
      </div>

      <Section title="Monthly waterfall" description="Revenue, then everything promised before an owner distribution, then the distributions themselves.">
        <Card>
          <div className="-mx-4 sm:-mx-5"><Waterfall lines={r.lines} /></div>
          <div className="mt-4">
            <StackBar
              segments={committedLines.filter((l) => isKnown(l.amount)).map((l, i) => ({ label: l.label.replace(/ \(.*\)$/, ""), cents: isKnown(l.amount) ? l.amount.cents : 0, color: colors[i % colors.length] }))}
              totalCents={r.revenue.total.complete ? r.revenue.total.knownCents : undefined}
              caption="Known commitments against revenue"
            />
            {committedLines.some((l) => !isKnown(l.amount)) && <p className="mt-2 text-[12px] text-unknown">Not drawn because unknown: {committedLines.filter((l) => !isKnown(l.amount)).map((l) => l.label).join(", ")}.</p>}
          </div>
        </Card>
      </Section>

      <div className="mb-7 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardTitle right={<a href="/settings#company" className="link text-[12px]">Edit</a>}>Monthly allocations</CardTitle>
          {viewer.assumptions.company.allocations.length === 0 ? (
            <p className="text-[13px] text-ink-3">None set.</p>
          ) : (
            <ul className="divide-y divide-line">
              {viewer.assumptions.company.allocations.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block font-medium">{a.name}</span>
                    <span className="block text-[12px] text-ink-3">{ALLOCATION_KIND_LABELS[a.kind]}</span>
                    {a.note && <span className="mt-0.5 block text-[12px] text-ink-2">{a.note}</span>}
                  </span>
                  <span className="num whitespace-nowrap">{a.amountCents === null ? <span className="chip chip-unknown">Unknown</span> : <Cents value={a.amountCents} />}</span>
                </li>
              ))}
            </ul>
          )}
          {viewer.assumptions.company.allocations.some((a) => a.kind === "mixed") && (
            <div className="mt-3"><Notice tone="unknown">A mixed allocation has no business vs household split yet, so the tax reserve stays unknown and the household part cannot be counted as a distribution. Split it into two lines in Settings when you know the amounts.</Notice></div>
          )}
        </Card>
        <Card>
          <CardTitle>Reserves and distributions</CardTitle>
          <dl className="space-y-2 text-[13px]">
            <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">Monthly operating cost</dt><dd><TotalText total={r.monthlyOperatingCost} size="sm" /></dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">Income tax reserve</dt><dd>{isKnown(taxLine.amount) ? <Cents value={taxLine.amount.cents} /> : <span className="chip chip-unknown">Unknown</span>}</dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">Cash reserve target</dt><dd><TotalText total={r.reserveTarget.total} size="sm" /></dd></div>
            <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">Planned distribution to household</dt><dd><AmountText amount={r.lines.find((l) => l.id === "planned-distribution")!.amount} /></dd></div>
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 font-medium"><dt>{r.remaining.label}</dt><dd><TotalText total={r.remaining.total} size="sm" className={r.remaining.total.complete && r.remaining.total.knownCents < 0 ? "text-bad" : ""} /></dd></div>
          </dl>
          {r.remaining.provenance.caveats.map((c) => <p key={c} className="mt-2 text-[12px] text-bad">{c}</p>)}
        </Card>
      </div>

      <div className="mb-7 grid gap-3 lg:grid-cols-2">
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
