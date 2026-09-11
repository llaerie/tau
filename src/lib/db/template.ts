import { eq } from "drizzle-orm";
import type { Cadence } from "../finance/money";
import { newId } from "../ids";
import type { Db } from "./index";
import * as s from "./schema";

/**
 * The workspace template: who the people are and the plan they described.
 * Used by the synthetic demo seed and by live-mode registration. Amounts that
 * were never stated are null (unknown) so the app asks for them instead of
 * inventing them.
 */
export interface TemplatePerson {
  slug: string;
  name: string;
  title: string;
  /** Workspace owner and owner of the S corporation. */
  isCompanyOwner: boolean;
  goals: { name: string; monthlyTargetCents: number | null; priority: number; targetTotalCents?: number | null; rule?: string | null }[];
  budgets: { name: string; monthlyCents: number | null }[];
  bills: { name: string; amountCents: number | null; cadence: Cadence; dueDay?: number | null }[];
}

export const TEMPLATE = {
  companyName: "Our company",
  persons: [
    { slug: "will", name: "Will", title: "CEO", isCompanyOwner: true, goals: [], budgets: [], bills: [] },
    {
      slug: "arielle",
      name: "Arielle",
      title: "Creative Director",
      isCompanyOwner: false,
      goals: [{ name: "Friends travel", monthlyTargetCents: 100000, priority: 1, targetTotalCents: null, rule: "Funded before any discretionary spending" }],
      budgets: [
        { name: "Shopping", monthlyCents: 70000 },
        { name: "Massage", monthlyCents: 30000 },
        { name: "Pedicure", monthlyCents: 10000 },
        { name: "Arts & crafts", monthlyCents: 20000 },
        { name: "Coffee, snacks & eating out with friends", monthlyCents: 20000 },
      ],
      bills: [],
    },
  ] as TemplatePerson[],
  household: {
    bills: [
      { name: "Rent", amountCents: null, cadence: "monthly" as Cadence, dueDay: 1 },
      { name: "Tesla payments", amountCents: null, cadence: "monthly" as Cadence, dueDay: 15 },
      { name: "Utilities", amountCents: null, cadence: "monthly" as Cadence, dueDay: 12 },
      { name: "Car insurance", amountCents: null, cadence: "monthly" as Cadence, dueDay: 20 },
    ],
    budgets: [
      { name: "Groceries", monthlyCents: null },
      { name: "Dining together", monthlyCents: null },
    ],
    goals: [] as TemplatePerson["goals"],
  },
  company: {
    bills: [
      { name: "Claude Max", amountCents: 20000, cadence: "monthly" as Cadence, dueDay: 5 },
      { name: "ChatGPT Pro", amountCents: 20000, cadence: "monthly" as Cadence, dueDay: 5 },
    ],
  },
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

/**
 * Create the template's bills, budgets and goals inside an existing workspace.
 * `overrides` lets the demo seed replace unknown amounts with synthetic ones.
 */
export function applyTemplateRecords(
  tx: Tx,
  workspaceId: string,
  spaces: SpaceRef[],
  persons: { id: string; name: string }[],
  overrides: { householdBills?: Record<string, number>; householdBudgets?: Record<string, number> } = {},
): void {
  const company = spaces.find((sp) => sp.kind === "company");
  const household = spaces.find((sp) => sp.kind === "household");
  const categoryId = (name: string, group: string) => {
    const existing = tx.select().from(s.categories).where(eq(s.categories.workspaceId, workspaceId)).all().find((c) => c.name === name);
    if (existing) return existing.id;
    const id = newId("cat");
    tx.insert(s.categories).values({ id, workspaceId, name, group }).run();
    return id;
  };

  if (company) {
    for (const b of TEMPLATE.company.bills) {
      tx.insert(s.bills).values({ id: newId("bill"), spaceId: company.id, name: b.name, amountCents: b.amountCents, cadence: b.cadence, dueDay: b.dueDay ?? null, categoryId: categoryId("Software & tools", "company"), isActive: true }).run();
    }
  }
  if (household) {
    for (const b of TEMPLATE.household.bills) {
      tx.insert(s.bills).values({ id: newId("bill"), spaceId: household.id, name: b.name, amountCents: overrides.householdBills?.[b.name] ?? b.amountCents, cadence: b.cadence, dueDay: b.dueDay ?? null, categoryId: categoryId(b.name, "household"), isActive: true }).run();
    }
    TEMPLATE.household.budgets.forEach((b, i) => {
      tx.insert(s.budgets).values({ id: newId("bud"), spaceId: household.id, name: b.name, monthlyCents: overrides.householdBudgets?.[b.name] ?? b.monthlyCents, categoryId: categoryId(b.name, "household"), sortOrder: i }).run();
    });
  }
  for (const person of persons) {
    const tp = templatePerson(person.name);
    const space = spaces.find((sp) => sp.kind === "personal" && sp.personId === person.id);
    if (!tp || !space) continue;
    for (const g of tp.goals) {
      tx.insert(s.goals).values({ id: newId("goal"), spaceId: space.id, name: g.name, monthlyTargetCents: g.monthlyTargetCents, priority: g.priority, targetTotalCents: g.targetTotalCents ?? null, savedCents: 0, rule: g.rule ?? null, accountId: null }).run();
    }
    tp.budgets.forEach((b, i) => {
      tx.insert(s.budgets).values({ id: newId("bud"), spaceId: space.id, name: b.name, monthlyCents: b.monthlyCents, categoryId: categoryId(b.name, "personal"), sortOrder: i }).run();
    });
    for (const b of tp.bills) {
      tx.insert(s.bills).values({ id: newId("bill"), spaceId: space.id, name: b.name, amountCents: b.amountCents, cadence: b.cadence, dueDay: b.dueDay ?? null, categoryId: null, isActive: true }).run();
    }
  }
}
