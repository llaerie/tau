/**
 * Layer B — Professional guidance store.
 *
 * Guidance (CPA memos, attorney letters, payroll-professional instructions) enters as
 * PENDING_APPROVAL, is approved by an authorized human, and may then be promoted into a
 * versioned company Policy. Seeded with ZERO real guidance; one clearly labelled
 * synthetic memo exists so the pipeline is exercised in the lab.
 */
import type { Actor, ISODate, ISODateTime, Policy, ProfessionalGuidance, Role } from "@/lib/core/types";
import { nowISO } from "@/lib/core/dates";
import { deterministicId, newId } from "@/lib/core/ids";

export const SYNTHETIC_GUIDANCE_PREFIX = "[SYNTHETIC LAB EXAMPLE]";
export const GUIDANCE_APPROVER_ROLES: Role[] = ["OWNER", "CPA", "ATTORNEY", "PAYROLL_PROFESSIONAL"];
const PROFESSIONAL_AUTHOR_ROLES: Role[] = ["CPA", "ATTORNEY", "PAYROLL_PROFESSIONAL", "AUDITOR"];

export interface NewGuidanceInput {
  authorRole: Role;
  authorName?: string;
  title: string;
  body: string;
  appliesTo: string[];
  receivedAt?: ISODateTime;
  documentId?: string;
  id?: string;
}

export class GuidanceStore {
  private readonly items = new Map<string, ProfessionalGuidance>();

  constructor(seed: ProfessionalGuidance[] = []) {
    for (const g of seed) this.items.set(g.id, g);
  }

  /** Register received guidance. Always PENDING_APPROVAL; agents may never author guidance. */
  add(input: NewGuidanceInput): ProfessionalGuidance {
    if (!PROFESSIONAL_AUTHOR_ROLES.includes(input.authorRole)) {
      throw new Error(`Guidance must come from a professional role (got ${input.authorRole})`);
    }
    const g: ProfessionalGuidance = {
      id: input.id ?? newId("guid"),
      authorRole: input.authorRole,
      authorName: input.authorName,
      title: input.title,
      body: input.body,
      receivedAt: input.receivedAt ?? nowISO(),
      appliesTo: [...input.appliesTo],
      status: "PENDING_APPROVAL",
      documentId: input.documentId,
    };
    this.items.set(g.id, g);
    return g;
  }

  approve(id: string, approver: Actor, at: ISODateTime = nowISO()): ProfessionalGuidance {
    const g = this.require(id);
    if (g.status !== "PENDING_APPROVAL") throw new Error(`Guidance ${id} is ${g.status}; only PENDING_APPROVAL can be approved`);
    if (approver.type === "AGENT" || !GUIDANCE_APPROVER_ROLES.includes(approver.role)) {
      throw new Error(`Role ${approver.role} (${approver.type}) may not approve professional guidance`);
    }
    const next: ProfessionalGuidance = { ...g, status: "ACTIVE", approvedAt: at, approvedBy: `${approver.role}:${approver.id}` };
    this.items.set(id, next);
    return next;
  }

  reject(id: string, actor: Actor): ProfessionalGuidance {
    const g = this.require(id);
    if (actor.type === "AGENT") throw new Error("Agents may not reject guidance");
    const next: ProfessionalGuidance = { ...g, status: "REJECTED" };
    this.items.set(id, next);
    return next;
  }

  /** Replace an ACTIVE guidance with a newer one (new one starts PENDING_APPROVAL). */
  supersede(oldId: string, replacement: NewGuidanceInput): { superseded: ProfessionalGuidance; replacement: ProfessionalGuidance } {
    const old = this.require(oldId);
    const next = this.add(replacement);
    const withLink: ProfessionalGuidance = { ...next, supersedesId: oldId };
    this.items.set(next.id, withLink);
    const superseded: ProfessionalGuidance = { ...old, status: "SUPERSEDED" };
    this.items.set(oldId, superseded);
    return { superseded, replacement: withLink };
  }

  get(id: string): ProfessionalGuidance | undefined {
    return this.items.get(id);
  }
  require(id: string): ProfessionalGuidance {
    const g = this.items.get(id);
    if (!g) throw new Error(`Unknown guidance: ${id}`);
    return g;
  }
  list(filter?: { status?: ProfessionalGuidance["status"]; appliesTo?: string }): ProfessionalGuidance[] {
    return Array.from(this.items.values()).filter(
      (g) => (!filter?.status || g.status === filter.status) && (!filter?.appliesTo || g.appliesTo.includes(filter.appliesTo)),
    );
  }
  active(): ProfessionalGuidance[] {
    return this.list({ status: "ACTIVE" });
  }
  all(): ProfessionalGuidance[] {
    return Array.from(this.items.values());
  }
}

