import { eq } from "drizzle-orm";
import type { Cadence } from "../finance/money";
import { newId, nowIso } from "../ids";
import type { Db } from "./index";
import * as s from "./schema";

/**
 * Owner-supplied planning facts as of 2026-09-11. Used by live registration
 * (as editable defaults) and by the demo seed (with clearly fictional
 * balances layered on top). Amounts never stated are null (unknown).
 */
export interface TemplatePerson {
  slug: string;
  name: string;
  title: string;
  isCompanyOwner: boolean;
}

export const TEMPLATE = {
  companyName: "Our company",
  persons: [
    { slug: "will", name: "Will", title: "CEO", isCompanyOwner: true },
    { slug: "arielle", name: "Arielle", title: "Creative Director", isCompanyOwner: false },
  ] as TemplatePerson[],
  /** Shared costs the company intends to pay. Personal purpose; accounting treatment needs review. */
  householdBillsPaidByCompany: [
    { name: "Apartment rent", amountCents: 580000, cadence: "monthly" as Cadence, dueDay: 1, category: "Rent" },
    { name: "Two Teslas", amountCents: 120000, cadence: "monthly" as Cadence, dueDay: 15, category: "Vehicles" },
  ],
  /** Unconfirmed shared costs, kept visible with unknown amounts. */
  householdBillsUnconfirmed: [
    { name: "Utilities", amountCents: null, cadence: "monthly" as Cadence, dueDay: 12, category: "Utilities" },
    { name: "Renters and car insurance", amountCents: null, cadence: "monthly" as Cadence, dueDay: 20, category: "Insurance" },
  ],
  subscriptions: [
    { provider: "Anthropic", product: "Claude", kind: "subscription" as const, quantity: 2, notes: "Two seats intended for Will and Arielle. Tier to confirm; more than one Max tier exists." },
    { provider: "OpenAI", product: "ChatGPT", kind: "subscription" as const, quantity: 2, notes: "Two seats intended for Will and Arielle. Tier and existing/new account status to confirm." },
    { provider: "Anthropic", product: "Claude API usage", kind: "api_usage" as const, quantity: 1, notes: "Metered operating cost for the assistant. Billed separately from consumer subscriptions." },
    { provider: "Various", product: "Hosting, database, domain, email", kind: "saas" as const, quantity: 1, notes: "Amounts unknown until supplied." },
  ],
  purchasePlans: [
    { name: "Mac mini", category: "hardware" as const, beneficiary: "company" as const, purpose: "unresolved" as const, notes: "Model, price, date and business use to confirm. Equipment purchase and its tax treatment are separate questions." },
    { name: "Apartment furniture", category: "furniture" as const, beneficiary: "household" as const, purpose: "personal" as const, notes: "Items, quotes, delivery, tax and date to confirm. Household furniture is not a business asset." },
  ],
};

export function templatePerson(name: string): TemplatePerson | undefined {
  const key = name.trim().toLowerCase();
  return TEMPLATE.persons.find((p) => p.slug === key || p.name.toLowerCase() === key);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

interface SpaceRef {
  id: string;
  kind: "company" | "household" | "personal";
  personId: string | null;
}

/** Create the plan's bills, subscriptions and purchase plans inside a workspace. Idempotent per workspace is the caller's job. */
export function applyTemplateRecords(tx: Tx, workspaceId: string, spaces: SpaceRef[], persons: { id: string; name: string }[], source: "template" | "demo" = "template"): void {
  const company = spaces.find((sp) => sp.kind === "company");
  const household = spaces.find((sp) => sp.kind === "household");
  const createdAt = nowIso();
  const categoryId = (name: string, group: string) => {
    const existing = tx.select().from(s.categories).where(eq(s.categories.workspaceId, workspaceId)).all().find((c) => c.name === name);
    if (existing) return existing.id;
    const id = newId("cat");
    tx.insert(s.categories).values({ id, workspaceId, name, group }).run();
    return id;
  };
  // Standard categories every workspace needs.
  categoryId("Food & dining", "food");
  categoryId("Groceries", "household");
  categoryId("API usage", "company");
  categoryId("Software subscriptions", "company");

  if (household && company) {
    for (const b of TEMPLATE.householdBillsPaidByCompany) {
      tx.insert(s.bills).values({ id: newId("bill"), spaceId: household.id, name: b.name, amountCents: b.amountCents, cadence: b.cadence, dueDay: b.dueDay, categoryId: categoryId(b.category, "household"), isActive: true, payerSpaceId: company.id, beneficiary: "household", purpose: "personal", treatment: "review_required", source }).run();
    }
    for (const b of TEMPLATE.householdBillsUnconfirmed) {
      tx.insert(s.bills).values({ id: newId("bill"), spaceId: household.id, name: b.name, amountCents: b.amountCents, cadence: b.cadence, dueDay: b.dueDay, categoryId: categoryId(b.category, "household"), isActive: true, payerSpaceId: null, beneficiary: "household", purpose: "personal", treatment: "review_required", source }).run();
    }
  }
  if (company) {
    const personIds = persons.map((p) => p.id);
    for (const sub of TEMPLATE.subscriptions) {
      tx.insert(s.subscriptions).values({ id: newId("sub"), workspaceId, spaceId: company.id, provider: sub.provider, product: sub.product, tier: null, kind: sub.kind, quantity: sub.quantity, unitPriceCents: null, currency: "USD", interval: "monthly", status: sub.kind === "api_usage" ? "active" : "planned", accountStatus: "unknown", usersJson: JSON.stringify(sub.quantity === 2 ? personIds : []), notes: sub.notes, source, createdAt }).run();
    }
    for (const p of TEMPLATE.purchasePlans) {
      tx.insert(s.purchasePlans).values({ id: newId("plan"), workspaceId, payerSpaceId: company.id, name: p.name, category: p.category, specification: null, quantity: 1, unitPriceCents: null, taxShippingCents: null, targetMonth: null, fundingAccountId: null, beneficiary: p.beneficiary, beneficiaryPersonId: null, purpose: p.purpose, treatment: "review_required", status: "planned", notes: p.notes, source, createdBy: null, createdAt, version: 1 }).run();
    }
  }
}
