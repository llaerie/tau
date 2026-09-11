import { eq } from "drizzle-orm";
import { defaultAssumptions } from "../assumptions";
import { nowIso } from "../ids";
import type { Db } from "./index";
import * as s from "./schema";
import { applyTemplateRecords, TEMPLATE } from "./template";

/**
 * Synthetic demo data for Will and Arielle. Plan facts come from the template;
 * balances, deposits and purchases are fictional and reconcile in cents. Ids
 * are deterministic so the seed is idempotent and tests can rely on it.
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
    coCard: "acc_demo_co_card",
    hhChecking: "acc_demo_hh_checking",
    willChecking: "acc_demo_will_checking",
    willCard: "acc_demo_will_card",
    arielleChecking: "acc_demo_arielle_checking",
    arielleSavings: "acc_demo_arielle_savings",
    arielleCard: "acc_demo_arielle_card",
  },
} as const;

/** Bump when the synthetic data set changes so existing DEMO databases are refreshed. Live workspaces are never touched. */
export const DEMO_SEED_VERSION = "3";

export function demoWorkspaceExists(db: Db): boolean {
  return db.select({ id: s.workspaces.id }).from(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).get() !== undefined;
}

export function ensureDemoWorkspace(db: Db): void {
  const stored = db.select().from(s.meta).where(eq(s.meta.key, "demo_seed_version")).get()?.value;
  if (demoWorkspaceExists(db) && stored === DEMO_SEED_VERSION) return;
  if (demoWorkspaceExists(db)) db.delete(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).run();
  seedDemoWorkspace(db);
  db.insert(s.meta).values({ key: "demo_seed_version", value: DEMO_SEED_VERSION }).onConflictDoUpdate({ target: s.meta.key, set: { value: DEMO_SEED_VERSION } }).run();
}

/** Only ever called for the demo workspace (guarded by the caller). */
export function resetDemoWorkspace(db: Db): void {
  const ws = db.select().from(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).get();
  if (ws && !ws.isDemo) throw new Error("Refusing to reset a non-demo workspace");
  db.delete(s.workspaces).where(eq(s.workspaces.id, DEMO.workspaceId)).run();
  seedDemoWorkspace(db);
}

type TxnSeed = Omit<typeof s.transactions.$inferInsert, "id" | "createdAt" | "source">;

