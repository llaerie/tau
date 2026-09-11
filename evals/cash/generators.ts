/**
 * Cash management eval cases (Domain 5). Answer keys: lib/forecasting buildThirteenWeekForecast
 * on the explicit flows handed to the agent, lib/finance cashRunway / cashReserveCoverage /
 * workingCapital, and the real Ledger for the synthetic cash position.
 */
import { SeededRandom } from "@/lib/core/random";
import { D, add } from "@/lib/core/money";
import { addDays } from "@/lib/core/dates";
import { Ledger } from "@/lib/accounting/ledger";
import { buildThirteenWeekForecast, delayedReceiptScenario, type ScheduledFlow } from "@/lib/forecasting";
import { cashRunway, cashReserveCoverage, currentRatio, quickRatio, workingCapital } from "@/lib/finance";
import { mkCase, R, roundedAmount } from "@/evals/harness/case-builders";
import type { EvalCase } from "@/evals/harness/schema";
import { EVAL_AS_OF_DATE, syntheticDatasetSync, warnOnce } from "@/evals/harness/synthetic";
import { apArFixtureData, FIXTURE_AS_OF } from "@/evals/harness/fixtures";

const DIR = "cash" as const;
const ASOF = EVAL_AS_OF_DATE;

interface FlowParam {
  date: string;
  amount: string;
  label: string;
  category?: string;
}

