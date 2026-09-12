import Link from "next/link";
import { ModeBadge } from "@/components/AppShell";
import { ProjectionChart } from "@/components/charts/ProjectionChart";
import { AmountText, Cents, TotalText } from "@/components/Money";
import { CalcButton } from "@/components/money/CalcButton";
import { PurchasePlanEditor, SubscriptionConfirm } from "@/components/money/CompanyEditors";
import { AllocationsEditor, FoodTargetEditor } from "@/components/money/PersonalEditors";
import { Card, EmptyState, Notice, dateLabel, monthLabel } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canEdit } from "@/lib/auth/authorize";
import type { Viewer } from "@/lib/auth/session";
import { PARTIAL_LABEL, TREATMENT_LABELS, subscriptionMonthly } from "@/lib/finance";
import { formatCents, formatTotal, isKnown, type Amount } from "@/lib/finance/money";
import { buildCompanyView, buildHouseholdView, buildPartnerSummary, buildPersonalView, toPlannedSubscription, type CompanyView, type HouseholdView, type PersonalView } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money" };

type Tab = "company" | "household" | "me" | "partner";

function tabsFor(viewer: Viewer): { key: Tab; label: string }[] {
  const partner = viewer.persons.find((p) => p.id !== viewer.person?.id);
  const mine = viewer.spaces.find((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id);
  return [
    ...(viewer.spaces.some((sp) => sp.kind === "company") ? [{ key: "company" as const, label: "Company" }] : []),
    ...(viewer.spaces.some((sp) => sp.kind === "household") ? [{ key: "household" as const, label: "Household" }] : []),
    ...(mine ? [{ key: "me" as const, label: "My money" }] : []),
    ...(partner ? [{ key: "partner" as const, label: `${partner.name}'s summary` }] : []),
  ];
}

export default async function MoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const sp = await searchParams;
  const tabs = tabsFor(viewer);
  const requested = typeof sp.space === "string" ? (sp.space as Tab) : undefined;
  const tab: Tab = tabs.some((t) => t.key === requested) ? requested! : tabs.some((t) => t.key === "me") ? "me" : tabs[0]?.key ?? "me";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-[14.5px] leading-relaxed text-ink-2">Each space on its own. Unknown inputs stay unknown, and nothing is netted across spaces.</p>
        <ModeBadge isDemo={viewer.isDemo} />
      </div>
      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-[var(--fd-radius-pill)] bg-surface-2 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Spaces">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/money?space=${t.key}`}
            className={`flex min-h-[40px] items-center whitespace-nowrap rounded-[var(--fd-radius-pill)] px-4 text-[14px] font-medium transition-colors ${tab === t.key ? "bg-surface text-ink shadow-panel" : "text-ink-2 hover:text-ink"}`}
            aria-current={tab === t.key ? "page" : undefined}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "me" && <PersonalTab viewer={viewer} />}
      {tab === "company" && <CompanyTab viewer={viewer} />}
      {tab === "household" && <HouseholdTab viewer={viewer} />}
      {tab === "partner" && <PartnerTab viewer={viewer} />}
    </>
  );
}

function Stat({ label, children, calc, note, testId }: { label: string; children: React.ReactNode; calc?: React.ReactNode; note?: string; testId?: string }) {
  return (
    <div className="min-w-0 py-3" data-testid={testId}>
      <p className="text-[12.5px] text-ink-3">{label}</p>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">{children}{calc}</div>
      {note && <p className="mt-0.5 text-[12px] text-ink-3">{note}</p>}
    </div>
  );
}

// ---------- My money ----------

