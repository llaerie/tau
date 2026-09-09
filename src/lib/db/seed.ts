import { eq } from "drizzle-orm";
import { defaultAssumptions } from "../assumptions";
import { nowIso } from "../ids";
import type { Db } from "./index";
import * as s from "./schema";

/**
 * Synthetic demo data. Every id is deterministic so the seed is idempotent and
 * the e2e tests can rely on it. Nothing here comes from a real bank.
 */
export const DEMO = {
  workspaceId: "ws_demo",
  users: {
    alex: { id: "usr_demo_alex", email: "alex@demo.finance-desk.local", name: "Alex Rivera" },
    sam: { id: "usr_demo_sam", email: "sam@demo.finance-desk.local", name: "Sam Okafor" },
  },
  persons: { alex: "per_demo_alex", sam: "per_demo_sam" },
  spaces: { company: "sp_demo_company", household: "sp_demo_household", alex: "sp_demo_alex", sam: "sp_demo_sam" },
  accounts: {
    coOperating: "acc_demo_co_operating",
    coTaxReserve: "acc_demo_co_tax",
    coCard: "acc_demo_co_card",
    hhChecking: "acc_demo_hh_checking",
    hhSavings: "acc_demo_hh_savings",
    alexChecking: "acc_demo_alex_checking",
    alexTravel: "acc_demo_alex_travel",
    alexCard: "acc_demo_alex_card",
    samChecking: "acc_demo_sam_checking",
    samSavings: "acc_demo_sam_savings",
    samCard: "acc_demo_sam_card",
  },
  bills: {
    coSoftware: "bill_demo_co_software",
    coInsurance: "bill_demo_co_insurance",
    coAccounting: "bill_demo_co_accounting",
    coCoworking: "bill_demo_co_coworking",
    hhRent: "bill_demo_hh_rent",
    hhUtilities: "bill_demo_hh_utilities",
    hhInternet: "bill_demo_hh_internet",
    hhInsurance: "bill_demo_hh_insurance",
    alexPhone: "bill_demo_alex_phone",
    alexGym: "bill_demo_alex_gym",
    samPhone: "bill_demo_sam_phone",
    samStreaming: "bill_demo_sam_streaming",
  },
  goals: {
    alexTravel: "goal_demo_alex_travel",
    alexGear: "goal_demo_alex_gear",
    samCushion: "goal_demo_sam_cushion",
    samCycling: "goal_demo_sam_cycling",
    hhEmergency: "goal_demo_hh_emergency",
    hhHoliday: "goal_demo_hh_holiday",
  },
} as const;

export function demoWorkspaceExists(db: Db): boolean {
  return db.select({ id: s.workspaces.id }).from(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).get() !== undefined;
}

export function ensureDemoWorkspace(db: Db): void {
  if (demoWorkspaceExists(db)) return;
  seedDemoWorkspace(db);
}

export function resetDemoWorkspace(db: Db): void {
  // Deleting the workspace cascades to every record inside it. Demo users and
  // their sessions are kept so whoever pressed "reset" stays signed in.
  db.delete(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).run();
  seedDemoWorkspace(db);
}

type TxnSeed = Omit<typeof s.transactions.$inferInsert, "id" | "createdAt" | "source" | "spaceId"> & { spaceId: string };