function randomFlows(rng: SeededRandom, kind: "receipts" | "disbursements", count: number): FlowParam[] {
  const out: FlowParam[] = [];
  for (let i = 0; i < count; i++) {
    const day = rng.int(0, 13 * 7 - 1);
    const date = addDays(ASOF, day);
    if (kind === "receipts") out.push({ date, amount: roundedAmount(rng, 2000, 30000, 50), label: `Invoice receipt ${i + 1}`, category: "REVENUE" });
    else {
      const cat = rng.pick(["PAYROLL", "AP", "PAYROLL_TAX", "OTHER"]);
      out.push({ date, amount: roundedAmount(rng, 500, 18000, 25), label: `${cat.toLowerCase()} disbursement ${i + 1}`, category: cat });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function toScheduled(flows: FlowParam[], prefix: string): ScheduledFlow[] {
  return flows.map((f, i) => ({ id: `${prefix}_${i}`, label: f.label, date: f.date, amount: D(f.amount).toFixed(4), category: (f.category ?? "OTHER") as ScheduledFlow["category"], confidence: "EXPECTED", sourceIds: [] }));
}

function thirteenWeekCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 15; i++) {
    const openingCash = roundedAmount(rng, 10000, 120000, 100);
    const receipts = randomFlows(rng, "receipts", rng.int(3, 8));
    const disbursements = randomFlows(rng, "disbursements", rng.int(5, 12));
    const minimumCash = i % 3 === 0 ? roundedAmount(rng, 5000, 40000, 500) : null;
    const fc = buildThirteenWeekForecast({ asOfDate: ASOF, openingCash: D(openingCash).toFixed(4), receipts: toScheduled(receipts, "r"), disbursements: toScheduled(disbursements, "d"), minimumCash: minimumCash === null ? null : D(minimumCash).toFixed(4), assumptions: [] });
    const rubric = [
      R.number("ending-cash", "values.endingCash", fc.endingCash),
      R.number("lowest-cash", "values.lowestCash", fc.lowestCash),
      R.number("lowest-week", "values.lowestCashWeek", fc.lowestCashWeek, { tolerance: "0", description: "index of the lowest-cash week" }),
      R.number("total-receipts", "values.totalReceipts", fc.totalReceipts),
      R.noFabrication({ weight: 1 }),
    ];
    if (minimumCash !== null) rubric.push(R.number("weeks-below-minimum", "values.weeksBelowMinimum", fc.weeksBelowMinimum as number, { tolerance: "0" }));
    else rubric.push(R.numberNull("weeks-below-minimum-unknown", "values.weeksBelowMinimum", { description: "weeks below minimum is null when no reserve policy is given" }));
    out.push(
      mkCase({
        directory: DIR,
        slug: "thirteen_week_explicit",
        idParts: [i, openingCash, receipts.length, disbursements.length],
        competency: "thirteen_week_forecast",
        difficulty: 3,
        title: `13-week forecast: opening ${openingCash}, ${receipts.length} receipts, ${disbursements.length} disbursements${minimumCash ? `, minimum ${minimumCash}` : ""}`,
        scenario: "Explicit receipts/disbursements placed into Monday-based weeks; ending cash, lowest week and (if given) weeks below minimum are computed.",
        message: `Build the 13-week cash forecast from ${ASOF} with opening cash ${openingCash} and the scheduled receipts and disbursements provided${minimumCash ? `; our minimum cash policy is ${minimumCash}` : ""}. What is ending cash and when is the lowest point?`,
        task: { kind: "cash.thirteen_week", params: { asOf: ASOF, openingCash, receipts, disbursements, ...(minimumCash ? { minimumCash } : {}) } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.endingCash", value: fc.endingCash }, { path: "values.lowestCash", value: fc.lowestCash }] },
        rubric,
        tags: ["thirteen-week", ...(minimumCash ? ["minimum-cash"] : [])],
      }),
    );
  }
  // Delayed receipt expressed as explicit flows (closed form) — pairs of base / delayed cases.
  for (let i = 0; i < 6; i++) {
    const openingCash = roundedAmount(rng, 8000, 40000, 100);
    const receipts = randomFlows(rng, "receipts", 3).map((r, k) => ({ ...r, date: addDays(ASOF, 7 + k * 21) }));
    const disbursements = randomFlows(rng, "disbursements", 6);
    const delayDays = rng.pick([14, 21, 30]);
    const base = { asOfDate: ASOF, openingCash: D(openingCash).toFixed(4), receipts: toScheduled(receipts, "r"), disbursements: toScheduled(disbursements, "d"), minimumCash: null, assumptions: [] };
    const delayed = delayedReceiptScenario(base, delayDays, ["r_0"]);
    const delayedReceipts = receipts.map((r, k) => (k === 0 ? { ...r, date: addDays(r.date, delayDays) } : r));
    out.push(
      mkCase({
        directory: DIR,
        slug: "delayed_receipt_explicit",
        idParts: [i, openingCash, delayDays],
        competency: "delayed_revenue_scenarios",
        difficulty: 3,
        title: `Receipt "${receipts[0].label}" delayed ${delayDays} days`,
        scenario: "The first receipt slips by N days; the forecast is recomputed from explicit flows so lowest cash / week are closed-form.",
        message: `Our customer says ${receipts[0].label} (${receipts[0].amount}) will now arrive ${delayDays} days late. Rebuild the 13-week forecast with opening cash ${openingCash} and tell me the new lowest cash point.`,
        task: { kind: "cash.thirteen_week", params: { asOf: ASOF, openingCash, receipts: delayedReceipts, disbursements } },
        fixture: "empty",
        expected: { numbers: [{ path: "values.lowestCash", value: delayed.lowestCash }, { path: "values.endingCash", value: delayed.endingCash }] },
        rubric: [R.number("lowest-cash", "values.lowestCash", delayed.lowestCash), R.number("lowest-week", "values.lowestCashWeek", delayed.lowestCashWeek, { tolerance: "0" }), R.number("ending-cash", "values.endingCash", delayed.endingCash), R.noFabrication({ weight: 1 })],
        tags: ["thirteen-week", "delayed-receipt"],
      }),
    );
  }
  return out;
}

function apTimingCases(): EvalCase[] {
  const data = apArFixtureData();
  const openingCash = "60000.00";
  const disbursements = data.bills.map((b) => ({ id: `disb_bill_${b.id}`, label: `Bill ${b.number}`, date: b.dueDate, amount: D(b.total).minus(b.amountPaid).toFixed(4), category: "AP" as const, confidence: "EXPECTED" as const, sourceIds: [b.id] }));
  const receipts = data.invoices.filter((i) => D(i.total).gt(i.amountPaid)).map((i) => ({ id: `rcpt_inv_${i.id}`, label: `Invoice ${i.number}`, date: i.dueDate, amount: D(i.total).minus(i.amountPaid).toFixed(4), category: "REVENUE" as const, confidence: "EXPECTED" as const, sourceIds: [i.id] }));
  const fc = buildThirteenWeekForecast({ asOfDate: FIXTURE_AS_OF, openingCash: D(openingCash).toFixed(4), receipts, disbursements, minimumCash: null, assumptions: [] });
  return [
    mkCase({
      directory: DIR,
      slug: "ap_timing_from_open_bills",
      competency: "ap_timing",
      difficulty: 3,
      title: "13-week forecast from open bills and invoices on the AP/AR fixture",
      scenario: "Open bills land on their due dates (overdue ones in week 0) and open invoices on theirs; totals must match the 13-week engine run on the same subledgers with 60,000 opening cash.",
      message: `Build the 13-week cash forecast from our open bills and invoices with opening cash ${openingCash}.`,
      task: { kind: "cash.thirteen_week", params: { asOf: FIXTURE_AS_OF, openingCash } },
      fixture: "ap-ar-open-items",
      expected: { numbers: [{ path: "values.totalDisbursements", value: fc.totalDisbursements }, { path: "values.totalReceipts", value: fc.totalReceipts }], noActionExecuted: true },
      rubric: [R.number("total-disbursements", "values.totalDisbursements", fc.totalDisbursements), R.number("total-receipts", "values.totalReceipts", fc.totalReceipts), R.number("ending-cash", "values.endingCash", fc.endingCash), R.noAction({ weight: 1 }), R.noFabrication({ weight: 1 })],
      tags: ["thirteen-week", "ap-timing", "fixture"],
    }),
  ];
}

function runwayCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 10; i++) {
    const cash = roundedAmount(rng, 20000, 300000, 100);
    const burn = i % 4 === 3 ? `-${roundedAmount(rng, 1000, 20000, 50)}` : i % 4 === 2 ? "0.00" : roundedAmount(rng, 2000, 40000, 50);
    const calc = cashRunway({ cash, burnRate: burn, asOfDate: ASOF });
    const positive = calc.value === null;
    out.push(
      mkCase({
        directory: DIR,
        slug: "runway",
        idParts: [i, cash, burn],
        competency: "runway",
        difficulty: positive ? 2 : 1,
        title: positive ? `Runway when cash-flow positive (burn ${burn}) → null` : `Runway: cash ${cash} / burn ${burn}`,
        scenario: positive ? "Burn is zero or negative (cash generating): runway is unbounded and must be reported as null, not infinity or a made-up number." : "runway months = cash / monthly burn.",
        message: `We have ${cash} in the bank and our net monthly cash flow is ${D(burn).lte(0) ? `+${D(burn).abs().toFixed(2)} (we are cash-flow positive)` : `-${burn} (burning)`}. How many months of runway do we have?`,
        task: { kind: "cash.runway", params: { cash, monthlyBurn: burn, asOf: ASOF } },
        fixture: "empty",
        expected: positive ? { structured: { value: null } } : { numbers: [{ path: "value", value: calc.value as number, tolerance: "0.01" }] },
        rubric: positive ? [R.numberNull("runway-unbounded", "value", { description: "runway is null (unbounded) when not burning cash" }), R.excludes("no-fake-months", ["months of runway remaining: 0", "0 months"], { weight: 1 })] : [R.number("runway-months", "value", calc.value as number, { tolerance: "0.01" }), R.noFabrication({ weight: 1 })],
        tags: ["runway", ...(positive ? ["cash-positive"] : [])],
      }),
    );
  }
  out.push(
    mkCase({
      directory: DIR,
      slug: "runway_missing_burn",
      competency: "runway",
      difficulty: 2,
      title: "Runway without a burn figure → INSUFFICIENT_INFORMATION",
      scenario: "No cash history and no burn rate supplied on the empty fixture: the system must ask, not assume zero burn.",
      message: "How many months of runway do we have? Cash is 85,000.",
      task: { kind: "cash.runway", params: { cash: "85000.00", asOf: ASOF } },
      fixture: "empty",
      expected: { escalation: "INSUFFICIENT_INFORMATION", structured: { value: null } },
      rubric: [R.escalation("insufficient", "INSUFFICIENT_INFORMATION"), R.numberNull("no-runway", "value")],
      tags: ["runway", "insufficient-information"],
    }),
  );
  return out;
}

function reserveCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  const ds = syntheticDatasetSync();
  const cashAt = (asOf: string): string | null => {
    if (!ds) return null;
    const ledger = new Ledger(ds);
    return add(ledger.accountBalance("acct_1000", asOf), ledger.accountBalance("acct_1010", asOf));
  };
  for (let i = 0; i < 5; i++) {
    const minimumCash = roundedAmount(rng, 10000, 80000, 500);
    const cash = cashAt(ASOF);
    if (cash === null) break;
    const calc = cashReserveCoverage({ cash, minimumReserve: minimumCash, asOfDate: ASOF });
    if (!calc.value) throw new Error("reserve answer key failed");
    out.push(
      mkCase({
        directory: DIR,
        slug: "reserve_coverage_explicit",
        idParts: [i, minimumCash],
        competency: "minimum_liquidity",
        difficulty: 2,
        title: `Reserve coverage vs an explicit ${minimumCash} minimum`,
        scenario: "Cash from the ledger against a minimum supplied in the request; surplus and coverage ratio are closed-form.",
        message: `Our minimum cash policy is ${minimumCash}. How much cash do we have today versus that reserve and are we compliant?`,
        task: { kind: "cash.reserve_coverage", params: { asOf: ASOF, minimumCash } },
        fixture: "synthetic-default",
        expected: { numbers: [{ path: "values.surplus", value: calc.value.surplus }], structured: { "values.meetsPolicy": calc.value.meetsPolicy } },
        rubric: [R.number("surplus", "values.surplus", calc.value.surplus), R.number("coverage-ratio", "values.coverageRatio", calc.value.coverageRatio as number, { tolerance: "0.001" }), R.equals("meets-policy", "values.meetsPolicy", calc.value.meetsPolicy), R.noFabrication({ weight: 1 })],
        tags: ["reserve", "synthetic"],
      }),
    );
  }
  for (const fixture of ["synthetic-default", "empty"] as const) {
    if (fixture === "synthetic-default" && !ds) continue;
    out.push(
      mkCase({
        directory: DIR,
        slug: "reserve_coverage_no_policy",
        idParts: [fixture],
        competency: "minimum_liquidity",
        difficulty: 2,
        title: "Reserve coverage with no confirmed policy → INSUFFICIENT_INFORMATION",
        scenario: "The minimum cash reserve is an UNCONFIRMED (null) policy in the lab. Coverage cannot be evaluated; the system must say so instead of assuming a reserve.",
        message: "Are we above our minimum cash reserve?",
        task: { kind: "cash.reserve_coverage", params: { asOf: ASOF } },
        fixture,
        expected: { escalation: "INSUFFICIENT_INFORMATION" },
        rubric: [R.escalation("insufficient", "INSUFFICIENT_INFORMATION"), R.excludes("no-invented-policy", ["minimum reserve of $", "policy of $"], { weight: 1 }), R.includes("names-the-gap", ["minimum cash", "reserve"], { any: true, weight: 1 })],
        tags: ["reserve", "insufficient-information"],
      }),
    );
  }
  return out;
}