// ---------------------------------------------------------------------------
// Promotion to policy
// ---------------------------------------------------------------------------

export interface PromotionResult {
  policy: Policy;
  supersededPolicies: Policy[];
  /** Full policy list with superseded versions retained. */
  policies: Policy[];
}

/**
 * Promote approved guidance into a versioned company Policy.
 * - guidance must be ACTIVE; approver must be a human in an approver role
 * - new version = max existing version for the key + 1, status ACTIVE
 * - prior ACTIVE/DRAFT versions of the same key become SUPERSEDED (kept)
 */
export function promoteGuidanceToPolicy(
  guidance: ProfessionalGuidance,
  approver: Actor,
  opts: { policyKey: string; title?: string; existingPolicies?: Policy[]; effectiveDate?: ISODate; parameters?: Record<string, unknown> },
): PromotionResult {
  if (guidance.status !== "ACTIVE") throw new Error(`Guidance ${guidance.id} must be ACTIVE to promote (is ${guidance.status})`);
  if (approver.type === "AGENT" || !GUIDANCE_APPROVER_ROLES.includes(approver.role)) {
    throw new Error(`Role ${approver.role} (${approver.type}) may not promote guidance to policy`);
  }
  const existing = opts.existingPolicies ?? [];
  const sameKey = existing.filter((p) => p.key === opts.policyKey);
  const version = sameKey.reduce((m, p) => Math.max(m, p.version), 0) + 1;
  const effectiveDate = opts.effectiveDate ?? (guidance.approvedAt ?? nowISO()).slice(0, 10);
  const policy: Policy = {
    id: deterministicId("pol", opts.policyKey, version, guidance.id),
    key: opts.policyKey,
    title: opts.title ?? guidance.title,
    body: guidance.body,
    version,
    status: "ACTIVE",
    effectiveDate,
    approvedBy: `${approver.role}:${approver.id}`,
    sourceGuidanceId: guidance.id,
    parameters: opts.parameters ?? (sameKey.find((p) => p.status === "ACTIVE")?.parameters ?? undefined),
  };
  const supersededPolicies: Policy[] = [];
  const policies = existing.map((p) => {
    if (p.key === opts.policyKey && p.status !== "SUPERSEDED") {
      const s: Policy = { ...p, status: "SUPERSEDED" };
      supersededPolicies.push(s);
      return s;
    }
    return p;
  });
  policies.push(policy);
  return { policy, supersededPolicies, policies };
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

export const SYNTHETIC_MEALS_MEMO_ID = "guid_synthetic_meals_documentation_standard";

/** Real guidance seed: intentionally empty. */
export function seedRealGuidance(): ProfessionalGuidance[] {
  return [];
}

/** The single synthetic memo used to exercise the guidance -> policy pipeline in the lab. */
export function syntheticExampleGuidance(): ProfessionalGuidance {
  return {
    id: SYNTHETIC_MEALS_MEMO_ID,
    authorRole: "CPA",
    authorName: "Synthetic CPA Group (fictional)",
    title: `${SYNTHETIC_GUIDANCE_PREFIX} CPA memo: meals documentation standard`,
    body: [
      `${SYNTHETIC_GUIDANCE_PREFIX} This memo is fictional and exists only so the lab can exercise the guidance pipeline. It is not professional advice and asserts no tax law.`,
      "For every meal charged to the business, the documentation standard is: (1) an itemized receipt, (2) the date and place, (3) the business purpose, and (4) the names and business relationship of attendees.",
      "Meals lacking any of these are held in the 'Non-Deductible / Personal Expense (Review)' account until the owner supplies the missing facts. The system never treats a meal as deductible on its own; the deductible percentage for any tax year comes from the retrieved authoritative source and CPA confirmation.",
    ].join("\n\n"),
    receivedAt: "2026-01-15T00:00:00.000Z",
    appliesTo: ["meals", "expense_documentation"],
    status: "PENDING_APPROVAL",
  };
}

export function isSyntheticGuidance(g: ProfessionalGuidance): boolean {
  return g.title.startsWith(SYNTHETIC_GUIDANCE_PREFIX);
}
