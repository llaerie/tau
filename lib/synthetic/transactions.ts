/**
 * Recurring monthly bank and card activity: SaaS subscriptions, cloud costs, utilities,
 * insurance, bank fees, the checking → savings transfer, international worker payments,
 * savings interest, the opening capital contribution and the monthly card autopay.
 */
import { entryForBankFee, entryForOpeningBalances, entryForTransfer } from "@/lib/accounting/posting-helpers";
import { monthEnd, nextBusinessDay, pad2, previousBusinessDay } from "@/lib/core/dates";
import { D, money, neg } from "@/lib/core/money";
import type { Transaction, TransactionFlag } from "@/lib/core/types";
import { GENERATOR_ACTOR, OWNER_ACTOR, sid, type GenContext } from "./context";

export const OPENING_CAPITAL = "25000";
export const MONTHLY_SAVINGS_TRANSFER = "2000";
export const CN_WORKER_MONTHLY_FEE = "1500";

interface ChargeSpec {
  key: string;
  day: number;
  amount: string | number;
  vendor: string;
  code: string;
  description: string;
  flags?: TransactionFlag[];
  meta?: Record<string, unknown>;
}

/** Card charge on the business card, posted Dr `code` / Cr 2050. Returns null when outside the range. */
export function cardCharge(ctx: GenContext, month: string, spec: ChargeSpec): Transaction | null {
  const date = `${month}-${pad2(spec.day)}`;
  if (!ctx.inRange(date)) return null;
  const vendor = ctx.refs.vendors[spec.vendor];
  const tx = ctx.addTx({
    key: `card:${month}:${spec.key}`,
    source: "card",
    date,
    amount: neg(spec.amount),
    description: spec.description,
    merchant: vendor.name,
    counterparty: { type: "VENDOR", id: vendor.id },
    categoryCode: spec.code,
    reason: `Recurring vendor rule: ${vendor.name} → ${spec.code}`,
    flags: spec.flags,
    meta: spec.meta,
  });
  ctx.postTx(tx, spec.code);
  return tx;
}

interface BankSpec extends ChargeSpec {
  counterpartyType?: "VENDOR" | "BANK" | "TAX_AUTHORITY" | "OTHER";
}

/** Bank debit from checking on the next business day, posted Dr `code` / Cr 1000. */
export function bankDebit(ctx: GenContext, month: string, spec: BankSpec): Transaction | null {
  const date = nextBusinessDay(`${month}-${pad2(spec.day)}`);
  if (!ctx.inRange(date) || date.slice(0, 7) !== month) return null;
  const vendor = ctx.refs.vendors[spec.vendor];
  const tx = ctx.addTx({
    key: `bank:${month}:${spec.key}`,
    source: "checking",
    date,
    amount: neg(spec.amount),
    description: spec.description,
    merchant: vendor.name,
    counterparty: { type: spec.counterpartyType ?? "VENDOR", id: vendor.id },
    categoryCode: spec.code,
    reason: `Recurring vendor rule: ${vendor.name} → ${spec.code}`,
    flags: spec.flags,
    meta: spec.meta,
  });
  ctx.postTx(tx, spec.code);
  return tx;
}