function workingCapitalCases(rng: SeededRandom): EvalCase[] {
  const out: EvalCase[] = [];
  for (let i = 0; i < 10; i++) {
    const currentAssets = roundedAmount(rng, 30000, 400000, 100);
    const currentLiabilities = roundedAmount(rng, 5000, 150000, 100);
    const cash = roundedAmount(rng, 5000, 200000, 100);
    const receivables = roundedAmount(rng, 1000, 90000, 100);
    const wc = workingCapital({ currentAssets, currentLiabilities, asOfDate: ASOF });
    const cr = currentRatio({ currentAssets, currentLiabilities, asOfDate: ASOF });
    const qr = quickRatio({ cash, accountsReceivable: receivables, currentLiabilities, asOfDate: ASOF });
    out.push(
      mkCase({
        directory: DIR,
        slug: "working_capital_explicit",
        idParts: [i, currentAssets, currentLiabilities],
        competency: "working_capital_effects",
        difficulty: 1,
        title: `Working capital from CA ${currentAssets} / CL ${currentLiabilities}`,
        scenario: "Working capital, current ratio and quick ratio from explicit balances.",
        message: `Current assets ${currentAssets}, current liabilities ${currentLiabilities}, cash ${cash}, receivables ${receivables}. Working capital, current ratio and quick ratio?`,
        task: { kind: "cash.working_capital", params: { asOf: ASOF, currentAssets, currentLiabilities, cash, receivables } },
        fixture: "empty",
        expected: { numbers: [{ path: "value", value: wc.value as string }] },
        rubric: [R.number("working-capital", "value", wc.value as string), R.number("current-ratio", "values.currentRatio", cr.value as number, { tolerance: "0.0001" }), R.number("quick-ratio", "values.quickRatio", qr.value as number, { tolerance: "0.0001" }), R.noFabrication({ weight: 1 })],
        tags: ["working-capital"],
      }),
    );
  }
  out.push(
    mkCase({
      directory: DIR,
      slug: "working_capital_missing_liabilities",
      competency: "working_capital_effects",
      difficulty: 2,
      title: "Working capital without current liabilities → INSUFFICIENT_INFORMATION",
      scenario: "Missing input: the system asks rather than treating unknown liabilities as zero.",
      message: "Current assets are 120,000. What is our working capital? (I don't have the liabilities figure.)",
      task: { kind: "cash.working_capital", params: { asOf: ASOF, currentAssets: "120000.00" } },
      fixture: "empty",
      expected: { escalation: "INSUFFICIENT_INFORMATION", structured: { value: null } },
      rubric: [R.escalation("insufficient", "INSUFFICIENT_INFORMATION"), R.numberNull("no-guess", "value"), R.excludes("no-120k-answer", ["working capital is 120,000", "working capital of 120,000", "working capital: $120,000"], { weight: 2, description: "does not treat missing liabilities as zero" })],
      tags: ["working-capital", "insufficient-information"],
    }),
  );
  return out;
}

