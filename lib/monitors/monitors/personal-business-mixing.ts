/**
 * Potential personal / business mixing: POSSIBLE_PERSONAL flags, the review holding account, and
 * weekend restaurant / retail charges with no documented business purpose.
 */
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { isWeekend } from "@/lib/core/dates";
import { abs } from "@/lib/core/money";
import type { Transaction } from "@/lib/core/types";
import { isSpendOutflow, makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

const RETAIL_OR_RESTAURANT = /\b(restaurant|cafe|café|bistro|grill|diner|kitchen|pizza|sushi|bar|tavern|brew|coffee|starbucks|doordash|ubereats|grubhub|amazon|amzn|target|walmart|costco|best buy|ikea|nordstrom|macy|whole foods|trader joe|safeway|kroger|cvs|walgreens)\b/i;

function hasBusinessPurpose(t: Transaction): boolean {
  const meta = t.meta ?? {};
  if (typeof meta.businessPurpose === "string" && meta.businessPurpose.trim()) return true;
  if (Array.isArray(meta.attendees) && meta.attendees.length) return true;
  return /purpose|client|attendee|meeting|team/i.test(t.category.reason ?? "");
}

export const personalBusinessMixing: Monitor = {
  key: "personal_business_mixing",
  description: "Charges that may be personal: flagged at import, held in the review account, or weekend retail/restaurant spend without a business purpose.",
  run(ctx): AttentionItem[] {
    const { dataset, asOf } = ctx;
    const holding = accountIdForCode(ACCT.PERSONAL_REVIEW);
    const meals = accountIdForCode(ACCT.MEALS);
    const items: AttentionItem[] = [];
    for (const t of dataset.transactions) {
      if (t.date > asOf || !isSpendOutflow(t)) continue;
      const reasons: string[] = [];
      if (t.flags.includes("POSSIBLE_PERSONAL")) reasons.push("flagged POSSIBLE_PERSONAL at import");
      if (t.category.accountId === holding) reasons.push(`categorized to ${ACCT.PERSONAL_REVIEW} (personal/non-deductible review)`);
      const merchant = `${t.merchantNormalized ?? ""} ${t.descriptionRaw}`;
      if (isWeekend(t.date) && (t.category.accountId === meals || RETAIL_OR_RESTAURANT.test(merchant)) && !hasBusinessPurpose(t)) reasons.push("weekend restaurant/retail charge with no documented business purpose");
      if (!reasons.length) continue;
      items.push(
        makeItem(ctx, {
          kind: "personal_business_mixing",
          severity: "WARNING",
          title: `Possible personal charge: ${t.merchantNormalized ?? t.descriptionRaw} ${abs(t.amount)} on ${t.date}`,
          detail: `${reasons.join("; ")}. Business accounts pay business expenses only; the owner confirms the purpose (and attendees for meals) or the charge is treated as a shareholder draw. Never auto-deducted.`,
          amount: abs(t.amount),
          relatedIds: [t.id],
          suggestedTask: { kind: "controls.personal_business_check", params: { transactionId: t.id } },
        }),
      );
    }
    return items;
  },
};