function openingCapital(ctx: GenContext, month: string): void {
  const date = `${month}-01`;
  const tx = ctx.addTx({
    key: `bank:${month}:opening-capital`,
    source: "checking",
    date,
    amount: OPENING_CAPITAL,
    description: "OWNER CAPITAL CONTRIBUTION - A LIN",
    merchant: "Avery Lin (owner)",
    counterparty: { type: "OWNER", id: ctx.refs.workers.owner.id },
    categoryCode: "3000",
    approvedBy: OWNER_ACTOR.id,
    reason: "Opening capital contribution per operating agreement",
    flags: ["RELATED_PARTY"],
  });
  const entryId = sid("je", "opening-balance");
  ctx.schedule(date, (ledger) => {
    const entry = ledger.createEntry(
      entryForOpeningBalances(
        date,
        [
          { accountCode: "1000", debit: OPENING_CAPITAL, memo: "Opening cash — owner capital contribution" },
          { accountCode: "3000", credit: OPENING_CAPITAL, memo: "Paid-in capital — Avery Lin", entityRef: { type: "OWNER", id: ctx.refs.workers.owner.id } },
        ],
        { id: entryId, post: true, sourceIds: [tx.id], description: "Opening balances — owner capital contribution" },
      ),
      GENERATOR_ACTOR,
    );
    ctx.link(tx, entry);
  });
  ctx.caseTx("opening_balance", tx);
  ctx.caseEntity("opening_balance", entryId);
  ctx.mark("opening-entry", entryId);
}

function savingsTransfer(ctx: GenContext, month: string): void {
  const date = nextBusinessDay(`${month}-20`);
  if (!ctx.inRange(date)) return;
  const out = ctx.addTx({
    key: `bank:${month}:to-savings`,
    source: "checking",
    date,
    amount: neg(MONTHLY_SAVINGS_TRANSFER),
    description: "ONLINE TRANSFER TO SAVINGS ...4428",
    counterparty: { type: "BANK", id: ctx.refs.savings.id },
    categoryCode: "1010",
    reason: "Transfer between company bank accounts",
    flags: ["TRANSFER"],
  });
  const inn = ctx.addTx({
    key: `savings:${month}:from-checking`,
    source: "savings",
    date,
    amount: MONTHLY_SAVINGS_TRANSFER,
    description: "ONLINE TRANSFER FROM CHECKING ...4410",
    counterparty: { type: "BANK", id: ctx.refs.checking.id },
    categoryCode: "1000",
    reason: "Transfer between company bank accounts",
    flags: ["TRANSFER"],
  });
  out.transferPairId = inn.id;
  inn.transferPairId = out.id;
  const entryId = sid("je", `transfer:savings:${month}`);
  ctx.schedule(date, (ledger) => {
    const entry = ledger.createEntry(entryForTransfer("1000", "1010", MONTHLY_SAVINGS_TRANSFER, date, { id: entryId, post: true, sourceIds: [out.id, inn.id], description: "Monthly reserve transfer checking → savings" }), GENERATOR_ACTOR);
    ctx.link(out, entry);
    ctx.link(inn, entry);
  });
  ctx.caseTx("transfer_between_accounts", out, inn);
}

function internationalWorkerPayments(ctx: GenContext, month: string): void {
  const day = ctx.rng.int(26, 28);
  const date = previousBusinessDay(`${month}-${pad2(day)}`);
  const wireFee = ctx.rng.chance(0.4);
  if (!ctx.inRange(date)) return;
  const platform = ctx.refs.vendors.intlplatform;
  ctx.refs.workers.cn.forEach((w, i) => {
    const tx = ctx.addTx({
      key: `bank:${month}:intl-wire:${i}`,
      source: "checking",
      date,
      amount: neg(CN_WORKER_MONTHLY_FEE),
      description: `INTL PAYMENT PLATFORM WIRE REF ${month.replace("-", "")}${i + 1}`,
      merchant: platform.name,
      counterparty: { type: "OTHER", id: w.id },
      categoryCode: "6060",
      categoryStatus: "SUGGESTED",
      confidence: 0.6,
      reason: "International worker payment — classification (employee vs. contractor) unresolved; needs review",
      flags: ["INTERNATIONAL", "REVIEW_REQUIRED"],
      meta: { workerId: w.id },
    });
    ctx.postTx(tx, "6060", { tags: ["international-worker", "classification-pending"] });
    ctx.caseTx("international_worker_ambiguity", tx);
  });
  if (wireFee) {
    const fee = ctx.addTx({
      key: `bank:${month}:wire-fee`,
      source: "checking",
      date,
      amount: "-25",
      description: "INTL WIRE FEE",
      counterparty: { type: "BANK", id: ctx.refs.checking.id },
      categoryCode: "7500",
      reason: "Bank fee rule",
    });
    ctx.schedule(fee.date, (ledger) => ctx.link(fee, ledger.createEntry(entryForBankFee(fee, "1000", { id: sid("je", `tx:${fee.id}`), post: true }), GENERATOR_ACTOR)));
    ctx.caseTx("bank_fee", fee);
  }
}