export function seedDemoWorkspace(db: Db): void {
  const createdAt = nowIso();
  const A = DEMO.accounts;
  const B = DEMO.bills;
  const G = DEMO.goals;
  const S = DEMO.spaces;

  db.transaction((tx) => {
    tx.insert(s.workspaces).values({ id: DEMO.workspaceId, name: "Halden Studio (synthetic demo)", isDemo: true, createdAt }).run();
    for (const u of Object.values(DEMO.users)) {
      tx.insert(s.users).values({ id: u.id, email: u.email, name: u.name, passwordHash: null, isDemo: true, createdAt }).onConflictDoNothing().run();
      tx.insert(s.memberships).values({ id: `mem_${u.id}`, workspaceId: DEMO.workspaceId, userId: u.id, role: "owner", createdAt }).run();
    }
    tx.insert(s.persons).values([
      { id: DEMO.persons.alex, workspaceId: DEMO.workspaceId, slug: "alex", name: "Alex", userId: DEMO.users.alex.id },
      { id: DEMO.persons.sam, workspaceId: DEMO.workspaceId, slug: "sam", name: "Sam", userId: DEMO.users.sam.id },
    ]).run();
    tx.insert(s.spaces).values([
      { id: S.company, workspaceId: DEMO.workspaceId, kind: "company", name: "Halden Studio", personId: null },
      { id: S.household, workspaceId: DEMO.workspaceId, kind: "household", name: "Household", personId: null },
      { id: S.alex, workspaceId: DEMO.workspaceId, kind: "personal", name: "Alex", personId: DEMO.persons.alex },
      { id: S.sam, workspaceId: DEMO.workspaceId, kind: "personal", name: "Sam", personId: DEMO.persons.sam },
    ]).run();
    tx.insert(s.spacePermissions).values([
      { id: "perm_demo_1", spaceId: S.company, userId: DEMO.users.alex.id, role: "owner" },
      { id: "perm_demo_2", spaceId: S.company, userId: DEMO.users.sam.id, role: "owner" },
      { id: "perm_demo_3", spaceId: S.household, userId: DEMO.users.alex.id, role: "owner" },
      { id: "perm_demo_4", spaceId: S.household, userId: DEMO.users.sam.id, role: "owner" },
      { id: "perm_demo_5", spaceId: S.alex, userId: DEMO.users.alex.id, role: "owner" },
      { id: "perm_demo_6", spaceId: S.sam, userId: DEMO.users.sam.id, role: "owner" },
    ]).run();

    const asOf = "2026-06-01";
    tx.insert(s.accounts).values([
      { id: A.coOperating, spaceId: S.company, name: "Operating checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 4200000, openingBalanceAsOf: asOf },
      { id: A.coTaxReserve, spaceId: S.company, name: "Tax reserve savings", type: "savings", institution: "Demo Bank", openingBalanceCents: null, openingBalanceAsOf: null },
      { id: A.coCard, spaceId: S.company, name: "Company card", type: "credit_card", institution: "Demo Card", openingBalanceCents: -120000, openingBalanceAsOf: asOf },
      { id: A.hhChecking, spaceId: S.household, name: "Joint checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 310000, openingBalanceAsOf: asOf },
      { id: A.hhSavings, spaceId: S.household, name: "Joint savings", type: "savings", institution: "Demo Bank", openingBalanceCents: 200000, openingBalanceAsOf: asOf },
      { id: A.alexChecking, spaceId: S.alex, name: "Alex checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 520000, openingBalanceAsOf: asOf },
      { id: A.alexTravel, spaceId: S.alex, name: "Travel fund", type: "savings", institution: "Demo Bank", openingBalanceCents: 150000, openingBalanceAsOf: asOf },
      { id: A.alexCard, spaceId: S.alex, name: "Alex card", type: "credit_card", institution: "Demo Card", openingBalanceCents: -64000, openingBalanceAsOf: asOf },
      { id: A.samChecking, spaceId: S.sam, name: "Sam checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 410000, openingBalanceAsOf: asOf },
      { id: A.samSavings, spaceId: S.sam, name: "Sam savings", type: "savings", institution: "Demo Bank", openingBalanceCents: 230000, openingBalanceAsOf: asOf },
      { id: A.samCard, spaceId: S.sam, name: "Sam card", type: "credit_card", institution: "Demo Card", openingBalanceCents: -31000, openingBalanceAsOf: asOf },
    ]).run();

    const cat = (name: string, group: string) => ({ id: `cat_demo_${name.toLowerCase().replace(/[^a-z]+/g, "_")}`, workspaceId: DEMO.workspaceId, name, group });
    const categories = [
      cat("Service revenue", "company"), cat("Payroll — employees", "company"), cat("Payroll — owners (gross)", "company"), cat("Software", "company"),
      cat("Business insurance", "company"), cat("Professional services", "company"), cat("Facilities", "company"), cat("Hosting", "company"), cat("Owner distribution", "company"),
      cat("Housing", "household"), cat("Utilities", "household"), cat("Groceries", "household"), cat("Household insurance", "household"), cat("Household savings", "household"),
      cat("Salary (net)", "personal"), cat("Dining", "personal"), cat("Fitness", "personal"), cat("Phone", "personal"), cat("Clothing", "personal"), cat("Transport", "personal"), cat("Personal savings", "personal"), cat("Entertainment", "personal"),
    ];
    tx.insert(s.categories).values(categories).run();
    const C = Object.fromEntries(categories.map((c) => [c.name, c.id]));

    tx.insert(s.bills).values([
      { id: B.coSoftware, spaceId: S.company, name: "Software subscriptions", amountCents: 40000, cadence: "monthly", dueDay: 3, categoryId: C["Software"] },
      { id: B.coInsurance, spaceId: S.company, name: "Business insurance", amountCents: 120000, cadence: "annual", dueDay: 1, categoryId: C["Business insurance"] },
      { id: B.coAccounting, spaceId: S.company, name: "Bookkeeping", amountCents: 25000, cadence: "monthly", dueDay: 10, categoryId: C["Professional services"] },
      { id: B.coCoworking, spaceId: S.company, name: "Coworking desks", amountCents: 90000, cadence: "monthly", dueDay: 1, categoryId: C["Facilities"] },
      { id: B.hhRent, spaceId: S.household, name: "Rent", amountCents: 180000, cadence: "monthly", dueDay: 2, categoryId: C["Housing"] },
      { id: B.hhUtilities, spaceId: S.household, name: "Utilities", amountCents: 22000, cadence: "monthly", dueDay: 12, categoryId: C["Utilities"] },
      { id: B.hhInternet, spaceId: S.household, name: "Internet", amountCents: 8000, cadence: "monthly", dueDay: 15, categoryId: C["Utilities"] },
      { id: B.hhInsurance, spaceId: S.household, name: "Renters insurance", amountCents: 30000, cadence: "annual", dueDay: 20, categoryId: C["Household insurance"] },
      { id: B.alexPhone, spaceId: S.alex, name: "Phone", amountCents: 6000, cadence: "monthly", dueDay: 8, categoryId: C["Phone"] },
      { id: B.alexGym, spaceId: S.alex, name: "Gym", amountCents: 4500, cadence: "monthly", dueDay: 5, categoryId: C["Fitness"] },
      { id: B.samPhone, spaceId: S.sam, name: "Phone", amountCents: 6000, cadence: "monthly", dueDay: 8, categoryId: C["Phone"] },
      { id: B.samStreaming, spaceId: S.sam, name: "Streaming", amountCents: null, cadence: "monthly", dueDay: 14, categoryId: C["Entertainment"] },
    ]).run();

    tx.insert(s.goals).values([
      { id: G.alexTravel, spaceId: S.alex, name: "Friends travel", monthlyTargetCents: 100000, priority: 1, targetTotalCents: null, savedCents: 150000, rule: "Funded before any discretionary spending", accountId: A.alexTravel },
      { id: G.alexGear, spaceId: S.alex, name: "Camera gear", monthlyTargetCents: 20000, priority: 2, targetTotalCents: 180000, savedCents: 30000, rule: null, accountId: null },
      { id: G.samCushion, spaceId: S.sam, name: "Emergency cushion", monthlyTargetCents: 30000, priority: 1, targetTotalCents: 500000, savedCents: 230000, rule: null, accountId: A.samSavings },
      { id: G.samCycling, spaceId: S.sam, name: "Cycling trip", monthlyTargetCents: 15000, priority: 2, targetTotalCents: 120000, savedCents: 0, rule: null, accountId: null },
      { id: G.hhEmergency, spaceId: S.household, name: "Household emergency fund", monthlyTargetCents: 30000, priority: 1, targetTotalCents: 1000000, savedCents: 200000, rule: null, accountId: A.hhSavings },
      { id: G.hhHoliday, spaceId: S.household, name: "Winter holiday", monthlyTargetCents: 15000, priority: 2, targetTotalCents: 240000, savedCents: 0, rule: null, accountId: null },
    ]).run();

    const assumptions = defaultAssumptions([DEMO.persons.alex, DEMO.persons.sam]);
    assumptions.owners[DEMO.persons.alex].householdContributionCents = 80000;
    assumptions.owners[DEMO.persons.sam].householdContributionCents = 80000;
    assumptions.onboardingCompleted = true;
    assumptions.notes = "Synthetic demo workspace. Figures are illustrative and were not taken from any real account.";
    tx.insert(s.assumptions).values({ workspaceId: DEMO.workspaceId, json: JSON.stringify(assumptions), updatedAt: createdAt, updatedBy: null }).run();

    const txns: TxnSeed[] = [];
    const d = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`;
    const fullMonths = ["2026-06", "2026-07", "2026-08"];
    const revenue: Record<string, number> = { "2026-06": 2850000, "2026-07": 3000000, "2026-08": 3120000 };
    const NET = 231000; // synthetic net deposit on $3,000 gross
    const WITHHELD = 300000 - NET;

    for (const m of fullMonths) {
      // Company
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 5), amountCents: revenue[m], kind: "income", categoryId: C["Service revenue"], description: "Client retainer — Meridian Co (invoice paid)" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 25), amountCents: 800000, kind: "expense", categoryId: C["Payroll — employees"], description: "Employee allocation (classification unresolved)" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 25), amountCents: 300000, kind: "expense", categoryId: C["Payroll — owners (gross)"], description: "Owner salary — Alex (gross)" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 25), amountCents: 300000, kind: "expense", categoryId: C["Payroll — owners (gross)"], description: "Owner salary — Sam (gross)" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 1), amountCents: 90000, kind: "bill_payment", billId: B.coCoworking, categoryId: C["Facilities"], description: "Coworking desks" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 3), amountCents: 40000, kind: "bill_payment", billId: B.coSoftware, categoryId: C["Software"], description: "Software subscriptions" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 10), amountCents: 25000, kind: "bill_payment", billId: B.coAccounting, categoryId: C["Professional services"], description: "Bookkeeping" });
      txns.push({ spaceId: S.company, accountId: A.coCard, date: d(m, 7), amountCents: 18000, kind: "expense", categoryId: C["Hosting"], description: "Cloud hosting" });
      txns.push({ spaceId: S.company, accountId: A.coCard, date: d(m, 14), amountCents: 6500, kind: "expense", categoryId: C["Software"], description: "Design tool seats" });
      txns.push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.coCard, date: d(m, 20), amountCents: 24500, kind: "cc_payment", description: "Company card payment" });
      // Household
      txns.push({ spaceId: S.alex, accountId: A.alexChecking, counterAccountId: A.hhChecking, date: d(m, 1), amountCents: 80000, kind: "transfer", description: "Household contribution — Alex" });
      txns.push({ spaceId: S.sam, accountId: A.samChecking, counterAccountId: A.hhChecking, date: d(m, 1), amountCents: 80000, kind: "transfer", description: "Household contribution — Sam" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 2), amountCents: 180000, kind: "bill_payment", billId: B.hhRent, categoryId: C["Housing"], description: "Rent" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 12), amountCents: 22000, kind: "bill_payment", billId: B.hhUtilities, categoryId: C["Utilities"], description: "Utilities" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 15), amountCents: 8000, kind: "bill_payment", billId: B.hhInternet, categoryId: C["Utilities"], description: "Internet" });
      txns.push({ spaceId: S.household, accountId: A.hhChecking, counterAccountId: A.hhSavings, date: d(m, 3), amountCents: 30000, kind: "savings_allocation", goalId: G.hhEmergency, categoryId: C["Household savings"], description: "Emergency fund allocation" });
      for (const [day, amt] of [[6, 13200], [13, 11800], [20, 14600], [27, 12100]] as const) {
        txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C["Groceries"], description: "Groceries" });
      }
      // Alex
      txns.push({ spaceId: S.alex, accountId: A.alexChecking, date: d(m, 25), amountCents: NET, kind: "income", categoryId: C["Salary (net)"], description: "Payroll — net deposit" });
      txns.push({ spaceId: S.alex, accountId: A.alexChecking, date: d(m, 25), amountCents: WITHHELD, kind: "payroll_withholding", description: "Payroll withholding (gross $3,000)" });
      txns.push({ spaceId: S.alex, accountId: A.alexChecking, counterAccountId: A.alexTravel, date: d(m, 26), amountCents: 100000, kind: "savings_allocation", goalId: G.alexTravel, categoryId: C["Personal savings"], description: "Friends travel fund" });
      txns.push({ spaceId: S.alex, accountId: A.alexChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: B.alexPhone, categoryId: C["Phone"], description: "Phone" });
      txns.push({ spaceId: S.alex, accountId: A.alexChecking, date: d(m, 5), amountCents: 4500, kind: "bill_payment", billId: B.alexGym, categoryId: C["Fitness"], description: "Gym" });
      for (const [day, amt, desc, catName] of [[4, 3800, "Lunch with Priya", "Dining"], [11, 4200, "Dinner", "Dining"], [17, 12000, "Jacket", "Clothing"], [22, 2600, "Transit pass top-up", "Transport"]] as const) {
        txns.push({ spaceId: S.alex, accountId: A.alexCard, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C[catName], description: desc });
      }
      txns.push({ spaceId: S.alex, accountId: A.alexChecking, counterAccountId: A.alexCard, date: d(m, 20), amountCents: 22600, kind: "cc_payment", description: "Card payment" });
      // Sam
      txns.push({ spaceId: S.sam, accountId: A.samChecking, date: d(m, 25), amountCents: NET, kind: "income", categoryId: C["Salary (net)"], description: "Payroll — net deposit" });
      txns.push({ spaceId: S.sam, accountId: A.samChecking, date: d(m, 25), amountCents: WITHHELD, kind: "payroll_withholding", description: "Payroll withholding (gross $3,000)" });
      txns.push({ spaceId: S.sam, accountId: A.samChecking, counterAccountId: A.samSavings, date: d(m, 26), amountCents: 30000, kind: "savings_allocation", goalId: G.samCushion, categoryId: C["Personal savings"], description: "Emergency cushion" });
      txns.push({ spaceId: S.sam, accountId: A.samChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: B.samPhone, categoryId: C["Phone"], description: "Phone" });
      txns.push({ spaceId: S.sam, accountId: A.samChecking, date: d(m, 14), amountCents: 1900, kind: "bill_payment", billId: B.samStreaming, categoryId: C["Entertainment"], description: "Streaming" });
      for (const [day, amt, desc, catName] of [[3, 5400, "Bike parts", "Transport"], [9, 3100, "Coffee & pastries", "Dining"], [16, 6900, "Concert tickets", "Entertainment"], [23, 4700, "Dinner", "Dining"]] as const) {
        txns.push({ spaceId: S.sam, accountId: A.samCard, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C[catName], description: desc });
      }
      txns.push({ spaceId: S.sam, accountId: A.samChecking, counterAccountId: A.samCard, date: d(m, 20), amountCents: 20100, kind: "cc_payment", description: "Card payment" });
    }
    // Annual bills and one ad-hoc owner distribution.
    txns.push({ spaceId: S.company, accountId: A.coOperating, date: "2026-07-01", amountCents: 120000, kind: "bill_payment", billId: B.coInsurance, categoryId: C["Business insurance"], description: "Business insurance (annual)" });
    txns.push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.hhChecking, date: "2026-07-28", amountCents: 200000, kind: "transfer", categoryId: C["Owner distribution"], description: "Owner distribution to household (ad hoc)" });
    // Current month so far (September 2026).
    const m = "2026-09";
    txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 1), amountCents: 90000, kind: "bill_payment", billId: B.coCoworking, categoryId: C["Facilities"], description: "Coworking desks" });
    txns.push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 3), amountCents: 40000, kind: "bill_payment", billId: B.coSoftware, categoryId: C["Software"], description: "Software subscriptions" });
    txns.push({ spaceId: S.company, accountId: A.coCard, date: d(m, 7), amountCents: 18000, kind: "expense", categoryId: C["Hosting"], description: "Cloud hosting" });
    txns.push({ spaceId: S.alex, accountId: A.alexChecking, counterAccountId: A.hhChecking, date: d(m, 1), amountCents: 80000, kind: "transfer", description: "Household contribution — Alex" });
    txns.push({ spaceId: S.sam, accountId: A.samChecking, counterAccountId: A.hhChecking, date: d(m, 1), amountCents: 80000, kind: "transfer", description: "Household contribution — Sam" });
    txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 2), amountCents: 180000, kind: "bill_payment", billId: B.hhRent, categoryId: C["Housing"], description: "Rent" });
    txns.push({ spaceId: S.household, accountId: A.hhChecking, counterAccountId: A.hhSavings, date: d(m, 3), amountCents: 30000, kind: "savings_allocation", goalId: G.hhEmergency, categoryId: C["Household savings"], description: "Emergency fund allocation" });
    txns.push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 6), amountCents: 12700, kind: "expense", categoryId: C["Groceries"], description: "Groceries" });
    txns.push({ spaceId: S.alex, accountId: A.alexChecking, date: d(m, 5), amountCents: 4500, kind: "bill_payment", billId: B.alexGym, categoryId: C["Fitness"], description: "Gym" });
    txns.push({ spaceId: S.alex, accountId: A.alexChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: B.alexPhone, categoryId: C["Phone"], description: "Phone" });
    txns.push({ spaceId: S.alex, accountId: A.alexCard, date: d(m, 4), amountCents: 3600, kind: "expense", categoryId: C["Dining"], description: "Lunch" });
    txns.push({ spaceId: S.sam, accountId: A.samChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: B.samPhone, categoryId: C["Phone"], description: "Phone" });
    txns.push({ spaceId: S.sam, accountId: A.samCard, date: d(m, 3), amountCents: 2800, kind: "expense", categoryId: C["Transport"], description: "Bike tube" });

    tx.insert(s.transactions).values(
      txns.map((t, i) => ({ ...t, id: `txn_demo_${String(i + 1).padStart(4, "0")}`, source: "seed" as const, createdAt })),
    ).run();
  });
}
