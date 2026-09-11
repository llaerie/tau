/** Related-party customers, workers and flagged transactions that lack a written contract on file. */
import type { CompanyDataset, Customer, Worker } from "@/lib/core/types";
import { abs, add } from "@/lib/core/money";
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

function customerHasContract(ds: CompanyDataset, c: Customer): boolean {
  return (!!c.contractDocumentId && ds.documents.some((d) => d.id === c.contractDocumentId)) || ds.documents.some((d) => d.kind === "CONTRACT" && d.customerId === c.id);
}
function workerHasContract(ds: CompanyDataset, w: Worker): boolean {
  return ds.documents.some((d) => d.kind === "CONTRACT" && (d.workerId === w.id || w.documentIds.includes(d.id)));
}

export const relatedPartyFlow: Monitor = {
  key: "related_party_flow",
  description: "Related-party revenue, compensation or payments without a written contract on file (CPA disclosure).",
  run(ctx): AttentionItem[] {
    const { dataset, asOf } = ctx;
    const items: AttentionItem[] = [];
    const contractTask = (targetId: string) => ({ kind: "documents.missing", params: { asOf, targetId } });

    for (const c of dataset.customers) {
      if (!c.relatedParty || customerHasContract(dataset, c)) continue;
      const invoices = dataset.invoices.filter((i) => i.customerId === c.id && i.status !== "VOID");
      const total = invoices.reduce((acc, i) => add(acc, i.total), "0.0000");
      items.push(
        makeItem(ctx, {
          kind: "related_party_flow",
          severity: "WARNING",
          title: `Related-party customer ${c.name} has no contract on file`,
          detail: `${invoices.length} invoice(s) totalling ${total}. ${c.relatedPartyNote ?? "Related party."} Written terms are required for CPA disclosure; whether the arrangement is acceptable is professional judgment.`,
          amount: total,
          relatedIds: [c.id],
          sourceIds: [c.id, ...invoices.map((i) => i.id)],
          suggestedTask: contractTask(c.id),
        }),
      );
    }
    for (const w of dataset.workers) {
      if (!w.relatedParty || w.isOwner || workerHasContract(dataset, w)) continue;
      items.push(
        makeItem(ctx, {
          kind: "related_party_flow",
          severity: "WARNING",
          title: `Related-party worker ${w.displayName} has no contract on file`,
          detail: `${w.roleTitle}; compensation ${w.compensation.amount} ${w.compensation.period} (${w.compensation.status}). ${w.relatedPartyNote ?? "Related party."} Document the role and terms for CPA disclosure.`,
          relatedIds: [w.id],
          suggestedTask: contractTask(w.id),
        }),
      );
    }
    const byCounterparty = new Map<string, { ids: string[]; total: string }>();
    for (const t of dataset.transactions) {
      if (!t.flags.includes("RELATED_PARTY") || t.date > asOf) continue;
      const ref = t.counterpartyRef;
      const key = ref ? `${ref.type}:${ref.id}` : `UNKNOWN:${t.merchantNormalized ?? t.descriptionRaw}`;
      const covered = ref?.type === "CUSTOMER" ? dataset.customers.some((c) => c.id === ref.id && customerHasContract(dataset, c)) : ref?.type === "EMPLOYEE" || ref?.type === "CONTRACTOR" || ref?.type === "OWNER" ? dataset.workers.some((w) => w.id === ref.id && workerHasContract(dataset, w)) : false;
      if (covered) continue;
      const cur = byCounterparty.get(key) ?? { ids: [], total: "0.0000" };
      cur.ids.push(t.id);
      cur.total = add(cur.total, abs(t.amount));
      byCounterparty.set(key, cur);
    }
    for (const [key, v] of [...byCounterparty.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      items.push(
        makeItem(ctx, {
          kind: "related_party_flow",
          severity: "WARNING",
          title: `${v.ids.length} related-party transaction(s) with ${key} lack a contract`,
          detail: `Total ${v.total} flagged RELATED_PARTY without written terms on file. Tracked separately and disclosed to the CPA.`,
          amount: v.total,
          relatedIds: [key.split(":")[1] ?? key, ...v.ids],
          sourceIds: v.ids,
          suggestedTask: contractTask(key),
        }),
      );
    }
    return items;
  },
};