function monthlyBankFee(ctx: GenContext, month: string): void {
  const date = monthEnd(`${month}-01`);
  if (!ctx.inRange(date)) return;
  const fee = ctx.addTx({
    key: `bank:${month}:service-fee`,
    source: "checking",
    date,
    amount: "-15",
    description: "MONTHLY SERVICE FEE",
    counterparty: { type: "BANK", id: ctx.refs.checking.id },
    categoryCode: "7500",
    reason: "Bank fee rule",
  });
  ctx.schedule(date, (ledger) => ctx.link(fee, ledger.createEntry(entryForBankFee(fee, "1000", { id: sid("je", `tx:${fee.id}`), post: true }), GENERATOR_ACTOR)));
  ctx.caseTx("bank_fee", fee);
}

function savingsInterest(ctx: GenContext, month: string): void {
  const date = monthEnd(`${month}-01`);
  const amount = ctx.rng.amount(1.5, 9);
  if (!ctx.inRange(date)) return;
  const tx = ctx.addTx({
    key: `savings:${month}:interest`,
    source: "savings",
    date,
    amount,
    description: "INTEREST PAID",
    counterparty: { type: "BANK", id: ctx.refs.savings.id },
    categoryCode: "4910",
    reason: "Bank interest rule",
  });
  ctx.postTx(tx, "4910", { tags: ["interest-income"] });
}

/** Generate the recurring monthly pattern for every month in the timeline. */
export function generateRecurringTransactions(ctx: GenContext): void {
  ctx.months.forEach((month, i) => {
    if (i === 0) openingCapital(ctx, month);

    // --- Card: subscriptions and variable cloud / API usage
    const awsAmount = ctx.rng.amount(1100, 2600);
    const openaiAmount = ctx.rng.amount(800, 2200);
    cardCharge(ctx, month, { key: "google", day: 1, amount: "72", vendor: "google", code: "7000", description: "GOOGLE *WORKSPACE NORTHLIGHT" });
    cardCharge(ctx, month, { key: "github", day: 3, amount: "44", vendor: "github", code: "7000", description: "GITHUB TEAM PLAN" });
    cardCharge(ctx, month, { key: "aws", day: 3, amount: awsAmount, vendor: "aws", code: "5000", description: `AMAZON WEB SERVICES AWS.AMAZON.CO ${month}` });
    cardCharge(ctx, month, { key: "openai", day: 5, amount: openaiAmount, vendor: "openai", code: "5100", description: "OPENAI *API USAGE" });
    cardCharge(ctx, month, { key: "notion", day: 8, amount: "40", vendor: "notion", code: "7000", description: "NOTION LABS INC TEAM" });
    cardCharge(ctx, month, { key: "slack", day: 12, amount: "87.50", vendor: "slack", code: "7000", description: "SLACK T* PRO PLAN" });
    cardCharge(ctx, month, { key: "zoom", day: 15, amount: "16", vendor: "zoom", code: "7000", description: "ZOOM.US 888-799-9666" });
    cardCharge(ctx, month, { key: "phone", day: 18, amount: "95", vendor: "phone", code: "7450", description: "TELNORTH MOBILE AUTOPAY" });
    cardCharge(ctx, month, { key: "adobe", day: 20, amount: "55", vendor: "adobe", code: "7000", description: "ADOBE *CREATIVE CLOUD" });

    // Occasional small supplies and a weekday team meal (both documented by policy).
    if (ctx.rng.chance(0.5)) {
      const day = ctx.rng.int(6, 24);
      const amount = ctx.rng.amount(28, 140);
      cardCharge(ctx, month, { key: "supplies", day, amount, vendor: "amazon", code: "7400", description: "AMZN MKTP US*SUPPLIES", meta: { receipt: "required" } });
    }
    if (ctx.rng.chance(0.3)) {
      const date = nextBusinessDay(`${month}-${pad2(ctx.rng.int(4, 22))}`);
      const amount = ctx.rng.amount(38, 118);
      cardCharge(ctx, month, { key: "team-meal", day: Number(date.slice(8, 10)), amount, vendor: "cafes", code: "7300", description: "SQ *LARKSPUR CAFE", meta: { receipt: "required", businessPurpose: "Weekly team lunch — planning", attendees: ["Avery Lin", "Jordan Reyes", "Sam Okafor"] } });
    }

    // --- Bank: fixed monthly costs
    bankDebit(ctx, month, { key: "payroll-fee", day: 3, amount: "60", vendor: "payroll", code: "6190", description: "PAYSTREAM PAYROLL SVC FEE" });
    bankDebit(ctx, month, { key: "insurance", day: 5, amount: "145", vendor: "insurance", code: "7250", description: "HARTLINE INSURANCE ACH PMT" });
    bankDebit(ctx, month, { key: "internet", day: 10, amount: "89", vendor: "internet", code: "7150", description: "METRONET FIBER BUSINESS ACH" });
    savingsTransfer(ctx, month);
    internationalWorkerPayments(ctx, month);
    monthlyBankFee(ctx, month);
    if (i > 0) savingsInterest(ctx, month);
  });
}

