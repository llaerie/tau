import { eq } from "drizzle-orm";
import { defaultAssumptions } from "../assumptions";
import { nowIso } from "../ids";
import type { Db } from "./index";
import * as s from "./schema";
import { applyTemplateRecords, TEMPLATE } from "./template";

/**
 * Synthetic demo data for Will and Arielle. Every id is deterministic so the
 * seed is idempotent and the e2e tests can rely on it. Balances, rent and the
 * like are invented and labelled as such; the plan figures come from the
 * template.
 */
export const DEMO = {
  workspaceId: "ws_demo",
  users: {
    will: { id: "usr_demo_will", email: "will@demo.finance-desk.local", name: "Will" },
    arielle: { id: "usr_demo_arielle", email: "arielle@demo.finance-desk.local", name: "Arielle" },
  },
  persons: { will: "per_demo_will", arielle: "per_demo_arielle" },
  spaces: { company: "sp_demo_company", household: "sp_demo_household", will: "sp_demo_will", arielle: "sp_demo_arielle" },
  accounts: {
    coOperating: "acc_demo_co_operating",
    coTaxReserve: "acc_demo_co_tax",
    coCard: "acc_demo_co_card",
    hhChecking: "acc_demo_hh_checking",
    hhSavings: "acc_demo_hh_savings",
    willChecking: "acc_demo_will_checking",
    willCard: "acc_demo_will_card",
    arielleChecking: "acc_demo_arielle_checking",
    arielleTravel: "acc_demo_arielle_travel",
    arielleCard: "acc_demo_arielle_card",
  },
} as const;

export function demoWorkspaceExists(db: Db): boolean {
  return db.select({ id: s.workspaces.id }).from(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).get() !== undefined;
}

/** Bump when the synthetic data set changes so existing demo databases are refreshed. */
export const DEMO_SEED_VERSION = "2";

export function ensureDemoWorkspace(db: Db): void {
  const stored = db.select().from(s.meta).where(eq(s.meta.key, "demo_seed_version")).get()?.value;
  if (demoWorkspaceExists(db) && stored === DEMO_SEED_VERSION) return;
  if (demoWorkspaceExists(db)) db.delete(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).run();
  seedDemoWorkspace(db);
  db.insert(s.meta).values({ key: "demo_seed_version", value: DEMO_SEED_VERSION }).onConflictDoUpdate({ target: s.meta.key, set: { value: DEMO_SEED_VERSION } }).run();
}

export function resetDemoWorkspace(db: Db): void {
  // Deleting the workspace cascades to every record inside it. Demo users and
  // their sessions are kept so whoever pressed "reset" stays signed in.
  db.delete(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).run();
  seedDemoWorkspace(db);
}

type TxnSeed = Omit<typeof s.transactions.$inferInsert, "id" | "createdAt" | "source">;

