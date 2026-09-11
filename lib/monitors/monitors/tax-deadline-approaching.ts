/**
 * Tax obligations due within 30 days (or overdue). Obligations whose due date is unknown are
 * summarised in ONE informational item — the system never invents a due date.
 */
import { daysBetween } from "@/lib/core/dates";
import { PENDING_DUE_DATE_NOTE } from "@/lib/tax/calendar";
import { makeItem, taxObligationsFor } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const TAX_LOOKAHEAD_DAYS = 30;
export const TAX_DUE_DATES_PENDING_TITLE = `Tax ${PENDING_DUE_DATE_NOTE}`;

const OPEN_STATUSES = new Set(["UPCOMING", "DUE", "UNKNOWN"]);

export const taxDeadlineApproaching: Monitor = {
  key: "tax_deadline_approaching",
  description: "Tax obligations due within 30 days; obligations with unknown due dates reported as pending (never guessed).",
  run(ctx): AttentionItem[] {
    const { asOf } = ctx;
    const obligations = taxObligationsFor(ctx.dataset, ctx.taxRules, asOf).filter((o) => OPEN_STATUSES.has(o.status));
    const items: AttentionItem[] = [];
    for (const o of obligations) {
      if (o.dueDate === null) continue;
      const days = daysBetween(asOf, o.dueDate);
      if (days > TAX_LOOKAHEAD_DAYS) continue;
      items.push(
        makeItem(ctx, {
          kind: "tax_deadline_approaching",
          severity: days < 0 || days <= 7 ? "CRITICAL" : "WARNING",
          title: days < 0 ? `${o.title} was due ${o.dueDate}` : `${o.title} due ${o.dueDate} (${days} day(s))`,
          detail: `${o.jurisdiction} ${o.kind}${o.periodLabel ? ` ${o.periodLabel}` : ""} tax year ${o.taxYear}. Amount ${o.amount ?? "UNKNOWN"}. ${o.requiresCpaReview ? "CPA review required; filing and payment are never executed by the system." : ""}`,
          amount: o.amount ?? undefined,
          dueDate: o.dueDate,
          relatedIds: [o.id, ...(o.ruleSourceId ? [o.ruleSourceId] : [])],
          suggestedTask: { kind: "tax.calendar", params: { taxYear: o.taxYear, asOf } },
        }),
      );
    }
    const unknown = obligations.filter((o) => o.dueDate === null);
    if (unknown.length) {
      items.push(
        makeItem(ctx, {
          kind: "tax_deadline_approaching",
          severity: "INFO",
          title: TAX_DUE_DATES_PENDING_TITLE,
          detail: `${unknown.length} obligation(s) have no usable due-date rule: ${unknown.map((o) => `${o.kind}${o.periodLabel ? ` ${o.periodLabel}` : ""} (${o.taxYear})`).join(", ")}. Due dates come only from retrieved authoritative sources confirmed by the CPA.`,
          relatedIds: unknown.map((o) => o.id),
          suggestedTask: { kind: "tax.calendar", params: { asOf } },
        }),
      );
    }
    return items;
  },
};