function PersonalTab({ viewer }: { viewer: Viewer }) {
  const mine = viewer.spaces.find((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id)!;
  const v: PersonalView = buildPersonalView(viewer, mine.id);
  const th = v.takeHome;
  const f = v.food;
  const editable = canEdit(viewer, mine.id);
  const unallocated = f.unallocated.total;
  const takeHomeStatus = th.status === "verified" ? "Verified from a pay stub" : th.status === "estimate" ? "Estimate, not a verified paycheck" : "Incomplete";
  const recent = [...v.data.transactions]
    .filter((x) => !x.voidedAt && v.data.accountIds.has(x.accountId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start" data-testid="tab-me-content">

      <div className="flex min-w-0 flex-col gap-5">
        {/* The one prominent panel. Its principal figure is explicitly named. */}
        <section className="fd-feature-panel overflow-hidden" data-testid="plan-panel">
          <div className="fd-atmosphere px-5 pb-5 pt-5 sm:px-7 sm:pt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="label">Unallocated monthly plan</p>
                <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {unallocated.complete ? (
                    <span className="fd-money text-[42px] font-semibold leading-none sm:text-[46px]">{formatCents(unallocated.knownCents)}</span>
                  ) : (
                    <span className="text-[26px] font-semibold leading-tight text-ink-2 sm:text-[30px]">Not yet known</span>
                  )}
                  <span className="chip chip-unknown" hidden={unallocated.complete}>
                    {unallocated.unknowns.length} missing input{unallocated.unknowns.length === 1 ? "" : "s"}
                  </span>
                </p>
                <p className="mt-2.5 max-w-md text-[14px] leading-relaxed text-ink-2">
                  What is left each month after fixed bills, your household contribution, your food target and the allocations you chose.
                </p>
              </div>
              <span className="shrink-0">
                <CalcButton label="Unallocated monthly plan" provenance={f.unallocated.provenance} value={formatTotal(unallocated)} status={unallocated.complete ? "Complete" : "Incomplete"} asOf={v.month} />
              </span>
            </div>

            {!unallocated.complete && (
              <div className="mt-4 rounded-[var(--fd-radius-card)] bg-surface px-4 py-3.5 sm:flex sm:items-center sm:gap-4">
                <p className="min-w-0 text-[13.5px] leading-relaxed text-ink-2 sm:flex-1">
                  {(unallocated.unknowns[0] ?? "One input is still missing").replace(/\.?$/, ".")} Finish that and this figure becomes exact.
                </p>
                <Link href={f.foodTarget === null ? "#food" : "/settings#payroll"} className="btn btn-primary btn-sm mt-3 w-full shrink-0 sm:mt-0 sm:w-auto">
                  {f.foodTarget === null ? "Set your food target" : "Confirm withholding"}
                </Link>
              </div>
            )}
          </div>

          {/* Take-home sits in a breakdown, not as a competing headline card. */}
          <details className="group border-t border-line" data-testid="take-home">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-[14px] hover:bg-surface-2 sm:px-7">
              <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="font-medium">Take-home</span>
                <TotalText total={th.takeHome} size="sm" />
                <span className={`chip ${th.status === "verified" ? "chip-good" : th.status === "estimate" ? "chip-neutral" : "chip-unknown"}`}>{takeHomeStatus}</span>
              </span>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="border-t border-line px-5 pb-4 pt-3 sm:px-7">
              <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                <Row label="Gross salary" amount={th.gross} />
                <Row label="Employee FICA" amount={th.fica} negative />
                <Row label="California SDI" amount={th.sdi} negative />
                <Row label="Income tax withheld" amount={th.incomeTax} negative />
              </dl>
              {!th.takeHome.complete && (
                <p className="mt-3 text-[13px] text-ink-2">
                  Before income tax this is <Cents value={th.beforeIncomeTax.knownCents} />. Gross pay is not spendable cash, and withholding is never assumed.
                </p>
              )}
              <p className="mt-3">
                <Link href="/settings#payroll" className="link text-[13.5px]">
                  {th.status === "verified" ? "Payroll details" : "Enter figures from a pay stub"}
                </Link>
              </p>
            </div>
          </details>
        </section>

        {/* Food: target, spent, remaining, and one direct adjustment. */}
        <section className="card px-5 py-5 sm:px-6" id="food" data-testid="food-plan">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="label">Food this month</p>
              {f.foodTarget === null ? (
                <p className="mt-1.5 text-[20px] font-semibold">
                  <Cents value={f.foodSpentCents} /> spent <span className="font-normal text-ink-3">· no target yet</span>
                </p>
              ) : (
                <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[19px] font-semibold sm:text-[20px]">
                  <Cents value={f.foodSpentCents} />
                  <span className="text-[15px] font-normal text-ink-3">of</span>
                  <Cents value={f.foodTarget} />
                  <span className={`text-[15px] font-medium ${f.foodStatus === "over" ? "text-bad" : f.foodStatus === "close" ? "text-warn" : "text-good"}`}>
                    <Cents value={f.foodRemainingCents!} /> left
                  </span>
                </p>
              )}
              <p className="mt-1.5 max-w-md text-[13px] leading-snug text-ink-3">
                Your share of recorded meals and groceries. A split dinner counts only your part.
              </p>
            </div>
            <span className="shrink-0">
              <FoodTargetEditor personId={v.personId} targetCents={f.foodTarget} editable={editable} />
            </span>
          </div>
          {f.foodTarget !== null && (
            <div
              className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-label="Food spent against target"
              aria-valuemin={0}
              aria-valuemax={f.foodTarget}
              aria-valuenow={Math.min(f.foodSpentCents, f.foodTarget)}
            >
              <div
                className={`h-full rounded-full ${f.foodStatus === "over" ? "bg-bad" : f.foodStatus === "close" ? "bg-warn" : "bg-accent"}`}
                style={{ width: `${Math.min(100, (f.foodSpentCents / f.foodTarget) * 100)}%` }}
              />
            </div>
          )}
        </section>

        <section className="card px-5 py-5 sm:px-6" data-testid="allocations">
          <p className="label">What you chose to set aside</p>
          <p className="mt-1 text-[13px] text-ink-3">Savings, investing or a spending pot. Your choices, never imposed.</p>
          <div className="mt-3">
            <AllocationsEditor personId={v.personId} allocations={v.owner.allocations} editable={editable} />
          </div>
        </section>

        <section className="card px-5 py-5 sm:px-6" data-testid="recent-activity">
          <div className="flex items-baseline justify-between gap-3">
            <p className="label">Recent activity</p>
            <Link href="/activity?space=me" className="link text-[13px]">
              See all
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="mt-2 text-[13.5px] text-ink-3">Nothing recorded yet this month.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {recent.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-14 shrink-0 text-[12.5px] text-ink-3">{dateLabel(x.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{x.description}</span>
                    <span className="block truncate text-[12px] text-ink-3">
                      {v.data.categories.find((c) => c.id === x.categoryId)?.name ?? TREATMENT_LABELS[x.treatment ?? "none"] ?? "Uncategorised"}
                    </span>
                  </span>
                  {x.reviewStatus === "review_required" && <span className="chip chip-warn shrink-0">review</span>}
                  <Cents value={x.kind === "income" ? x.amountCents : -x.amountCents} signed className={`shrink-0 text-[14px] font-medium ${x.kind === "income" ? "text-good" : ""}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Lower-priority detail: cash, bills and what is coming. */}
      <div className="flex min-w-0 flex-col gap-4">
        <section className="card px-5 py-4" data-testid="personal-accounts">
          <p className="label">Your accounts</p>
          <ul className="mt-2 divide-y divide-line">
            {v.data.accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-[14px]">
                <span className="min-w-0">
                  <span className="block truncate">{a.name}</span>
                  <span className="block text-[12px] text-ink-3">{a.type.replace("_", " ")}</span>
                </span>
                <AmountText amount={a.balance} className="shrink-0" />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">Recorded from an opening balance plus entries. Not reconciled with the bank.</p>
        </section>

        <section className="card px-5 py-4" data-testid="fixed-bills">
          <p className="label">Fixed bills</p>
          <p className="mt-1.5"><TotalText total={v.fixedBillsTotal} size="md" /></p>
          <p className="mt-1 text-[12px] text-ink-3">Subtracted from take-home before anything else.</p>
        </section>

        {v.upcoming.length > 0 && (
          <section className="card px-5 py-4" data-testid="personal-upcoming">
            <p className="label">Coming up</p>
            <ul className="mt-2 divide-y divide-line">
              {v.upcoming.slice(0, 4).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    <span className="block text-[12px] text-ink-3">{dateLabel(o.dueDate)}{o.paid ? " · paid" : ""}</span>
                  </span>
                  <AmountText amount={o.amount} className="shrink-0" />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ label, amount, negative }: { label: string; amount: Amount; negative?: boolean }) {
  return (
    <div className="py-1.5">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="text-[13.5px]">{isKnown(amount) ? <span className="num">{negative ? "−" : ""}{formatCents(amount.cents)}</span> : <span className="chip chip-unknown" title={amount.reason}>Unknown</span>}</dd>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

// ---------- Company ----------

const GROUP_LABEL: Record<string, string> = { receipts: "Expected receipts", payroll: "Payroll", household_via_company: "Household costs paid by the company", operating: "Operating", one_time: "One-time this month", unknown_costs: "Unknown costs" };

function CompanyTab({ viewer }: { viewer: Viewer }) {
  const space = viewer.spaces.find((sp) => sp.kind === "company")!;
  const v: CompanyView = buildCompanyView(viewer);
  const p = v.plan;
  const editable = canEdit(viewer, space.id);
  const groups = ["receipts", "payroll", "household_via_company", "operating", "one_time"] as const;
  const persons = viewer.persons.map((x) => ({ id: x.id, name: x.name }));
  return (
    <div className="space-y-6" data-testid="tab-company-content">
      <p className="text-[13px] text-ink-3">{space.name} · {monthLabel(v.month)}</p>
      <Card testId="cash-plan">
        <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label={`Recorded cash${v.cashAsOf ? ` · as of ${dateLabel(v.cashAsOf)}` : ""}`} calc={<CalcButton label="Recorded cash" provenance={p.recordedCash.provenance} value={formatTotal(p.recordedCash.total)} />} note="Recorded, not reconciled." testId="metric-recorded-cash"><TotalText total={p.recordedCash.total} size="lg" /></Stat>
          <Stat label="Expected receipts" calc={<CalcButton label="Expected receipts" provenance={p.expectedReceipts.provenance} value={formatTotal(p.expectedReceipts.total)} />} note="Anticipated, not received. Company money, never take-home." testId="metric-expected-receipts"><TotalText total={p.expectedReceipts.total} size="lg" /></Stat>
          <Stat label="Received so far this month" note="Income entries recorded in company accounts." testId="metric-received"><TotalText total={p.receivedSoFar.total} size="lg" /></Stat>
          <Stat label="Known monthly commitments" calc={<CalcButton label="Known commitments" provenance={p.knownCommitments.provenance} value={formatTotal(p.knownCommitments.total)} />} testId="metric-known-commitments"><TotalText total={p.knownCommitments.total} size="lg" /></Stat>
          <Stat label={PARTIAL_LABEL} calc={<CalcButton label="Partial remainder" provenance={p.partialRemainder.provenance} value={formatTotal(p.partialRemainder.total)} />} note="Not profit, not a balance, not safe to spend." testId="metric-partial-remainder"><TotalText total={p.partialRemainder.total} size="lg" /></Stat>
          <Stat label="Runway on known costs" note={p.runwayMonthsOnKnownCosts === null ? "Needs recorded cash and known commitments." : "Recorded cash ÷ known monthly commitments. Ignores unknown costs."}>{p.runwayMonthsOnKnownCosts === null ? <span className="chip chip-unknown">Unknown</span> : <span className="num hero-value">{p.runwayMonthsOnKnownCosts.toFixed(1)} mo</span>}</Stat>
        </div>
        {p.unknownCosts.length > 0 && (
          <Notice tone="unknown">
            Still unknown: {p.unknownCosts.join("; ")}. These are not zero. Set them in <Link href="/settings#company" className="link">Settings</Link>.
          </Notice>
        )}
      </Card>

      <Card testId="plan-lines">
        <p className="label">Monthly plan lines</p>
        <div className="mt-2 divide-y divide-line">
          {groups.map((g) => {
            const lines = p.lines.filter((l) => l.group === g);
            if (!lines.length) return null;
            return (
              <div key={g} className="py-2.5">
                <p className="text-[12.5px] font-medium text-ink-2">{GROUP_LABEL[g]}</p>
                <ul className="mt-1 space-y-1">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-baseline justify-between gap-3 text-[13.5px]">
                      <span className="min-w-0">{l.label}{l.note && <span className="block text-[11.5px] text-ink-3">{l.note}</span>}</span>
                      <AmountText amount={l.amount} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-ink-3">Household rent and cars paid from company accounts are personal costs to the owners: shown here as cash out, flagged for tax treatment, and never counted as deductible business expenses by default.</p>
      </Card>

      <Card testId="subscriptions">
        <div className="flex items-baseline justify-between gap-2" id="subscriptions">
          <p className="label">Software and AI subscriptions</p>
          <span className="text-[12.5px] text-ink-3">Known monthly total: <TotalText total={p.subscriptionsTotal} size="sm" /></span>
        </div>
        {v.subscriptions.length === 0 ? (
          <EmptyState title="No subscriptions recorded" />
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {v.subscriptions.map((sub) => {
              const monthly = subscriptionMonthly(toPlannedSubscription(sub));
              return (
                <li key={sub.id} className="py-2.5" data-testid={`sub-${sub.id}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13.5px]">
                    <span>
                      {sub.provider} {sub.product}
                      {sub.quantity > 1 && <span className="text-ink-3"> × {sub.quantity}</span>}
                      <span className={`chip ml-2 ${sub.status === "active" ? "chip-good" : sub.status === "cancelled" ? "chip-neutral" : "chip-accent"}`}>{sub.status}</span>
                      {sub.kind === "api_usage" && <span className="chip chip-neutral ml-1">metered</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {sub.tier ? <span className="text-[12.5px] text-ink-3">{sub.tier}</span> : <span className="chip chip-unknown">tier to confirm</span>}
                      <AmountText amount={monthly} />
                    </span>
                  </div>
                  {sub.notes && <p className="text-[12px] text-ink-3">{sub.notes}</p>}
                  <SubscriptionConfirm sub={sub} editable={editable} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card testId="purchase-plans">
        <div className="flex items-baseline justify-between gap-2" id="plans">
          <p className="label">One-time purchases</p>
        </div>
        {v.purchasePlans.filter((x) => x.status !== "cancelled").length === 0 ? (
          <EmptyState title="No planned purchases">Hardware and furniture are dated one-time plans, not monthly allocations.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {v.purchasePlans.filter((x) => x.status !== "cancelled").map((plan) => (
              <li key={plan.id} className="py-2.5" data-testid={`plan-${plan.id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13.5px]">
                  <span>
                    {plan.name}{plan.quantity > 1 ? ` × ${plan.quantity}` : ""}
                    <span className="chip chip-neutral ml-2">{plan.category}</span>
                    <span className="chip chip-neutral ml-1">{plan.status}</span>
                    <span className="ml-2 text-[12px] text-ink-3">{plan.targetMonth ? monthLabel(plan.targetMonth) : "not scheduled"} · for {plan.beneficiary} · {plan.purpose === "unresolved" ? "purpose not decided" : plan.purpose}</span>
                  </span>
                  {plan.unitPriceCents === null ? <span className="chip chip-unknown">price unknown</span> : <Cents value={plan.unitPriceCents * plan.quantity + (plan.taxShippingCents ?? 0)} />}
                </div>
                {plan.specification && <p className="text-[12px] text-ink-3">{plan.specification}</p>}
                <PurchasePlanEditor payerSpaceId={space.id} persons={persons} editable={editable} existing={plan} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <PurchasePlanEditor payerSpaceId={space.id} persons={persons} editable={editable} />
        </div>
      </Card>

      <Card testId="projection">
        <p className="label">Recorded cash, projected on known lines</p>
        <p className="mb-2 mt-0.5 text-[12.5px] text-ink-3">Expected receipts minus known commitments and dated purchases. Unknown costs are absent, so the line is an upper bound.</p>
        <ProjectionChart points={v.projection.months.map((m) => ({ month: m.month, label: m.month.slice(5), before: m.endingCashCents }))} />
      </Card>

      <Card testId="company-accounts">
        <p className="label">Accounts</p>
        <ul className="mt-2 divide-y divide-line">
          {v.data.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-[13.5px]">
              <span>{a.name}<span className="ml-2 text-[12px] text-ink-3">{a.type.replace("_", " ")}</span></span>
              <AmountText amount={a.balance} />
            </li>
          ))}
        </ul>
        {v.reviewCount > 0 && <p className="mt-2 text-[12.5px] text-warn">{v.reviewCount} company payment{v.reviewCount === 1 ? "" : "s"} this month need{v.reviewCount === 1 ? "s" : ""} tax-treatment review. See <Link href="/activity?space=company&review=1" className="link">Activity</Link>.</p>}
      </Card>
    </div>
  );
}

// ---------- Household ----------

function HouseholdTab({ viewer }: { viewer: Viewer }) {
  const v: HouseholdView = buildHouseholdView(viewer);
  return (
    <div className="space-y-6" data-testid="tab-household-content">
      <p className="text-[13px] text-ink-3">{v.space.name} · {monthLabel(v.month)} · shared by both of you</p>
      <Card testId="household-company-paid">
        <p className="label">Paid by the company for the household</p>
        <p className="mt-1 text-[12.5px] text-ink-3">A benefit to the owners, not joint-account cash. Payer: company. Beneficiary: household. Tax treatment: review required.</p>
        <ul className="mt-2 divide-y divide-line">
          {v.companyPaidBills.map((b) => (
            <li key={b.id} className="flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
              <span>{b.name}<span className="ml-2 text-[12px] text-ink-3">{b.dueDay ? `due day ${b.dueDay}` : ""}{b.paid ? " · paid this month" : ""} · {TREATMENT_LABELS[b.treatment ?? "review_required"]}</span></span>
              {b.monthlyCents === null ? <span className="chip chip-unknown">Unknown</span> : <Cents value={b.monthlyCents} />}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-right text-[13px]">Known total <TotalText total={v.companyPaidTotal} size="sm" /></p>
      </Card>
      <Card testId="household-own-bills">
        <p className="label">Paid from the joint account</p>
        {v.ownBills.length === 0 ? (
          <EmptyState title="No joint bills recorded" />
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {v.ownBills.map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                <span>{b.name}<span className="ml-2 text-[12px] text-ink-3">{b.paid ? "paid this month" : "not yet paid"}</span></span>
                {b.monthlyCents === null ? <span className="chip chip-unknown">Unknown</span> : <Cents value={b.monthlyCents} />}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-right text-[13px]">Known total <TotalText total={v.ownBillsTotal} size="sm" /></p>
      </Card>
      <Card testId="household-cash">
        <div className="grid gap-x-6 sm:grid-cols-3">
          <Stat label="Joint account cash" note="Recorded, not reconciled."><TotalText total={v.cashTotal} size="lg" /></Stat>
          <Stat label="Groceries this month" note="Shared grocery entries from the joint account."><Cents value={v.groceriesThisMonthCents} className="hero-value" /></Stat>
          <Stat label="Funded by" note="Owner distributions from the company, recorded as shareholder distributions.">{viewer.assumptions.household.plannedCompanyDistributionCents === null ? <span className="chip chip-unknown">Planned amount not decided</span> : <Cents value={viewer.assumptions.household.plannedCompanyDistributionCents} className="hero-value" />}</Stat>
        </div>
        <ul className="mt-2 divide-y divide-line">
          {v.data.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-[13.5px]">
              <span>{a.name}</span>
              <AmountText amount={a.balance} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------- Partner summary ----------

function PartnerTab({ viewer }: { viewer: Viewer }) {
  const partner = viewer.persons.find((p) => p.id !== viewer.person?.id)!;
  const s = buildPartnerSummary(viewer, partner.id);
  const foodLabel: Record<string, string> = { no_target: "No target set", on_track: "On track", close: "Close to target", over: "Over target", not_shared: "Not shared" };
  const takeLabel: Record<string, string> = { verified: "Verified", estimate: "Estimate", incomplete: "Incomplete", not_shared: "Not shared" };
  return (
    <div className="space-y-6" data-testid="tab-partner-content">
      <p className="text-[13px] text-ink-3">{partner.name} · {monthLabel(s?.month ?? "")} · shared summary only</p>
      <Card testId="partner-summary">
        {!s || !s.shared ? (
          <EmptyState title={`${partner.name} is not sharing a summary`}>Only they can switch sharing on, from their own Settings.</EmptyState>
        ) : (
          <dl className="divide-y divide-line">
            <Line label="Food this month"><span className={`chip ${s.foodStatus === "over" ? "chip-bad" : s.foodStatus === "close" ? "chip-warn" : s.foodStatus === "on_track" ? "chip-good" : "chip-neutral"}`}>{foodLabel[s.foodStatus]}</span></Line>
            <Line label="Take-home status"><span className="chip chip-neutral">{takeLabel[s.takeHomeStatus]}</span></Line>
            <Line label="Savings and investment allocations">{s.savingsAllocationRoundedCents === null ? <span className="text-ink-3">None</span> : <span className="num">about {formatCents(s.savingsAllocationRoundedCents)}/mo</span>}</Line>
          </dl>
        )}
        <p className="mt-3 text-[12.5px] text-ink-3">Pre-approved aggregate fields only, at month granularity. No merchants, dates, categories or amounts of individual purchases are ever shown, and none leave the server.</p>
      </Card>
    </div>
  );
}
