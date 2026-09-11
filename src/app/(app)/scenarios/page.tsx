import { desc, eq } from "drizzle-orm";
import { ProjectionChart } from "@/components/charts/ProjectionChart";
import { ScenarioForm, DeleteScenarioButton } from "@/components/forms/ScenarioForm";
import { Cents } from "@/components/Money";
import { Card, EmptyState, Notice, PageHeader, Section, shortMonth } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { canView } from "@/lib/auth/authorize";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { evaluatePurchase, type ScenarioResult } from "@/lib/finance/scenario";
import { buildSpaceView } from "@/lib/views";
import { scenarioBaseline } from "@/lib/views/scenario";

export const metadata = { title: "Scenarios" };

const VERDICT: Record<ScenarioResult["verdict"], { label: string; chip: string }> = {
  affordable: { label: "Affordable", chip: "chip-good" },
  affordable_with_goal_cuts: { label: "Affordable, but the plan slips", chip: "chip-warn" },
  creates_shortfall: { label: "Creates a shortfall", chip: "chip-bad" },
  unknown: { label: "Cannot tell yet", chip: "chip-unknown" },
};

export default async function ScenariosPage() {
  const viewer = await requireViewer();
  const saved = getDb().select().from(s.scenarios).where(eq(s.scenarios.workspaceId, viewer.workspace.id)).orderBy(desc(s.scenarios.createdAt)).all().filter((sc) => canView(viewer, sc.spaceId));
  const views = new Map(viewer.spaces.map((sp) => [sp.id, buildSpaceView(viewer, sp.id)]));
  const evaluated = saved.map((sc) => ({ sc, result: evaluatePurchase(scenarioBaseline(views.get(sc.spaceId)!), { name: sc.name, amountCents: sc.amountCents, kind: sc.kind, recurringMonths: sc.recurringMonths, startMonthOffset: sc.startMonthOffset }) }));

  return (
    <>
      <PageHeader eyebrow="What if" title="Purchase scenarios" description="A proposed purchase applied to one space. Recurring costs come out of the money that funds goals, lowest priority first; one-time purchases come out of cash. Nothing is re-tuned to make it fit." />
      <Section title="Propose a purchase">
        <Card>
          <ScenarioForm spaces={viewer.spaces.map((sp) => ({ id: sp.id, name: sp.name }))} />
        </Card>
      </Section>

      <Section title="Results" description="Deterministic. Every figure comes from the same functions as the dashboards.">
        {evaluated.length === 0 ? (
          <EmptyState title="No scenarios yet">Propose a purchase above to see how it changes cash and goals.</EmptyState>
        ) : (
          <div className="space-y-4">
            {evaluated.map(({ sc, result: r }) => {
              const v = VERDICT[r.verdict];
              const points = r.before.projection.months.map((m, i) => ({ month: m.month, label: shortMonth(m.month), before: m.endingCashCents, after: r.after.projection.months[i].endingCashCents }));
              return (
                <Card key={sc.id} testId="scenario-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight">{sc.name}</h3>
                      <p className="text-sm text-ink-2">
                        <Cents value={sc.amountCents} /> {sc.kind === "one_time" ? "one time" : `a month${sc.recurringMonths ? ` for ${sc.recurringMonths} months` : ", ongoing"}`} · {viewer.spaces.find((x) => x.id === sc.spaceId)?.name}
                        {sc.startMonthOffset > 0 && ` · starts in ${sc.startMonthOffset} month(s)`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`chip ${v.chip}`} data-testid="scenario-verdict">{v.label}</span>
                      <DeleteScenarioButton id={sc.id} />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                    <div className="min-w-0">
                      {points[0].before !== null ? <ProjectionChart points={points} floorCents={r.breachesFloor ? (scenarioBaseline(views.get(sc.spaceId)!).cashFloorCents ?? 0) : null} beforeLabel="Without" afterLabel="With purchase" /> : <Notice tone="unknown">Starting cash is unknown, so the cash path cannot be drawn.</Notice>}
                      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                        <div><dt className="label">Lowest cash, before</dt><dd className="num">{r.minCashBeforeCents === null ? "Unknown" : <Cents value={r.minCashBeforeCents} />}</dd></div>
                        <div><dt className="label">Lowest cash, after</dt><dd className="num">{r.minCashAfterCents === null ? "Unknown" : <Cents value={r.minCashAfterCents} className={r.minCashAfterCents < 0 ? "text-bad" : ""} />}</dd></div>
                        <div><dt className="label">Cash change</dt><dd className="num">{r.endingCashDeltaCents === null ? "Unknown" : <Cents value={r.endingCashDeltaCents} signed />}</dd></div>
                        <div><dt className="label">Monthly cost</dt><dd className="num"><Cents value={r.monthlyCostCents} /></dd></div>
                      </dl>
                    </div>
                    <div className="min-w-0">
                      <p className="label">Goal impact</p>
                      {r.goalImpacts.length === 0 ? (
                        <p className="mt-1 text-sm text-ink-3">No goals in this space.</p>
                      ) : (
                        <div className="table-wrap mt-1">
                          <table className="data">
                            <thead><tr><th>Goal</th><th className="r">Before</th><th className="r">After</th><th>Delay</th></tr></thead>
                            <tbody>
                              {r.goalImpacts.map((g) => (
                                <tr key={g.goalId}>
                                  <td>{g.priority}. {g.name}</td>
                                  <td className="r"><Cents value={g.fundedBeforeCents} /></td>
                                  <td className="r"><Cents value={g.fundedAfterCents} className={g.fundedAfterCents < g.fundedBeforeCents ? "text-bad" : ""} /></td>
                                  <td>{g.delayMonths === Infinity ? <span className="chip chip-bad">never reaches target</span> : g.delayMonths ? <span className="chip chip-warn">+{g.delayMonths} mo</span> : g.fundedAfterCents < g.fundedBeforeCents ? <span className="chip chip-warn">less funding</span> : <span className="chip chip-neutral">none</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
                        {r.notes.map((n, i) => <li key={i}>{n}</li>)}
                      </ul>
                      <p className="mt-3 text-xs text-ink-3">Assumptions: {r.assumptions.join(" ")}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}