export function seedDemoWorkspace(db: Db): void {
  const createdAt = nowIso();
  const A = DEMO.accounts;
  const S = DEMO.spaces;
  const P = DEMO.persons;

  db.transaction((tx) => {
    tx.insert(s.workspaces).values({ id: DEMO.workspaceId, name: `${TEMPLATE.companyName} (demo)`, isDemo: true, createdAt }).run();
    for (const u of Object.values(DEMO.users)) {
      tx.insert(s.users).values({ id: u.id, email: u.email, name: u.name, passwordHash: null, isDemo: true, createdAt }).onConflictDoNothing().run();
      tx.insert(s.memberships).values({ id: `mem_${u.id}`, workspaceId: DEMO.workspaceId, userId: u.id, role: u.id === DEMO.users.will.id ? "owner" : "member", createdAt }).run();
    }
    const [will, arielle] = TEMPLATE.persons;
    tx.insert(s.persons).values([
      { id: P.will, workspaceId: DEMO.workspaceId, slug: will.slug, name: will.name, title: will.title, userId: DEMO.users.will.id },
      { id: P.arielle, workspaceId: DEMO.workspaceId, slug: arielle.slug, name: arielle.name, title: arielle.title, userId: DEMO.users.arielle.id },
    ]).run();
    tx.insert(s.spaces).values([
      { id: S.company, workspaceId: DEMO.workspaceId, kind: "company", name: TEMPLATE.companyName, personId: null },
      { id: S.household, workspaceId: DEMO.workspaceId, kind: "household", name: "Household", personId: null },
      { id: S.will, workspaceId: DEMO.workspaceId, kind: "personal", name: will.name, personId: P.will },
      { id: S.arielle, workspaceId: DEMO.workspaceId, kind: "personal", name: arielle.name, personId: P.arielle },
    ]).run();
    tx.insert(s.spacePermissions).values([
      { id: "perm_demo_1", spaceId: S.company, userId: DEMO.users.will.id, role: "owner" },
      { id: "perm_demo_2", spaceId: S.company, userId: DEMO.users.arielle.id, role: "editor" },
      { id: "perm_demo_3", spaceId: S.household, userId: DEMO.users.will.id, role: "owner" },
      { id: "perm_demo_4", spaceId: S.household, userId: DEMO.users.arielle.id, role: "owner" },
      { id: "perm_demo_5", spaceId: S.will, userId: DEMO.users.will.id, role: "owner" },
      { id: "perm_demo_6", spaceId: S.arielle, userId: DEMO.users.arielle.id, role: "owner" },
    ]).run();
    tx.insert(s.userPreferences).values([
      { userId: DEMO.users.will.id, theme: "system", spokenReplies: false, sharePersonalSummary: true, updatedAt: createdAt },
      { userId: DEMO.users.arielle.id, theme: "system", spokenReplies: false, sharePersonalSummary: true, updatedAt: createdAt },
    ]).onConflictDoNothing().run();

    const asOf = "2026-06-01";
    tx.insert(s.accounts).values([
      { id: A.coOperating, spaceId: S.company, name: "Operating checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 4200000, openingBalanceAsOf: asOf },
      { id: A.coCard, spaceId: S.company, name: "Company card", type: "credit_card", institution: "Demo Card", openingBalanceCents: 0, openingBalanceAsOf: asOf },
      { id: A.hhChecking, spaceId: S.household, name: "Joint checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 310000, openingBalanceAsOf: asOf },
      { id: A.willChecking, spaceId: S.will, name: "Will checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 520000, openingBalanceAsOf: asOf },
      { id: A.willCard, spaceId: S.will, name: "Will card", type: "credit_card", institution: "Demo Card", openingBalanceCents: 0, openingBalanceAsOf: asOf },
      { id: A.arielleChecking, spaceId: S.arielle, name: "Arielle checking", type: "checking", institution: "Demo Bank", openingBalanceCents: 410000, openingBalanceAsOf: asOf },
      { id: A.arielleSavings, spaceId: S.arielle, name: "Arielle savings", type: "savings", institution: "Demo Bank", openingBalanceCents: null, openingBalanceAsOf: null },
      { id: A.arielleCard, spaceId: S.arielle, name: "Arielle card", type: "credit_card", institution: "Demo Card", openingBalanceCents: 0, openingBalanceAsOf: asOf },
    ]).run();

    applyTemplateRecords(
      tx,
      DEMO.workspaceId,
      [
        { id: S.company, kind: "company", personId: null },
        { id: S.household, kind: "household", personId: null },
        { id: S.will, kind: "personal", personId: P.will },
        { id: S.arielle, kind: "personal", personId: P.arielle },
      ],
      [
        { id: P.will, name: will.name },
        { id: P.arielle, name: arielle.name },
      ],
      "demo",
    );
    const cats = Object.fromEntries(tx.select().from(s.categories).where(eq(s.categories.workspaceId, DEMO.workspaceId)).all().map((c) => [c.name, c.id]));
    const extra = [
      ["Service revenue", "company"], ["Gross wages", "company"], ["Owner distribution", "company"], ["Bookkeeping", "company"],
      ["Salary (net)", "personal"], ["Phone", "personal"], ["Fitness", "personal"], ["Shopping", "personal"], ["Personal savings", "personal"],
    ] as const;
    for (const [name, group] of extra) {
      const id = `cat_demo_${name.toLowerCase().replace(/[^a-z]+/g, "_")}`;
      tx.insert(s.categories).values({ id, workspaceId: DEMO.workspaceId, name, group }).run();
      cats[name] = id;
    }
    const C = cats;
    const bills = tx.select().from(s.bills).all();
    const bill = (name: string) => bills.find((b) => b.name === name)?.id ?? null;
    tx.insert(s.bills).values([
      { id: "bill_demo_co_bookkeeping", spaceId: S.company, name: "Bookkeeping", amountCents: 25000, cadence: "monthly", dueDay: 10, categoryId: C["Bookkeeping"], isActive: true, payerSpaceId: null, beneficiary: "company", purpose: "business", treatment: "expense", source: "demo" },
      { id: "bill_demo_will_phone", spaceId: S.will, name: "Phone", amountCents: 6000, cadence: "monthly", dueDay: 8, categoryId: C["Phone"], isActive: true, payerSpaceId: null, beneficiary: "person", purpose: "personal", treatment: "none", source: "demo" },
      { id: "bill_demo_will_gym", spaceId: S.will, name: "Gym", amountCents: 4500, cadence: "monthly", dueDay: 5, categoryId: C["Fitness"], isActive: true, payerSpaceId: null, beneficiary: "person", purpose: "personal", treatment: "none", source: "demo" },
      { id: "bill_demo_arielle_phone", spaceId: S.arielle, name: "Phone", amountCents: 6000, cadence: "monthly", dueDay: 8, categoryId: C["Phone"], isActive: true, payerSpaceId: null, beneficiary: "person", purpose: "personal", treatment: "none", source: "demo" },
    ]).run();

    // Assumptions: Will has a demo withholding estimate and a hypothetical food target (ready state);
    // Arielle has neither (incomplete/attention state). Both are labelled demo values.
    const a = defaultAssumptions([P.will, P.arielle]);
    a.owners[P.will].withholding = { incomeTaxCents: 25000, incomeTaxLowCents: 15000, incomeTaxHighCents: 35000, source: "estimate" };
    a.owners[P.will].foodTargetCents = 90000;
    a.owners[P.will].allocations = [{ id: "will-savings", name: "Savings", monthlyCents: 60000, kind: "savings" }];
    a.onboardingCompleted = true;
    a.notes = "Demo workspace. Plan facts follow the owner's stated plan; balances, deposits, receipts, Will's $250 withholding estimate and $900 food target are illustrative and unverified.";
    tx.insert(s.assumptions).values({ workspaceId: DEMO.workspaceId, json: JSON.stringify(a), updatedAt: createdAt, updatedBy: null }).run();
    tx.insert(s.assumptionHistory).values({ id: "ah_demo_1", workspaceId: DEMO.workspaceId, json: JSON.stringify(a), provenance: "demo", note: "Demo seed v3", effectiveFrom: createdAt, supersededAt: null, changedBy: null }).run();

    const txns: TxnSeed[] = [];
    const shares: (typeof s.expenseShares.$inferInsert)[] = [];
    const d = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`;
    const fullMonths = ["2026-06", "2026-07", "2026-08"];
    const NET_WILL = 248150; // 3,000 − 229.50 FICA − 39 SDI − 250 income-tax estimate (demo)
    const NET_ARIELLE = 273150; // 3,000 − 229.50 − 39; income tax not yet configured, deposit shown as recorded
    let n = 0;
    const push = (t: TxnSeed) => {
      n++;
      const id = `txn_demo_${String(n).padStart(4, "0")}`;
      txns.push({ ...t });
      return id;
    };
    const foodShare = (txnId: string, eventId: string, personId: string, cents: number, date: string) => shares.push({ id: `shr_${txnId}_${personId.slice(-4)}`, transactionId: txnId, economicEventId: eventId, personId, cents, categoryId: C["Food & dining"], date, settledAt: null });

    for (const m of fullMonths) {
      // Company: receipt, payroll, company-paid household bills, API usage, bookkeeping.
      push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 5), amountCents: 3000000, kind: "income", categoryId: C["Service revenue"], description: "Service payment received (related party)", beneficiary: "company", purpose: "business", treatment: "none" });
      push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 25), amountCents: 300000, kind: "expense", categoryId: C["Gross wages"], description: "Payroll — Will, gross (net + withholding remitted)", beneficiary: "person", purpose: "business", treatment: "expense" });
      push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 25), amountCents: 300000, kind: "expense", categoryId: C["Gross wages"], description: "Payroll — Arielle, gross (net + withholding remitted)", beneficiary: "person", purpose: "business", treatment: "expense" });
      push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 1), amountCents: 580000, kind: "bill_payment", billId: bill("Apartment rent"), categoryId: C["Rent"], description: "Apartment rent (paid by company for the household)", beneficiary: "household", purpose: "personal", treatment: "review_required", reviewStatus: "review_required", economicEventId: `ev_rent_${m}` });
      push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 15), amountCents: 120000, kind: "bill_payment", billId: bill("Two Teslas"), categoryId: C["Vehicles"], description: "Two Teslas (paid by company for the household)", beneficiary: "household", purpose: "personal", treatment: "review_required", reviewStatus: "review_required", economicEventId: `ev_tesla_${m}` });
      push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 10), amountCents: 25000, kind: "bill_payment", billId: "bill_demo_co_bookkeeping", categoryId: C["Bookkeeping"], description: "Bookkeeping", beneficiary: "company", purpose: "business", treatment: "expense" });
      push({ spaceId: S.company, accountId: A.coCard, date: d(m, 28), amountCents: m === "2026-06" ? 12400 : m === "2026-07" ? 16900 : 18400, kind: "expense", categoryId: C["API usage"], description: "Claude API usage (metered)", beneficiary: "company", purpose: "business", treatment: "expense" });
      if (m !== "2026-06") push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.coCard, date: d(m, 20), amountCents: m === "2026-07" ? 12400 : 16900, kind: "cc_payment", description: "Company card payment" });
      push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.hhChecking, date: d(m, 2), amountCents: 150000, kind: "transfer", categoryId: C["Owner distribution"], description: "Owner distribution to joint account", treatment: "shareholder_distribution", reviewStatus: "review_required", beneficiary: "household", purpose: "personal", economicEventId: `ev_dist_${m}` });
      // Household: groceries from joint checking.
      for (const [day, amt] of [[6, 18200], [13, 16900], [20, 21400], [27, 19100]] as const) push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C["Groceries"], description: "Groceries", beneficiary: "household", purpose: "personal", treatment: "none" });
      // Will: net deposit, withholding (informational), bills, food, savings.
      push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 25), amountCents: NET_WILL, kind: "income", categoryId: C["Salary (net)"], description: "Payroll — net deposit" });
      push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 25), amountCents: 300000 - NET_WILL, kind: "payroll_withholding", description: "Payroll withholding on $3,000 gross (FICA, SDI, income tax)" });
      push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: "bill_demo_will_phone", categoryId: C["Phone"], description: "Phone" });
      push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 5), amountCents: 4500, kind: "bill_payment", billId: "bill_demo_will_gym", categoryId: C["Fitness"], description: "Gym" });
      for (const [day, amt, desc] of [[3, 1450, "Coffee and pastry"], [9, 3200, "Lunch"], [16, 5400, "Takeout"], [22, 2800, "Lunch"]] as const) {
        const id = push({ spaceId: S.will, accountId: A.willCard, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C["Food & dining"], description: desc, beneficiary: "person", purpose: "personal", treatment: "none", payerPersonId: P.will, economicEventId: `ev_wfood_${m}_${day}` });
        foodShare(id, `ev_wfood_${m}_${day}`, P.will, amt, d(m, day));
      }
      push({ spaceId: S.will, accountId: A.willChecking, counterAccountId: A.willCard, date: d(m, 20), amountCents: 12850, kind: "cc_payment", description: "Card payment" });
      // Arielle: net deposit, withholding, bills, food, one shared dinner she paid and split.
      push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 25), amountCents: NET_ARIELLE, kind: "income", categoryId: C["Salary (net)"], description: "Payroll — net deposit (income-tax withholding not configured)" });
      push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 25), amountCents: 300000 - NET_ARIELLE, kind: "payroll_withholding", description: "Payroll withholding on $3,000 gross (FICA, SDI)" });
      push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: "bill_demo_arielle_phone", categoryId: C["Phone"], description: "Phone" });
      for (const [day, amt, desc] of [[4, 1650, "Coffee"], [11, 2900, "Lunch with Maya"], [18, 4600, "Sushi takeout"]] as const) {
        const id = push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, day), amountCents: amt, kind: "expense", categoryId: C["Food & dining"], description: desc, beneficiary: "person", purpose: "personal", treatment: "none", payerPersonId: P.arielle, economicEventId: `ev_afood_${m}_${day}` });
        foodShare(id, `ev_afood_${m}_${day}`, P.arielle, amt, d(m, day));
      }
      const dinnerId = push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, 14), amountCents: 9800, kind: "expense", categoryId: C["Food & dining"], description: "Dinner together (split equally)", beneficiary: "split", purpose: "personal", treatment: "none", payerPersonId: P.arielle, economicEventId: `ev_dinner_${m}` });
      foodShare(dinnerId, `ev_dinner_${m}`, P.arielle, 4900, d(m, 14));
      foodShare(dinnerId, `ev_dinner_${m}`, P.will, 4900, d(m, 14));
      push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, 21), amountCents: 12900, kind: "expense", categoryId: C["Shopping"], description: "Boutique", beneficiary: "person", purpose: "personal", treatment: "none" });
      push({ spaceId: S.arielle, accountId: A.arielleChecking, counterAccountId: A.arielleCard, date: d(m, 20), amountCents: 31850, kind: "cc_payment", description: "Card payment" });
    }
    // September so far.
    const m = "2026-09";
    push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 1), amountCents: 580000, kind: "bill_payment", billId: bill("Apartment rent"), categoryId: C["Rent"], description: "Apartment rent (paid by company for the household)", beneficiary: "household", purpose: "personal", treatment: "review_required", reviewStatus: "review_required", economicEventId: `ev_rent_${m}` });
    push({ spaceId: S.company, accountId: A.coOperating, counterAccountId: A.hhChecking, date: d(m, 2), amountCents: 150000, kind: "transfer", categoryId: C["Owner distribution"], description: "Owner distribution to joint account", treatment: "shareholder_distribution", reviewStatus: "review_required", beneficiary: "household", purpose: "personal", economicEventId: `ev_dist_${m}` });
    push({ spaceId: S.company, accountId: A.coOperating, date: d(m, 10), amountCents: 25000, kind: "bill_payment", billId: "bill_demo_co_bookkeeping", categoryId: C["Bookkeeping"], description: "Bookkeeping", beneficiary: "company", purpose: "business", treatment: "expense" });
    push({ spaceId: S.household, accountId: A.hhChecking, date: d(m, 6), amountCents: 17300, kind: "expense", categoryId: C["Groceries"], description: "Groceries", beneficiary: "household", purpose: "personal", treatment: "none" });
    push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 5), amountCents: 4500, kind: "bill_payment", billId: "bill_demo_will_gym", categoryId: C["Fitness"], description: "Gym" });
    push({ spaceId: S.will, accountId: A.willChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: "bill_demo_will_phone", categoryId: C["Phone"], description: "Phone" });
    const wf = push({ spaceId: S.will, accountId: A.willCard, date: d(m, 4), amountCents: 2650, kind: "expense", categoryId: C["Food & dining"], description: "Lunch", beneficiary: "person", purpose: "personal", treatment: "none", payerPersonId: P.will, economicEventId: "ev_wfood_2026-09_4" });
    foodShare(wf, "ev_wfood_2026-09_4", P.will, 2650, d(m, 4));
    push({ spaceId: S.arielle, accountId: A.arielleChecking, date: d(m, 8), amountCents: 6000, kind: "bill_payment", billId: "bill_demo_arielle_phone", categoryId: C["Phone"], description: "Phone" });
    const af = push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, 3), amountCents: 1850, kind: "expense", categoryId: C["Food & dining"], description: "Coffee with Maya", beneficiary: "person", purpose: "personal", treatment: "none", payerPersonId: P.arielle, economicEventId: "ev_afood_2026-09_3" });
    foodShare(af, "ev_afood_2026-09_3", P.arielle, 1850, d(m, 3));
    const af2 = push({ spaceId: S.arielle, accountId: A.arielleCard, date: d(m, 9), amountCents: 3400, kind: "expense", categoryId: C["Food & dining"], description: "Lunch", beneficiary: "person", purpose: "personal", treatment: "none", payerPersonId: P.arielle, economicEventId: "ev_afood_2026-09_9" });
    foodShare(af2, "ev_afood_2026-09_9", P.arielle, 3400, d(m, 9));

    tx.insert(s.transactions).values(txns.map((t, i) => ({ ...t, id: `txn_demo_${String(i + 1).padStart(4, "0")}`, source: "seed" as const, createdAt }))).run();
    if (shares.length) tx.insert(s.expenseShares).values(shares).run();
  });
}
