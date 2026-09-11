import Link from "next/link";
import { redirect } from "next/navigation";
import { MetricCard } from "@/components/MetricCard";
import { AmountText, Cents, TotalText } from "@/components/Money";
import { UnresolvedCard } from "@/components/space/UnresolvedCard";
import { ButtonLink, Card, Notice, PageHeader, Section, monthLabel } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { isKnown } from "@/lib/finance/money";
import { buildOverview } from "@/lib/views";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const viewer = await requireViewer();
  if (!viewer.assumptions.onboardingCompleted && viewer.workspaceRole === "owner") redirect("/onboarding");
  const o = buildOverview(viewer);
  const c = o.company;
  const h = o.household;

  return (
    <>
      <PageHeader
        eyebrow={monthLabel(o.month)}
        title={`Good to see you, ${viewer.person?.name ?? viewer.user.name}`}
        description="Five questions, one honest answer each. Company, household and personal money stay separate and are never added into one balance."
        actions={<ButtonLink href="/scenarios" variant="secondary">Try a purchase</ButtonLink>}
      />

      <Section title="Cash by space" description="Each space keeps its own money. These are deliberately not summed.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {o.cashBySpace.map(({ space, cashTotal, cards }) => (
            <Link key={space.id} href={space.kind === "company" ? "/company" : space.kind === "household" ? "/household" : `/personal/${space.id}`} className="card flex flex-col gap-1 p-4 transition-colors hover:bg-surface-2" data-testid={`cash-${space.kind}`}>
              <span className="label">{space.kind === "personal" ? "Personal" : space.kind}</span>
              <span className="font-medium">{space.name}</span>
              <TotalText total={cashTotal} size="lg" />
              {isKnown(cards) && cards.cents !== 0 && <span className="text-xs text-ink-3">Cards: <AmountText amount={cards} /></span>}
            </Link>
          ))}
        </div>
      </Section>

      {c && (
        <Section title="1 · What cash belongs to the business" description="Company money stays company money until it is paid out as salary or a distribution.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard metric={c.result.cash} hint={c.result.runwayMonths !== null ? `${c.result.runwayMonths} months of known operating cost` : undefined} />
            <MetricCard metric={c.result.revenue} hint="Company revenue, not take-home" />
            <MetricCard metric={c.result.reserveTarget} hint="What the company wants to keep in reserve" />
          </div>
        </Section>
      )}

      {c && (
        <Section title="2 · What is already committed" description="Gross salaries, monthly allocations, payroll costs, bills, overhead and the tax reserve.">
          <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
            <MetricCard metric={c.result.committed} />
            <Card>
              <ul className="divide-y divide-line text-[13px]">
                {c.result.lines.filter((l) => (l.kind === "outflow" || l.kind === "reserve") && l.id !== "planned-distribution").map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="text-ink-2">{l.label}</span>
                    <AmountText amount={l.amount} />
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">Still to pay this month from bills: <Cents value={c.unpaidCommittedCents} />. Paid bills are not counted twice.</p>
            </Card>
          </div>
        </Section>
      )}

      {(c || h) && (
        <Section title="3 · What can fund the shared household" description="What the company could distribute after commitments, against what the household actually needs.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {c && <MetricCard metric={c.result.distributable} tone={c.result.distributable.total.complete ? undefined : "warn"} hint={c.result.distributable.total.complete ? undefined : "Upper bound while items stay unknown"} />}
            {h && <MetricCard metric={h.result.funding} hint="Planned distribution plus contributions" />}
            {h && <MetricCard metric={h.result.surplus} hint="After shared bills, goals and the spending plan" />}
          </div>
          {h && h.result.surplus.total.complete && h.result.surplus.total.knownCents < 0 && (
            <div className="mt-3">
              <Notice tone="bad">The household plan is short by <Cents value={-h.result.surplus.total.knownCents} /> a month. See the household page for options. Assumptions were not changed to hide it.</Notice>
            </div>
          )}
        </Section>
      )}

      <Section title="4 · What each person actually has available" description="After withholding, obligations, goals in priority order and the spending plan. Only spaces you may see are listed.">
        <div className="grid gap-3 lg:grid-cols-2">
          {o.personal.map((p) => {
            const travel = p.result.goals?.allocations.find((g) => g.priority === 1);
            return (
              <Card key={p.space.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[13.5px] font-semibold">{p.personName}{p.personTitle && <span className="ml-2 text-[12px] font-normal text-ink-3">{p.personTitle}</span>}</h3>
                  <Link href={`/personal/${p.space.id}`} className="link text-[12px]">Open</Link>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                  <div><dt className="label">Gross salary</dt><dd className="mt-0.5"><TotalText total={p.result.gross.total} size="sm" /></dd></div>
                  <div><dt className="label">Net take-home</dt><dd className="mt-0.5"><TotalText total={p.result.net.total} size="sm" /></dd></div>
                  <div><dt className="label">Available after goals</dt><dd className="mt-0.5"><TotalText total={p.result.discretionary.total} size="sm" className={p.result.discretionary.total.complete && p.result.discretionary.total.knownCents < 0 ? "text-bad" : ""} /></dd></div>
                  <div><dt className="label">Spending plan</dt><dd className="mt-0.5"><TotalText total={p.result.plannedSpending} size="sm" /></dd></div>
                </dl>
                {travel && (
                  <p className="mt-3 text-[12px] text-ink-3">
                    Priority 1 goal &ldquo;{travel.name}&rdquo; wants <Cents value={travel.wantedCents} /> a month{p.result.net.total.complete ? <> and is {travel.shortfallCents === 0 ? "fully funded" : `short by $${(travel.shortfallCents / 100).toLocaleString()}`}</> : "; funding depends on the unknown net take-home"}.
                  </p>
                )}
              </Card>
            );
          })}
          {o.personal.length === 0 && <Card>No personal space is visible to you.</Card>}
        </div>
      </Section>

      <Section title="5 · How a purchase would change things" description="Model a one-time or recurring cost against any space you can see.">
        <Card className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] text-ink-2">Scenarios show the cash path, the reserve floor and which goals get delayed, in priority order. Priority-1 goals like Arielle&apos;s friends-travel fund are protected first.</p>
          <ButtonLink href="/scenarios" variant="primary">Open scenarios</ButtonLink>
        </Card>
      </Section>

      <UnresolvedCard items={o.unresolved} title="Still unknown across the workspace" />
    </>
  );
}
