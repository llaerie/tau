/** Count of finance-bible setup items that are still UNCONFIRMED / PROFESSIONAL_REVIEW_REQUIRED. */
import { unknownsRegistry } from "@/lib/knowledge/finance-bible";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const financeSetupIncomplete: Monitor = {
  key: "finance_setup_incomplete",
  description: "Finance setup checklist items still unconfirmed (blocks capabilities until answered).",
  run(ctx): AttentionItem[] {
    const open = unknownsRegistry(ctx.bible).filter((u) => u.status !== "CONFIRMED");
    if (!open.length) return [];
    const byWho = new Map<string, number>();
    for (const u of open) byWho.set(u.whoCanAnswer, (byWho.get(u.whoCanAnswer) ?? 0) + 1);
    const blocked = new Set(open.flatMap((u) => u.blocksCapabilities));
    return [
      makeItem(ctx, {
        kind: "finance_setup_incomplete",
        severity: "INFO",
        title: `Finance setup incomplete: ${open.length} item(s) unconfirmed`,
        detail: `${[...byWho.entries()].map(([who, n]) => `${n} for ${who}`).join(", ")}. ${blocked.size} capabilit(ies) limited until answered. Top items: ${open.slice(0, 5).map((u) => u.label).join("; ")}.`,
        relatedIds: open.map((u) => u.fieldKey),
        sourceIds: [],
        suggestedTask: { kind: "cfo.config_status", params: {} },
      }),
    ];
  },
};