export function seedDemoWorkspace(db: Db): void {
  const createdAt = nowIso();
  const A = DEMO.accounts;
  const S = DEMO.spaces;

  db.transaction((tx) => {
    tx.insert(s.workspaces).values({ id: DEMO.workspaceId, name: `${TEMPLATE.companyName} (synthetic demo)`, isDemo: true, createdAt }).run();
    for (const u of Object.values(DEMO.users)) {
      tx.insert(s.users).values({ id: u.id, email: u.email, name: u.name, passwordHash: null, isDemo: true, createdAt }).onConflictDoNothing().run();
      tx.insert(s.memberships).values({ id: `mem_${u.id}`, workspaceId: DEMO.workspaceId, userId: u.id, role: "owner", createdAt }).run();
    }
    const will = TEMPLATE.persons[0];
    const arielle = TEMPLATE.persons[1];
    tx.insert(s.persons).values([
      { id: DEMO.persons.will, workspaceId: DEMO.workspaceId, slug: will.slug, name: will.name, title: will.title, userId: DEMO.users.will.id },
      { id: DEMO.persons.arielle, workspaceId: DEMO.workspaceId, slug: arielle.slug, name: arielle.name, title: arielle.title, userId: DEMO.users.arielle.id },
    ]).run();
    tx.insert(s.spaces).values([
      { id: S.company, workspaceId: DEMO.workspaceId, kind: "company", name: TEMPLATE.companyName, personId: null },
      { id: S.household, workspaceId: DEMO.workspaceId, kind: "household", name: "Household", personId: null },
      { id: S.will, workspaceId: DEMO.workspaceId, kind: "personal", name: will.name, personId: DEMO.persons.will },
      { id: S.arielle, workspaceId: DEMO.workspaceId, kind: "personal", name: arielle.name, personId: DEMO.persons.arielle },
    ]).run();
    tx.insert(s.spacePermissions).values([
      { id: "perm_demo_1", spaceId: S.company, userId: DEMO.users.will.id, role: "owner" },
      { id: "perm_demo_2", spaceId: S.company, userId: DEMO.users.arielle.id, role: "editor" },
      { id: "perm_demo_3", spaceId: S.household, userId: DEMO.users.will.id, role: "owner" },
      { id: "perm_demo_4", spaceId: S.household, userId: DEMO.users.arielle.id, role: "owner" },
      { id: "perm_demo_5", spaceId: S.will, userId: DEMO.users.will.id, role: "owner" },
      { id: "perm_demo_6", spaceId: S.arielle, userId: DEMO.users.arielle.id, role: "owner" },
    ]).run();

    const asOf = "2026-06-01";
    tx.insert(s.accounts).values([
      { id: A.coOperating, spaceId: S.company, name: "Operating checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 4200000, openingBalanceAsOf: asOf },
      { id: A.coTaxReserve, spaceId: S.company, name: "Tax reserve savings", type: "savings", institution: "Demo Bank", openingBalanceCents: null, openingBalanceAsOf: null },
      { id: A.coCard, spaceId: S.company, name: "Company card", type: "credit_card", institution: "Demo Card", openingBalanceCents: -120000, openingBalanceAsOf: asOf },
      { id: A.hhChecking, spaceId: S.household, name: "Joint checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 310000, openingBalanceAsOf: asOf },
      { id: A.hhSavings, spaceId: S.household, name: "Joint savings", type: "savings", institution: "Demo Bank", openingBalanceCents: 200000, openingBalanceAsOf: asOf },
      { id: A.willChecking, spaceId: S.will, name: "Will checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 520000, openingBalanceAsOf: asOf },
      { id: A.willCard, spaceId: S.will, name: "Will card", type: "credit_card", institution: "Demo Card", openingBalanceCents: -64000, openingBalanceAsOf: asOf },
      { id: A.arielleChecking, spaceId: S.arielle, name: "Arielle checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 410000, openingBalanceAsOf: asOf },
      { id: A.arielleTravel, spaceId: S.arielle, name: "Travel fund", type: "savings", institution: "Demo Bank", openingBalanceCents: 150000, openingBalanceAsOf: asOf },
      { id: A.arielleCard, spaceId: S.arielle, name: "Arielle card", type: "credit_card", institution: "Demo Card", openingBalanceCents: -31000, openingBalanceAsOf: asOf },
    ]).run();

    const cat = (name: string, group: string) => ({ id: `cat_demo_${name.toLowerCase().replace(/[^a-z]+/g, "_")}`, workspaceId: DEMO.workspaceId, name, group });
    const categories = [
      cat("Service revenue", "company"), cat("Payroll — gross wages", "company"), cat("Software & tools", "company"), cat("Equipment", "company"),
      cat("Apartment furnishing (household)", "company"), cat("Bookkeeping", "company"), cat("Owner distribution", "company"),
      cat("Rent", "household"), cat("Tesla payments", "household"), cat("Utilities", "household"), cat("Car insurance", "household"), cat("Groceries", "household"), cat("Dining together", "household"), cat("Household savings", "household"),
      cat("Salary (net)", "personal"), cat("Shopping", "personal"), cat("Massage", "personal"), cat("Pedicure", "personal"), cat("Arts & crafts", "personal"), cat("Coffee, snacks & eating out with friends", "personal"), cat("Fitness", "personal"), cat("Phone", "personal"), cat("Personal savings", "personal"),
    ];
    tx.insert(s.categories).values(categories).run();
    const C = Object.fromEntries(categories.map((c) => [c.name, c.id]));

    // Template records (goals, budgets, bills) with synthetic household amounts.
    applyTemplateRecords(
      tx,
      DEMO.workspaceId,
      [
        { id: S.company, kind: "company", personId: null },
        { id: S.household, kind: "household", personId: null },
        { id: S.will, kind: "personal", personId: DEMO.persons.will },
        { id: S.arielle, kind: "personal", personId: DEMO.persons.arielle },
      ],
      [
        { id: DEMO.persons.will, name: will.name },
        { id: DEMO.persons.arielle, name: arielle.name },
      ],
      { householdBills: { Rent: 320000, "Tesla payments": 140000, Utilities: 25000, "Car insurance": 28000 }, householdBudgets: { Groceries: 90000, "Dining together": 60000 } },
    );
    tx.insert(s.bills).values([
      { id: "bill_demo_co_bookkeeping", spaceId: S.company, name: "Bookkeeping", amountCents: 25000, cadence: "monthly", dueDay: 10, categoryId: C["Bookkeeping"], isActive: true },
      { id: "bill_demo_will_phone", spaceId: S.will, name: "Phone", amountCents: 6000, cadence: "monthly", dueDay: 8, categoryId: C["Phone"], isActive: true },
      { id: "bill_demo_will_gym", spaceId: S.will, name: "Gym", amountCents: 4500, cadence: "monthly", dueDay: 5, categoryId: C["Fitness"], isActive: true },
      { id: "bill_demo_arielle_phone", spaceId: S.arielle, name: "Phone", amountCents: 6000, cadence: "monthly", dueDay: 8, categoryId: C["Phone"], isActive: true },
    ]).run();
    tx.insert(s.goals).values([
      { id: "goal_demo_hh_emergency", spaceId: S.household, name: "Household emergency fund", monthlyTargetCents: 30000, priority: 1, targetTotalCents: 1000000, savedCents: 200000, rule: null, accountId: A.hhSavings },
    ]).run();
    // Link Arielle's travel goal to her travel fund account and her saved amount.
    const travelGoal = tx.select().from(s.goals).where(eq(s.goals.spaceId, S.arielle)).get();
    if (travelGoal) tx.update(s.goals).set({ accountId: A.arielleTravel, savedCents: 150000 }).where(eq(s.goals.id, travelGoal.id)).run();
    const billIds = Object.fromEntries(tx.select().from(s.bills).all().map((b) => [`${b.spaceId}:${b.name}`, b.id]));
    const bill = (spaceId: string, name: string) => billIds[`${spaceId}:${name}`] ?? null;

    const assumptions = defaultAssumptions([DEMO.persons.will, DEMO.persons.arielle]);
    assumptions.household.plannedCompanyDistributionCents = 600000; // synthetic
    assumptions.onboardingCompleted = true;
    assumptions.notes = "Synthetic demo workspace. Plan figures follow the stated plan; balances, rent, car payments and the $6,000 planned distribution are illustrative and were not taken from any real account.";
    tx.insert(s.assumptions).values({ workspaceId: DEMO.workspaceId, json: JSON.stringify(assumptions), updatedAt: createdAt, updatedBy: null }).run();

    const txns: TxnSeed[] = [];
    const d = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`;
    const fullMonths = ["2026-06", "2026-07", "2026-08"];
    const revenue: Record<string, number> = { "2026-06": 2850000, "2026-07": 3000000, "2026-08": 3120000 };
    const NET = 252050; // $3,000 gross − 7.65% FICA − $250 income tax estimate
    const WITHHELD = 300000 - NET;

    for (const m of fullMonths) {
      // Company
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 5), amountCents: revenue[m], kind: "income", categoryId: C["Service revenue"], description: "Client retainer — invoice paid" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 25), amountCents: 300000, kind: "expense", categoryId: C["Payroll — gross wages"], description: "Payroll — Will (gross)" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 25), amountCents: 300000, kind: "expense", categoryId: C["Payroll — gross wages"], description: "Payroll — Arielle (gross)" });
      txns.push({ spaceId: S.company, accountId: A.coCard, date: d(m, 5), amountCents: 20000, kind: "bill_payment", billId: bill(S.company, "Claude Max"), categoryId: C["Software & tools"], description: "Claude Max" });
      txns.push({ spaceId: S.company, accountId: A.coCard, date: d(m, 5), amountCents: 20000, kind: "bill_payment", billId: bill(S.company, "ChatGPT Pro"), categoryId: C["Software & tools"], description: "ChatGPT Pro" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 10), amountCents: 25000, kind: "bill_payment", billId: bill(S.company, "Bookkeeping"), categoryId: C["Bookkeeping"], description: "Bookkeeping" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.coCard, date: d(m, 20), amountCents: 40000, kind: "cc_payment", description: "Company card payment" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.hhChecking, date: d(m, 1), amountCents: 600000, kind: "transfer", categoryId: C["Owner distribution"], description: "Owner distribution to household" });
      // Household
      txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 2), amountCents: 320000, kind: "bill_payment", billId: bill(S.household, "Rent"), categoryId: C["Rent"], description: "Rent" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 15), amountCents: 140000, kind: "bill_payment", billId: bill(S.household, "Tesla payments"), categoryId: C["Tesla payments"], description: "Tesla payments" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 12), amountCents: 25000, kind: "bill_payment", billId: bill(S.household, "Utilities"), categoryId: C["Utilities"], description: "Utilities" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 20), amountCents: 28000, kind: "bill_payment", billId: bill(S.household, "Car insurance"), categoryId: C["Car insurance"], description: "Car insurance" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, counterAccountId: A.hhSavings, date: d(m, 3), amountCents: 30000, kind: "savings_allocation", goalId: "goal_demo_hh_emergency", categoryId: C["Household savings"], description: "Emergency fund allocation" });
      for (const [day, amt] of [[6, 21200], [13, 19800], [20, 24600], [27, 22100]] as const) {
        txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C["Groceries"], description: "Groceries" });
      }
      for (const [day, amt] of [[8, 14200], [22, 17600]] as const) {
        txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C["Dining together"], description: "Dinner together" });
      }
      // Will
      txns.push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 25), amountCents: NET, kind: "income", categoryId: C["Salary (net)"], description: "Payroll — net deposit" });
      txns.push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 25), amountCents: WITHHELD, kind: "payroll_withholding", description: "Payroll withholding (gross $3,000)" });
      txns.push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: bill(S.will, "Phone"), categoryId: C["Phone"], description: "Phone" });
      txns.push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 5), amountCents: 4500, kind: "bill_payment", billId: bill(S.will, "Gym"), categoryId: C["Fitness"], description: "Gym" });
      txns.push({ spaceId: S.will, accountId: A.willCard, date: d(m, 11), amountCents: 8900, kind: "expense", categoryId: null, description: "Books" });
      txns.push({ spaceId: S.will, accountId: A.willChecking, counterAccountId: A.willCard, date: d(m, 20), amountCents: 8900, kind: "cc_payment", description: "Card payment" });
      // Arielle
      txns.push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 25), amountCents: NET, kind: "income", categoryId: C["Salary (net)"], description: "Payroll — net deposit" });
      txns.push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 25), amountCents: WITHHELD, kind: "payroll_withholding", description: "Payroll withholding (gross $3,000)" });
      txns.push({ spaceId: S.arielle, accountId: A.arielleChecking, counterAccountId: A.arielleTravel, date: d(m, 26), amountCents: 100000, kind: "savings_allocation", goalId: travelGoal?.id ?? null, categoryId: C["Personal savings"], description: "Friends travel fund" });
      txns.push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: bill(S.arielle, "Phone"), categoryId: C["Phone"], description: "Phone" });
      for (const [day, amt, desc, catName] of [
        [4, 18900, "Boutique", "Shopping"],
        [16, 23400, "Online order", "Shopping"],
        [9, 15000, "Massage", "Massage"],
        [12, 6000, "Pedicure", "Pedicure"],
        [18, 8500, "Art supplies", "Arts & crafts"],
        [3, 4200, "Coffee with Maya", "Coffee, snacks & eating out with friends"],
        [21, 7800, "Brunch with friends", "Coffee, snacks & eating out with friends"],
      ] as const) {
        txns.push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C[catName], description: desc });
      }
      txns.push({ spaceId: S.arielle, accountId: A.arielleChecking, counterAccountId: A.arielleCard, date: d(m, 20), amountCents: 83800, kind: "cc_payment", description: "Card payment" });
    }
    // One-off allocation spending and the current month so far (September 2026).
    txns.push({ spaceId: S.company, accountId: A.coCard, date: "2026-07-14", amountCents: 159900, kind: "expense", categoryId: C["Equipment"], description: "Mac mini (2026)" });
    txns.push({ spaceId: S.company, accountId: A.coCard, date: "2026-08-09", amountCents: 240000, kind: "expense", categoryId: C["Apartment furnishing (household)"], description: "Sofa and dining table for the apartment" });
    const m = "2026-09";
    txns.push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.hhChecking, date: d(m, 1), amountCents: 600000, kind: "transfer", categoryId: C["Owner distribution"], description: "Owner distribution to household" });
    txns.push({ spaceId: S.company, accountId: A.coCard, date: d(m, 5), amountCents: 20000, kind: "bill_payment", billId: bill(S.company, "Claude Max"), categoryId: C["Software & tools"], description: "Claude Max" });
    txns.push({ spaceId: S.company, accountId: A.coCard, date: d(m, 5), amountCents: 20000, kind: "bill_payment", billId: bill(S.company, "ChatGPT Pro"), categoryId: C["Software & tools"], description: "ChatGPT Pro" });
    txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 2), amountCents: 320000, kind: "bill_payment", billId: bill(S.household, "Rent"), categoryId: C["Rent"], description: "Rent" });
    txns.push({ spaceId: S.household, accountId: A.hhChecking, counterAccountId: A.hhSavings, date: d(m, 3), amountCents: 30000, kind: "savings_allocation", goalId: "goal_demo_hh_emergency", categoryId: C["Household savings"], description: "Emergency fund allocation" });
    txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 6), amountCents: 20700, kind: "expense", categoryId: C["Groceries"], description: "Groceries" });
    txns.push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 5), amountCents: 4500, kind: "bill_payment", billId: bill(S.will, "Gym"), categoryId: C["Fitness"], description: "Gym" });
    txns.push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: bill(S.will, "Phone"), categoryId: C["Phone"], description: "Phone" });
    txns.push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: bill(S.arielle, "Phone"), categoryId: C["Phone"], description: "Phone" });
    txns.push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, 4), amountCents: 4600, kind: "expense", categoryId: C["Coffee, snacks & eating out with friends"], description: "Coffee with Maya" });
    txns.push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, 7), amountCents: 12900, kind: "expense", categoryId: C["Shopping"], description: "Boutique" });

    tx.insert(s.transactions).values(txns.map((t, i) => ({ ...t, id: `txn_demo_${String(i + 1).padStart(4, "0")}`, source: "seed" as const, createdAt }))).run();
  });
}
