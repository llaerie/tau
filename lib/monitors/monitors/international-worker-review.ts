/** Non-US workers whose cross-border professional review is not complete. */
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const internationalWorkerReview: Monitor = {
  key: "international_worker_review",
  description: "International workers whose classification / cross-border review is incomplete (professional decision, never AI).",
  run(ctx): AttentionItem[] {
    const { dataset, asOf } = ctx;
    const items: AttentionItem[] = [];
    for (const w of dataset.workers) {
      if (w.country === "US") continue;
      if (w.endDate && w.endDate < asOf) continue;
      const review = w.internationalReview;
      if (review?.status === "REVIEWED") continue;
      const openFields = review ? review.fields.filter((f) => f.status !== "CONFIRMED").length : null;
      items.push(
        makeItem(ctx, {
          kind: "international_worker_review",
          severity: "WARNING",
          title: `International worker review incomplete: ${w.displayName} (${w.country})`,
          detail: `${w.roleTitle}; worker type ${w.workerType}, classification ${w.classificationStatus}. ${review ? `Review status ${review.status}; ${openFields} of ${review.fields.length} facts unconfirmed (reviewer: ${review.reviewerRole}).` : "No cross-border review record exists."} Payments stay in the classification-pending account until a CPA/attorney decides.`,
          relatedIds: [w.id],
          suggestedTask: { kind: "payroll.international_review", params: { workerId: w.id } },
        }),
      );
    }
    return items;
  },
};
