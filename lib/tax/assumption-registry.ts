/**
 * Tax assumption registry — every assumption that could influence a tax figure is recorded
 * with a status and whether professional review is required before it may drive an action.
 */
import type { Assumption, FieldStatus, ISODateTime } from "@/lib/core/types";
import { nowISO } from "@/lib/core/dates";

export interface TaxAssumption extends Assumption {
  id: string;
  taxYear: number | null;
  createdAt: ISODateTime;
  createdBy: string;
  resolvedAt?: ISODateTime;
  resolvedBy?: string;
  note?: string;
  supersedesId?: string;
}

export interface NewTaxAssumptionInput {
  key: string;
  description: string;
  value: unknown;
  status?: FieldStatus;
  taxYear?: number | null;
  sourceId?: string;
  requiresProfessionalReview?: boolean;
  createdBy: string;
  note?: string;
  id?: string;
  at?: ISODateTime;
}

export class TaxAssumptionRegistry {
  private readonly items = new Map<string, TaxAssumption>();

  constructor(seed: TaxAssumption[] = []) {
    for (const a of seed) this.items.set(a.id, a);
  }

  add(input: NewTaxAssumptionInput): TaxAssumption {
    const status = input.status ?? "UNCONFIRMED";
    if (status === "CONFIRMED" && (input.value === null || input.value === undefined)) throw new Error("A CONFIRMED assumption must carry a value");
    const a: TaxAssumption = {
      id: input.id ?? `tax_assump_${input.key}_${input.taxYear ?? "any"}_${this.items.size + 1}`,
      key: input.key,
      description: input.description,
      value: input.value ?? null,
      status,
      taxYear: input.taxYear ?? null,
      sourceId: input.sourceId,
      requiresProfessionalReview: input.requiresProfessionalReview ?? status === "PROFESSIONAL_REVIEW_REQUIRED",
      createdAt: input.at ?? nowISO(),
      createdBy: input.createdBy,
      note: input.note,
    };
    this.items.set(a.id, a);
    return a;
  }

  get(id: string): TaxAssumption | undefined {
    return this.items.get(id);
  }

  byKey(key: string, taxYear?: number | null): TaxAssumption | undefined {
    return this.list({ key, taxYear }).find((a) => a.status !== "SUPERSEDED");
  }

  list(filter?: { key?: string; taxYear?: number | null; status?: FieldStatus; requiresProfessionalReview?: boolean }): TaxAssumption[] {
    return Array.from(this.items.values()).filter(
      (a) =>
        (!filter?.key || a.key === filter.key) &&
        (filter?.taxYear === undefined || a.taxYear === filter.taxYear || a.taxYear === null) &&
        (!filter?.status || a.status === filter.status) &&
        (filter?.requiresProfessionalReview === undefined || a.requiresProfessionalReview === filter.requiresProfessionalReview),
    );
  }

  /** Confirm an assumption (by a human). The old record is superseded and a new one created. */
  confirm(id: string, value: unknown, resolvedBy: string, at: ISODateTime = nowISO()): TaxAssumption {
    const old = this.require(id);
    if (value === null || value === undefined) throw new Error("Cannot confirm an assumption with a null value");
    const superseded: TaxAssumption = { ...old, status: "SUPERSEDED", resolvedAt: at, resolvedBy };
    this.items.set(id, superseded);
    const next: TaxAssumption = { ...old, id: `${id}_c${this.items.size}`, value, status: "CONFIRMED", requiresProfessionalReview: false, createdAt: at, createdBy: resolvedBy, supersedesId: id };
    this.items.set(next.id, next);
    return next;
  }

  markProfessionalReview(id: string, note?: string): TaxAssumption {
    const old = this.require(id);
    const next: TaxAssumption = { ...old, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true, note: note ?? old.note };
    this.items.set(id, next);
    return next;
  }

  /** Whether any current assumption blocks autonomous action. */
  blocking(): TaxAssumption[] {
    return this.list().filter((a) => a.status !== "SUPERSEDED" && a.status !== "CONFIRMED" && a.requiresProfessionalReview);
  }

  toAssumptions(): Assumption[] {
    return this.list()
      .filter((a) => a.status !== "SUPERSEDED")
      .map(({ key, description, value, status, sourceId, requiresProfessionalReview }) => ({ key, description, value, status, sourceId, requiresProfessionalReview }));
  }

  private require(id: string): TaxAssumption {
    const a = this.items.get(id);
    if (!a) throw new Error(`Unknown tax assumption: ${id}`);
    return a;
  }
}

/** Default assumptions for the real company. Values are proposals or null; none is confirmed. */
export function seedDefaultTaxAssumptions(createdBy = "SYSTEM_PHASE_ONE", at: ISODateTime = "2026-09-09T00:00:00.000Z"): TaxAssumption[] {
  const r = new TaxAssumptionRegistry();
  r.add({ id: "tax_assump_owner_salary", key: "owner_salary_gross_monthly", description: "Owner salary proposed at 3000.00 gross/month; reasonable compensation is a professional judgment.", value: "3000.00", status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true, createdBy, at });
  r.add({ id: "tax_assump_related_party_revenue", key: "related_party_revenue", description: "Primary revenue payer is associated with the CEO's father; treatment and disclosure require CPA review.", value: true, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true, createdBy, at });
  r.add({ id: "tax_assump_workforce_basis", key: "workforce_allocation_basis", description: "Basis of the ~8000.00/month workforce allocation (gross/net/contractor/employer cost) is unknown.", value: null, status: "UNCONFIRMED", requiresProfessionalReview: false, createdBy, at });
  r.add({ id: "tax_assump_china_classification", key: "china_worker_classification", description: "Classification of the two China-based workers is unresolved and requires cross-border professional review.", value: null, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true, createdBy, at });
  r.add({ id: "tax_assump_fiancee_comp", key: "fiancee_compensation_gross_monthly", description: "Fiancée compensation for legitimate work proposed at 3000.00 gross/month; related party; unconfirmed.", value: "3000.00", status: "UNCONFIRMED", requiresProfessionalReview: true, createdBy, at });
  r.add({ id: "tax_assump_accounting_method", key: "accounting_method", description: "Tax accounting method (cash/accrual) unknown until prior returns are reviewed.", value: null, status: "UNCONFIRMED", requiresProfessionalReview: true, createdBy, at });
  return r.list();
}
