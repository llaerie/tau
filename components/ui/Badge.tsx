import type { ReactNode } from "react";
import type { RiskLevel } from "@/lib/core/types";

export type BadgeTone = "neutral" | "ok" | "warn" | "bad" | "accent" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  ok: "bg-ok-soft text-ok border-ok/30",
  warn: "bg-warn-soft text-warn border-warn/30",
  bad: "bg-bad-soft text-bad border-bad/30",
  accent: "bg-accent-soft text-accent border-accent/30",
  info: "bg-surface-2 text-fg border-line-strong",
};

export function Badge({ children, tone = "neutral", className = "", title }: { children: ReactNode; tone?: BadgeTone; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-[1px] text-[11px] font-semibold uppercase tracking-wide ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function RiskChip({ level, className = "" }: { level: RiskLevel | string | null | undefined; className?: string }) {
  const tone: BadgeTone = level === "GREEN" ? "ok" : level === "YELLOW" ? "warn" : level === "RED" ? "bad" : "neutral";
  return (
    <Badge tone={tone} className={className}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${level === "GREEN" ? "bg-ok" : level === "YELLOW" ? "bg-warn" : level === "RED" ? "bg-bad" : "bg-faint"}`} />
      {level ?? "—"}
    </Badge>
  );
}

const OK = new Set(["CONFIRMED", "APPROVED", "POSTED", "PAID", "RECONCILED", "MATCHED", "EXECUTED", "CURRENT", "ACTIVE", "OPEN", "PASSED", "PASS", "REVIEWED", "ON_FILE", "FILED", "RESOLVED", "GREEN", "VALID", "CONNECTED", "COMPLETE", "SIMULATED", "NOT_REQUIRED"]);
const WARN = new Set(["UNCONFIRMED", "PENDING", "PENDING_APPROVAL", "AWAITING_APPROVAL", "PROPOSED", "DRAFT", "SUGGESTED", "SOFT_CLOSED", "SCHEDULED", "SENT", "PARTIALLY_PAID", "IN_REVIEW", "REQUESTED", "STALE", "PENDING_RETRIEVAL", "UPCOMING", "DUE", "UNRECONCILED", "VARIANCE", "YELLOW", "WARNING", "ACCRUED", "EXPECTED", "MEDIUM", "HIGH", "CONFIGURED_NOT_CONNECTED", "NOT_REQUESTED", "UNKNOWN"]);
const BAD = new Set(["PROFESSIONAL_REVIEW_REQUIRED", "REJECTED", "BLOCKED", "FAILED", "OVERDUE", "VOID", "EXPIRED", "DISPUTED", "DUPLICATE", "UNCATEGORIZED", "UNRESOLVED_PROFESSIONAL_REVIEW", "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED", "EXCEPTION", "RED", "ERROR", "BLOCKING", "LOCKED", "ROLLED_BACK", "NOT_CONNECTED", "INVALID", "BROKEN", "REVERSED"]);
const INFO = new Set(["SUPERSEDED", "WITHDRAWN", "NOT_APPLICABLE_PENDING_REVIEW", "INFO", "LOW", "ASSUMED", "READ_ONLY", "SHADOW"]);

export function toneForStatus(status: string | null | undefined): BadgeTone {
  if (!status) return "neutral";
  const s = status.toUpperCase();
  if (OK.has(s)) return "ok";
  if (WARN.has(s)) return "warn";
  if (BAD.has(s)) return "bad";
  if (INFO.has(s)) return "info";
  return "neutral";
}

export function StatusPill({ status, label, className = "" }: { status: string | null | undefined; label?: string; className?: string }) {
  const tone = toneForStatus(status);
  const text = label ?? (status ? status.replace(/_/g, " ") : "—");
  return (
    <Badge tone={tone} className={className} title={status ?? undefined}>
      {text}
    </Badge>
  );
}
