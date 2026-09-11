import type { Metric } from "@/lib/finance/types";
import { TotalText } from "./Money";
import { ProvenanceButton } from "./Provenance";

export function MetricCard({ metric, hint, tone, testId }: { metric: Metric; hint?: string; tone?: "good" | "warn" | "bad"; testId?: string }) {
  const shortfall = metric.total.complete && metric.total.knownCents < 0;
  const t = tone ?? (shortfall ? "bad" : undefined);
  return (
    <div className="card flex flex-col gap-1.5 p-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12.5px] font-medium text-ink-2">{metric.label}</p>
        {t && <span className={`chip chip-${t}`}>{t === "bad" ? "Shortfall" : t === "warn" ? "Attention" : "On track"}</span>}
      </div>
      <TotalText total={metric.total} size="lg" className={shortfall ? "text-bad" : ""} />
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
      <div className="mt-auto pt-1">
        <ProvenanceButton provenance={metric.provenance} label={metric.label} />
      </div>
    </div>
  );
}
