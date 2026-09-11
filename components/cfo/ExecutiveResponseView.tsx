"use client";
import { useState } from "react";
import type { AgentResponse } from "@/lib/core/contracts";
import { Drawer } from "@/components/ui/Drawer";
import { Badge, RiskChip, StatusPill } from "@/components/ui/Badge";
import { KeyValue } from "@/components/ui/KeyValue";
import { Details } from "@/components/ui/Details";
import { pretty } from "@/lib/ui/serialize";

const SECTIONS: { key: keyof AgentResponse["response"]; label: string }[] = [
  { key: "answer", label: "Answer" },
  { key: "numbers", label: "Numbers" },
  { key: "why", label: "Why" },
  { key: "whatChanges", label: "What changes" },
  { key: "risks", label: "Risks" },
  { key: "recommendation", label: "Recommendation" },
  { key: "needsApproval", label: "Needs approval" },
  { key: "sourcesAndAssumptions", label: "Source & assumptions" },
];

function List({ items, empty }: { items: string[] | undefined; empty: string }) {
  if (!items || items.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-[13px]">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

export function ExecutiveResponseView({ res, compact = false }: { res: AgentResponse; compact?: boolean }) {
  const [wp, setWp] = useState(false);
  const r = res.response;
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <Badge tone="accent">{res.agent.replace(/_/g, " ")}</Badge>
          {res.delegatedTo?.length ? <span>→ {res.delegatedTo.join(", ")}</span> : null}
          <span>intent: {res.intent}</span>
          <span className="num">confidence {(res.confidence * 100).toFixed(0)}%</span>
        </div>
        <button onClick={() => setWp(true)} className="rounded-md border border-line-strong px-2 py-1 text-[12px] font-medium hover:bg-surface-2">
          Workpapers ({res.calculations.length} calc · {res.toolCalls.length} tools)
        </button>
      </div>

      {res.escalation ? (
        <div className="m-4 rounded-md border border-bad/40 bg-bad-soft p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-bad">Escalation · {res.escalation.type.replace(/_/g, " ")}</div>
          <p className="mt-1 text-[13px]">{res.escalation.message}</p>
          {res.escalation.requiredRole ? (
            <p className="mt-1 text-[12px] text-muted">
              Required role: <span className="mono">{res.escalation.requiredRole}</span>
            </p>
          ) : null}
          {res.escalation.missingItems?.length ? <List items={res.escalation.missingItems} empty="" /> : null}
          {res.escalation.relatedConfigKeys?.length ? (
            <p className="mt-1 text-[12px] text-muted">
              Related setup fields: <span className="mono">{res.escalation.relatedConfigKeys.join(", ")}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={`grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 ${compact ? "" : "md:grid-cols-2"}`}>
        {SECTIONS.map((sct) => {
          const label = <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{sct.label}</div>;
          if (sct.key === "answer")
            return (
              <div key={sct.key} className="md:col-span-2">
                {label}
                <p className="text-[15px] leading-relaxed">{r.answer}</p>
              </div>
            );
          if (sct.key === "recommendation")
            return (
              <div key={sct.key} className="md:col-span-2">
                {label}
                <p className="text-[13px]">{r.recommendation || "—"}</p>
              </div>
            );
          if (sct.key === "numbers")
            return (
              <div key={sct.key}>
                {label}
                {r.numbers.length === 0 ? (
                  <p className="text-[13px] text-muted">No figures.</p>
                ) : (
                  <table className="w-full text-[13px]">
                    <tbody>
                      {r.numbers.map((n, i) => (
                        <tr key={i} className="border-b border-line last:border-0">
                          <td className="py-1 pr-2 text-muted">
                            {n.label}
                            {n.note ? <div className="text-[11px] text-faint">{n.note}</div> : null}
                          </td>
                          <td className="num py-1 text-right font-medium">{n.value}</td>
                          <td className="py-1 pl-2 text-right">{n.calcId ? <span className="mono text-faint">{n.calcId.slice(0, 12)}</span> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          if (sct.key === "needsApproval")
            return (
              <div key={sct.key}>
                {label}
                {r.needsApproval.length === 0 ? (
                  <p className="text-[13px] text-muted">No approval required.</p>
                ) : (
                  <ul className="space-y-1.5 text-[13px]">
                    {r.needsApproval.map((n, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-2 py-1.5">
                        <RiskChip level={n.riskLevel} />
                        <span className="min-w-0 flex-1">{n.description}</span>
                        <span className="text-[11px] text-muted">{n.approverRoles.join(" / ")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          const items = r[sct.key] as string[];
          return (
            <div key={sct.key}>
              {label}
              <List items={items} empty="—" />
            </div>
          );
        })}

        {r.highRisk ? (
          <div className="md:col-span-2 rounded-md border border-warn/40 bg-warn-soft/50 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-warn">High-risk answer — separated by nature</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["FACT", r.highRisk.facts],
                  ["CALCULATION", r.highRisk.calculations],
                  ["ASSUMPTION", r.highRisk.assumptions],
                  ["PROFESSIONAL JUDGMENT", r.highRisk.professionalJudgment],
                ] as const
              ).map(([t, items]) => (
                <div key={t}>
                  <div className="text-[11px] font-semibold text-muted">{t}</div>
                  <List items={[...items]} empty="none" />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {r.education ? (
          <div className="md:col-span-2 rounded-md border border-line bg-surface-2 p-3 text-[13px]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Education · {r.education.title}</div>
            <p className="mt-1">{r.education.text}</p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
        <span>
          model <span className="mono">{res.model.provider}/{res.model.model}</span>
          {res.model.deterministic ? " (deterministic)" : ""}
        </span>
        <span>
          audit <span className="mono">{res.auditEventId}</span>
        </span>
        <span className="num">{res.durationMs} ms</span>
        {res.agentActions.length ? <span>{res.agentActions.length} governed actions</span> : null}
      </div>

      <Drawer open={wp} onClose={() => setWp(false)} title="Workpapers" width="max-w-2xl">
        <div className="space-y-4">
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Calculations ({res.calculations.length})</h4>
            {res.calculations.length === 0 ? <p className="text-[13px] text-muted">No calculations were produced.</p> : null}
            <div className="space-y-2">
              {res.calculations.map((c) => (
                <Details key={c.id} summary={<span>{c.name} <span className="mono text-faint">{c.id}</span></span>}>
                  <KeyValue
                    dense
                    items={[
                      { k: "Value", v: <span className="num">{typeof c.value === "object" ? pretty(c.value) : String(c.value)} {c.unit}</span> },
                      { k: "Formula", v: c.formula, mono: true },
                      { k: "Inputs", v: <pre className="mono whitespace-pre-wrap text-[11px]">{pretty(c.inputs)}</pre> },
                      { k: "Sources", v: c.sourceIds.length ? c.sourceIds.join(", ") : "—", mono: true },
                      { k: "Assumptions", v: c.assumptions.length ? <List items={c.assumptions.map((a) => `${a.description} [${a.status}]`)} empty="" /> : "none" },
                      { k: "As of", v: c.asOfDate },
                    ]}
                  />
                </Details>
              ))}
            </div>
          </section>
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Tool calls ({res.toolCalls.length})</h4>
            {res.toolCalls.length === 0 ? (
              <p className="text-[13px] text-muted">No tools were called.</p>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Risk</th>
                    <th>OK</th>
                    <th className="r">ms</th>
                  </tr>
                </thead>
                <tbody>
                  {res.toolCalls.map((t, i) => (
                    <tr key={i}>
                      <td className="mono">{t.name}</td>
                      <td>
                        <RiskChip level={t.riskLevel} />
                      </td>
                      <td>{t.ok ? "yes" : `no${t.error ? ` — ${t.error}` : ""}`}</td>
                      <td className="r">{t.durationMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Sources ({res.sources.length})</h4>
            <ul className="space-y-1 text-[13px]">
              {res.sources.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <Badge>{s.kind}</Badge>
                  <span>{s.label}</span>
                  <span className="mono text-faint">{s.id}</span>
                  {s.status ? <StatusPill status={s.status} /> : null}
                </li>
              ))}
              {res.sources.length === 0 ? <li className="text-muted">No sources cited.</li> : null}
            </ul>
          </section>
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Assumptions ({res.assumptions.length})</h4>
            <List items={res.assumptions.map((a) => `${a.description} [${a.status}]${a.requiresProfessionalReview ? " — professional review required" : ""}`)} empty="No assumptions." />
          </section>
          {res.agentActions.length ? (
            <section>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Governed actions</h4>
              <ul className="space-y-1 text-[13px]">
                {res.agentActions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <RiskChip level={a.risk.level} />
                    <StatusPill status={a.status} />
                    <span>{a.action.kind}</span>
                    <span className="text-muted">{a.action.description}</span>
                    {a.blockedReason ? <span className="text-bad">{a.blockedReason}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Model & audit</h4>
            <KeyValue dense items={[{ k: "Provider", v: res.model.provider }, { k: "Model", v: res.model.model, mono: true }, { k: "Deterministic", v: res.model.deterministic ? "yes" : "no" }, { k: "Audit event", v: res.auditEventId, mono: true }, { k: "Duration", v: `${res.durationMs} ms` }]} />
          </section>
          <Details summary="Structured payload">
            <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap text-[11px]">{pretty(res.structured)}</pre>
          </Details>
        </div>
      </Drawer>
    </div>
  );
}