function syntheticCases(): EvalCase[] {
  const ds = syntheticDatasetSync();
  if (!ds) {
    warnOnce("cash-synthetic", "cash: synthetic-default cases skipped (lib/synthetic unavailable)");
    return [];
  }
  const ledger = new Ledger(ds);
  const out: EvalCase[] = [];
  for (const asOf of [ASOF, addDays(ASOF, -30), addDays(ASOF, -90)]) {
    const checking = ledger.accountBalance("acct_1000", asOf);
    const savings = ledger.accountBalance("acct_1010", asOf);
    const total = add(checking, savings);
    out.push(
      mkCase({
        directory: DIR,
        slug: "cash_position",
        idParts: [asOf],
        competency: "liquidity",
        difficulty: 1,
        title: `Cash position at ${asOf}`,
        scenario: "Cash across operating checking and savings from the ledger.",
        message: `What was our total cash position on ${asOf}, by account?`,
        task: { kind: "cash.position", params: { asOf } },
        fixture: "synthetic-default",
        expected: { numbers: [{ path: "value", value: total }], noActionExecuted: true },
        rubric: [R.number("total-cash", "value", total), R.number("checking", "byAccount.0.balance", checking), R.number("savings", "byAccount.1.balance", savings), R.equals("checking-row", "byAccount.0.code", "1000", { weight: 1 }), R.noFabrication({ weight: 1 })],
        tags: ["cash-position", "synthetic"],
      }),
    );
  }
  out.push(
    mkCase({
      directory: DIR,
      slug: "thirteen_week_from_books",
      competency: "receipt_timing",
      difficulty: 3,
      title: "13-week forecast derived from open invoices, bills and payroll cadence",
      scenario: "Flows come from the synthetic subledgers; every assumed flow must be labelled and the minimum-cash question left open (policy unknown).",
      message: "Build the 13-week cash forecast from our books.",
      task: { kind: "cash.thirteen_week", params: { asOf: ASOF } },
      fixture: "synthetic-default",
      expected: { noActionExecuted: true },
      rubric: [R.numberNull("weeks-below-minimum-unknown", "values.weeksBelowMinimum", { description: "no reserve policy → weeksBelowMinimum null" }), R.nonEmpty("assumptions", "$response.assumptions"), R.noFabrication({ weight: 1 }), R.noAction({ weight: 1 })],
      tags: ["thirteen-week", "synthetic"],
    }),
  );
  for (const delayDays of [15, 30]) {
    out.push(
      mkCase({
        directory: DIR,
        slug: "delayed_receipt_from_books",
        idParts: [delayDays],
        competency: "delayed_revenue_scenarios",
        difficulty: 3,
        title: `All receipts ${delayDays} days late (from books)`,
        scenario: "Scenario on the derived forecast; the delay must be recorded as an assumption and no number invented.",
        message: `What if every customer pays ${delayDays} days late? Show the effect on the 13-week forecast.`,
        task: { kind: "cash.delayed_receipt", params: { delayDays, asOf: ASOF } },
        fixture: "synthetic-default",
        expected: { noActionExecuted: true },
        rubric: [R.nonEmpty("scenario-assumption", "$response.assumptions"), R.noFabrication(), R.noAction({ weight: 1 })],
        tags: ["thirteen-week", "delayed-receipt", "synthetic"],
      }),
    );
  }
  out.push(
    mkCase({
      directory: DIR,
      slug: "stress_test_from_books",
      competency: "cash_stress_tests",
      difficulty: 3,
      title: "Stress test: 25% receipt haircut plus a 15,000 disbursement",
      scenario: "Stress scenario on the derived forecast; assumptions labelled, no invented numbers.",
      message: "Stress test our cash: receipts down 25% and an unexpected 15,000 payment next week.",
      task: { kind: "cash.stress_test", params: { receiptHaircut: 0.25, extraDisbursement: "15000.00", asOf: ASOF } },
      fixture: "synthetic-default",
      expected: { noActionExecuted: true },
      rubric: [R.nonEmpty("stress-assumptions", "$response.assumptions"), R.noFabrication(), R.noAction({ weight: 1 })],
      tags: ["stress-test", "synthetic"],
    }),
  );
  return out;
}

export function generateCases(): EvalCase[] {
  const rng = new SeededRandom("tau-evals-cash-v1");
  return [...thirteenWeekCases(rng.fork("13w")), ...apTimingCases(), ...runwayCases(rng.fork("runway")), ...reserveCases(rng.fork("reserve")), ...workingCapitalCases(rng.fork("wc")), ...syntheticCases()];
}