/** Pay the previous month's card statement in full from checking on the 5th. Run after all card charges exist. */
export function generateCardPayments(ctx: GenContext): void {
  const card = ctx.refs.card;
  ctx.months.forEach((month, i) => {
    if (i === 0) return;
    const prev = ctx.months[i - 1];
    const balance = ctx.ds.transactions
      .filter((t) => t.sourceAccountId === card.id && t.date.slice(0, 7) === prev)
      .reduce((acc, t) => acc.plus(D(t.amount)), D(0))
      .neg();
    if (balance.lte(0)) return;
    const date = nextBusinessDay(`${month}-05`);
    if (!ctx.inRange(date)) return;
    const amount = money(balance);
    const out = ctx.addTx({
      key: `bank:${month}:card-autopay`,
      source: "checking",
      date,
      amount: neg(amount),
      description: "CARD PAYMENT - AUTOPAY ...7731",
      counterparty: { type: "BANK", id: card.id },
      categoryCode: "2050",
      reason: "Credit card payment — settles card liability",
      flags: ["TRANSFER"],
      meta: { statementMonth: prev },
    });
    const inn = ctx.addTx({
      key: `card:${month}:payment-received`,
      source: "card",
      date,
      amount,
      description: "PAYMENT - THANK YOU",
      counterparty: { type: "BANK", id: ctx.refs.checking.id },
      categoryCode: "1000",
      reason: "Credit card payment — settles card liability",
      flags: ["TRANSFER"],
      meta: { statementMonth: prev },
    });
    out.transferPairId = inn.id;
    inn.transferPairId = out.id;
    const entryId = sid("je", `card-payment:${month}`);
    ctx.schedule(date, (ledger) => {
      const entry = ledger.createEntry(entryForTransfer("1000", "2050", amount, date, { id: entryId, post: true, sourceIds: [out.id, inn.id], tags: ["card-payment"], description: `Credit card autopay — statement ${prev}` }), GENERATOR_ACTOR);
      ctx.link(out, entry);
      ctx.link(inn, entry);
    });
    ctx.caseTx("card_payment_transfer", out, inn);
  });
}
