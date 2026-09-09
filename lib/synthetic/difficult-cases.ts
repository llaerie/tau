/**
 * Deliberately difficult one-off events, anchored relative to the end of the timeline so any
 * asOf date works. Each is registered in the ground truth (see ground-truth.ts).
 */
import { applyCorrection } from "@/lib/accounting/closing";
import { buildDepreciationEntry } from "@/lib/accounting/depreciation";
import { entryForDistribution, entryForEquipmentPurchase, entryForPrepaidAmortization, simpleEntry } from "@/lib/accounting/posting-helpers";
import { addDays, isWeekend, monthEnd, nextBusinessDay, pad2 } from "@/lib/core/dates";
import { money, neg } from "@/lib/core/money";
import type { ApprovalRequest, FixedAsset, ISODate, Transaction } from "@/lib/core/types";
import { GENERATOR_ACTOR, OWNER_ACTOR, acct, sid, ts, type GenContext } from "./context";
import { cardCharge } from "./transactions";

export const DISTRIBUTION_APPROVAL_ID = "apr_synthetic_distribution";
export const LAPTOP_COST = "2899";
export const WORKSTATION_COST = "6500";
export const PREPAID_LICENCE_COST = "1188";
export const PREPAID_MONTHLY_AMORTIZATION = "99";
export const OWNER_DISTRIBUTION = "4000";
export const FRANCHISE_TAX_PAYMENT = "800";

function saturdayOnOrAfter(date: ISODate): ISODate {
  let d = date;
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1);
  return d;
}

function addFixedAsset(ctx: GenContext, key: string, name: string, tx: Transaction, cost: string): FixedAsset {
  const asset: FixedAsset = {
    id: sid("fa", key),
    name,
    acquiredDate: tx.date,
    cost: money(cost),
    salvageValue: money(0),
    usefulLifeMonths: 36,
    method: "STRAIGHT_LINE",
    assetAccountId: acct("1500"),
    accumulatedDepreciationAccountId: acct("1590"),
    depreciationExpenseAccountId: acct("7700"),
    inServiceDate: tx.date,
    sourceTransactionId: tx.id,
    taxTreatmentStatus: "PROFESSIONAL_REVIEW_REQUIRED",
  };
  ctx.ds.fixedAssets.push(asset);
  return asset;
}

export function generateDifficultCases(ctx: GenContext): void {
  const v = ctx.refs.vendors;
  const owner = ctx.refs.workers.owner;
  const cur = (offset: number) => ctx.monthFromEnd(offset);

  // --- Equipment purchase: laptop on the card, capitalized, depreciated over 36 months.
  {
    const m = cur(12);
    const date = `${m}-14`;
    const tx = ctx.addTx({ key: `card:${m}:apple-laptop`, source: "card", date, amount: neg(LAPTOP_COST), description: "APPLE STORE #R123 PALO ALTO", merchant: v.apple.name, counterparty: { type: "VENDOR", id: v.apple.id }, categoryCode: "1500", reason: "Capital equipment above threshold — fixed asset", flags: ["LARGE_UNUSUAL"], meta: { receipt: "required" } });
    const asset = addFixedAsset(ctx, "laptop", "MacBook Pro 16 (engineering laptop)", tx, LAPTOP_COST);
    const entryId = sid("je", `tx:${tx.id}`);
    ctx.schedule(date, (ledger) => ctx.link(tx, ledger.createEntry(entryForEquipmentPurchase(LAPTOP_COST, date, "1500", "2050", { id: entryId, post: true, source: "CARD_IMPORT", sourceIds: [tx.id, asset.id], description: "Laptop purchase capitalized — Apple Store" }), GENERATOR_ACTOR)));
    ctx.caseTx("equipment_purchase", tx);
    ctx.caseEntity("equipment_purchase", asset.id, entryId);
  }

  // --- Large unusual purchase: workstation by bank debit from a new vendor.
  {
    const m = cur(2);
    const date = nextBusinessDay(`${m}-22`);
    const tx = ctx.addTx({ key: `bank:${m}:dell-workstation`, source: "checking", date, amount: neg(WORKSTATION_COST), description: "DELL BUSINESS ONLINE 800-2890", merchant: v.dell.name, counterparty: { type: "VENDOR", id: v.dell.id }, categoryCode: "1500", categoryStatus: "SUGGESTED", confidence: 0.7, reason: "Large first-time purchase — capital equipment suggested; authorization to be confirmed", flags: ["LARGE_UNUSUAL", "NEW_MERCHANT", "REVIEW_REQUIRED"], meta: { receipt: "required" } });
    const asset = addFixedAsset(ctx, "workstation", "Dell Precision workstation (ML training)", tx, WORKSTATION_COST);
    const entryId = sid("je", `tx:${tx.id}`);
    ctx.schedule(date, (ledger) => ctx.link(tx, ledger.createEntry(entryForEquipmentPurchase(WORKSTATION_COST, date, "1500", "1000", { id: entryId, post: true, sourceIds: [tx.id, asset.id], description: "Workstation purchase capitalized — Dell Business" }), GENERATOR_ACTOR)));
    ctx.caseTx("large_unusual_purchase", tx);
    ctx.caseEntity("large_unusual_purchase", asset.id, entryId);
  }

  // --- Monthly depreciation for every full month once an asset is in service (dated month end).
  for (const m of ctx.fullMonths) {
    const entryId = sid("je", `depreciation:${m}`);
    ctx.schedule(monthEnd(`${m}-01`), (ledger) => {
      const input = buildDepreciationEntry(ledger, m, { id: entryId, post: true });
      if (input) {
        ledger.createEntry(input, GENERATOR_ACTOR);
        ctx.caseEntity("equipment_purchase", entryId);
      }
    });
  }

  // --- Annual software licence prepaid and amortized 99/month.
  {
    const m = cur(10);
    const date = `${m}-05`;
    const tx = ctx.addTx({ key: `card:${m}:jetbrains-annual`, source: "card", date, amount: neg(PREPAID_LICENCE_COST), description: "JETBRAINS ANNUAL ALL PRODUCTS", merchant: v.jetbrains.name, counterparty: { type: "VENDOR", id: v.jetbrains.id }, categoryCode: "1200", reason: "Annual licence — prepaid, amortized monthly to 7000", meta: { receipt: "required" } });
    const purchaseId = sid("je", `tx:${tx.id}`);
    ctx.schedule(date, (ledger) => ctx.link(tx, ledger.createEntry(simpleEntry(date, "JetBrains annual licence — prepaid", "CARD_IMPORT", "1200", "2050", PREPAID_LICENCE_COST, { id: purchaseId, post: true, sourceIds: [tx.id], tags: ["prepaid"] }), GENERATOR_ACTOR)));
    ctx.caseTx("annual_software_prepaid", tx);
    ctx.caseEntity("annual_software_prepaid", purchaseId);
    const startIdx = ctx.months.indexOf(m);
    for (let k = 0; k < 12; k++) {
      const am = ctx.months[startIdx + k];
      if (!am || !ctx.fullMonths.includes(am)) break;
      const amortId = sid("je", `prepaid-amortization:${am}`);
      const amortDate = monthEnd(`${am}-01`);
      ctx.schedule(amortDate, (ledger) => ledger.createEntry(entryForPrepaidAmortization(PREPAID_MONTHLY_AMORTIZATION, "7000", amortDate, { id: amortId, post: true, sourceIds: [tx.id], description: `JetBrains licence amortization ${k + 1}/12` }), GENERATOR_ACTOR));
      ctx.caseEntity("annual_software_prepaid", amortId);
    }
  }

  // --- Incorrect vendor category: Figma approved to Meals.
  {
    const m = cur(8);
    const tx = ctx.addTx({ key: `card:${m}:figma`, source: "card", date: `${m}-14`, amount: "-45", description: "FIGMA MONTHLY RENEWAL", merchant: v.figma.name, counterparty: { type: "VENDOR", id: v.figma.id }, categoryCode: "7300", approvedBy: OWNER_ACTOR.id, confidence: 0.55, reason: "Approved by user (incorrect — design software, not meals)" });
    ctx.postTx(tx, "7300");
    ctx.caseTx("incorrect_vendor_category", tx);
  }

  // --- Missing receipt, refund pair, owner distribution (all in the same month).
  {
    const m = cur(7);
    const amazon = ctx.addTx({ key: `card:${m}:amazon-no-receipt`, source: "card", date: `${m}-11`, amount: "-312", description: "AMAZON.COM*2K7QW44R3", merchant: v.amazon.name, counterparty: { type: "VENDOR", id: v.amazon.id }, categoryCode: "7400", categoryStatus: "SUGGESTED", confidence: 0.62, reason: "Vendor pattern suggests supplies; receipt required above threshold", flags: ["MISSING_RECEIPT"], meta: { receipt: "none" } });
    ctx.postTx(amazon, "7400");
    ctx.caseTx("missing_receipt", amazon);

    const charge = ctx.addTx({ key: `card:${m}:bh-photo`, source: "card", date: `${m}-03`, amount: "-199", description: "B&H PHOTO 800-606-6969", merchant: v.bhphoto.name, counterparty: { type: "VENDOR", id: v.bhphoto.id }, categoryCode: "7400", reason: "Webcam for client demos", meta: { receipt: "required" } });
    ctx.postTx(charge, "7400");
    const refund = ctx.addTx({ key: `card:${m}:bh-photo-refund`, source: "card", date: addDays(`${m}-03`, 9), amount: "199", description: "B&H PHOTO REFUND 800-606-6969", merchant: v.bhphoto.name, counterparty: { type: "VENDOR", id: v.bhphoto.id }, categoryCode: "7400", reason: "Refund of returned item — reverses original expense", flags: ["REFUND"], meta: { refundOf: charge.id } });
    charge.flags.push("REFUND");
    charge.meta = { ...(charge.meta ?? {}), refundedBy: refund.id };
    ctx.postTx(refund, "7400", { tags: ["refund"], description: "Refund: B&H Photo return" });
    ctx.caseTx("refunded_purchase", charge, refund);

    const distDate = nextBusinessDay(`${m}-20`);
    const dist = ctx.addTx({ key: `bank:${m}:owner-distribution`, source: "checking", date: distDate, amount: neg(OWNER_DISTRIBUTION), description: "TRANSFER TO OWNER - DISTRIBUTION", merchant: "Avery Lin (owner)", counterparty: { type: "OWNER", id: owner.id }, categoryCode: "3100", approvedBy: OWNER_ACTOR.id, reason: "Shareholder distribution approved by owner (restricted account)", flags: ["RELATED_PARTY", "REVIEW_REQUIRED"], meta: { approvalId: DISTRIBUTION_APPROVAL_ID } });
    const distEntryId = sid("je", `tx:${dist.id}`);
    ctx.ds.approvals.push(distributionApproval(ctx, dist));
    ctx.schedule(distDate, (ledger) => ctx.link(dist, ledger.createEntry(entryForDistribution(OWNER_DISTRIBUTION, distDate, "1000", { id: distEntryId, post: true, sourceIds: [dist.id], approvalId: DISTRIBUTION_APPROVAL_ID, description: "Shareholder distribution — Avery Lin" }), GENERATOR_ACTOR)));
    ctx.caseTx("owner_distribution", dist);
    ctx.caseEntity("owner_distribution", DISTRIBUTION_APPROVAL_ID, distEntryId);
  }

  // --- Prior-period miscode (found and corrected two months later).
  const correctionMonth = cur(4);
  {
    const m = cur(6);
    const tx = ctx.addTx({ key: `card:${m}:vercel-miscoded`, source: "card", date: `${m}-09`, amount: "-120", description: "VERCEL PRO TEAM", merchant: v.vercel.name, counterparty: { type: "VENDOR", id: v.vercel.id }, categoryCode: "7000", reason: "Corrected from 7400 Office Supplies via prior-period correcting entries", meta: { originalCategoryCode: "7400" } });
    const originalId = ctx.postTx(tx, "7400", { description: "Vercel Pro — posted to office supplies (miscoded)" });
    const fixDate = nextBusinessDay(`${correctionMonth}-15`);
    ctx.schedule(fixDate, (ledger) => {
      const original = ledger.requireEntry(originalId);
      applyCorrection(ledger, original, { date: fixDate, reason: "Vercel is a software subscription (7000), not office supplies (7400); original period soft-closed", lines: [{ accountCode: "7000", debit: "120", entityRef: tx.counterpartyRef }, { accountCode: "2050", credit: "120" }], idPrefix: sid("je", "prior-period-correction:vercel") }, GENERATOR_ACTOR);
    });
    ctx.caseTx("prior_period_correction", tx);
    ctx.caseEntity("prior_period_correction", originalId, `${sid("je", "prior-period-correction:vercel")}_rev`, `${sid("je", "prior-period-correction:vercel")}_new`);
  }

  // --- Duplicate subscription: Notion charged twice; a second Zoom plan from cur(4) onward.
  {
    const m = cur(5);
    const originalId = sid("tx", `card:${m}:notion`);
    const dup = cardCharge(ctx, m, { key: "notion-duplicate", day: 11, amount: "40", vendor: "notion", code: "7000", description: "NOTION LABS INC TEAM", flags: ["POSSIBLE_DUPLICATE", "REVIEW_REQUIRED"], meta: { possibleDuplicateOf: originalId } });
    const original = ctx.ds.transactions.find((t) => t.id === originalId);
    if (dup && original) {
      for (const flag of ["POSSIBLE_DUPLICATE", "REVIEW_REQUIRED"] as const) if (!original.flags.includes(flag)) original.flags.push(flag);
      ctx.caseTx("duplicate_subscription", original, dup);
    }
    for (let offset = 4; offset >= 0; offset--) {
      const zm = cur(offset);
      const second = cardCharge(ctx, zm, { key: "zoom-second-plan", day: 16, amount: "16", vendor: "zoom", code: "7000", description: "ZOOM.US PRO SEAT 2", flags: ["POSSIBLE_DUPLICATE", "REVIEW_REQUIRED"], meta: { possibleDuplicateOf: sid("tx", `card:${zm}:zoom`) } });
      if (second) ctx.caseTx("duplicate_subscription", second);
    }
  }

  // --- Franchise tax payment.
  {
    const m = cur(5);
    const date = nextBusinessDay(`${m}-15`);
    const tx = ctx.addTx({ key: `bank:${m}:franchise-tax`, source: "checking", date, amount: neg(FRANCHISE_TAX_PAYMENT), description: "FRANCHISE TAX BD PAYMENT", counterparty: { type: "TAX_AUTHORITY", id: "ca_ftb" }, categoryCode: "7900", reason: "California franchise tax — amount from bank record, not from a rule" });
    ctx.postTx(tx, "7900", { tags: ["tax-payment"] });
    ctx.caseTx("franchise_tax_payment", tx);
    ctx.mark("franchise-tax-tx", tx.id);
  }

  // --- Personal vs. business meals, prior-period correction date, partial invoice month.
  {
    const m = correctionMonth;
    const saturday = saturdayOnOrAfter(`${m}-14`);
    const personal = ctx.addTx({ key: `card:${m}:bistro-lune`, source: "card", date: saturday, amount: "-86.40", description: "BISTRO LUNE 21:42", merchant: v.bistrolune.name, counterparty: { type: "VENDOR", id: v.bistrolune.id }, categoryCode: "7300", categoryStatus: "SUGGESTED", confidence: 0.35, reason: "Restaurant on a Saturday evening; no attendees or business purpose recorded", flags: ["POSSIBLE_PERSONAL", "REVIEW_REQUIRED"], meta: { receipt: "none", dayOfWeek: "Saturday" } });
    ctx.postTx(personal, "7300");
    ctx.caseTx("personal_expense_on_company_card", personal);

    let weekday = addDays(saturday, 4);
    while (isWeekend(weekday)) weekday = addDays(weekday, 1);
    const business = ctx.addTx({ key: `card:${m}:salt-iron`, source: "card", date: weekday, amount: "-142.75", description: "SALT & IRON 12:38", merchant: v.saltiron.name, counterparty: { type: "VENDOR", id: v.saltiron.id }, categoryCode: "7300", reason: "Client lunch — receipt lists attendees and purpose", meta: { receipt: "required", attendees: ["Avery Lin", "Dana Whitfield (Harbor Analytics)"], businessPurpose: "Q3 roadmap review with Harbor Analytics" } });
    ctx.postTx(business, "7300");
    ctx.caseTx("legitimate_business_meal", business);
  }

  // --- Domestic contractor without a W-9.
  {
    const m = cur(3);
    const date = nextBusinessDay(`${m}-11`);
    const tx = ctx.addTx({ key: `bank:${m}:pixel-forge`, source: "checking", date, amount: "-1250", description: "PIXEL FORGE DESIGN ACH", merchant: v.pixelforge.name, counterparty: { type: "VENDOR", id: v.pixelforge.id }, categoryCode: "6050", categoryStatus: "SUGGESTED", confidence: 0.7, reason: "Design contractor — W-9 not on file", flags: ["NEW_MERCHANT", "REVIEW_REQUIRED"] });
    ctx.postTx(tx, "6050", { tags: ["contractor"] });
    ctx.caseTx("vendor_missing_w9", tx);
    ctx.caseEntity("vendor_missing_w9", v.pixelforge.id);
  }

  // --- Uncategorized Venmo payment (no journal entry) in the prior month.
  {
    const m = cur(1);
    const date = nextBusinessDay(`${m}-19`);
    const tx = ctx.addTx({ key: `bank:${m}:venmo`, source: "checking", date, amount: "-600", description: "VENMO PAYMENT 4821", merchant: v.venmo.name, counterparty: { type: "VENDOR", id: v.venmo.id }, categoryCode: null, categoryStatus: "UNCATEGORIZED", confidence: 0, reason: "Payee and purpose unknown — awaiting owner explanation", flags: ["UNCATEGORIZED", "REVIEW_REQUIRED"] });
    ctx.caseTx("uncategorized_transaction", tx);
  }

  // --- Unknown merchant posted to suspense in the current month.
  {
    const m = cur(0);
    const day = Math.min(4, Number(ctx.asOf.slice(8, 10)));
    const date = `${m}-${pad2(day)}`;
    const tx = ctx.addTx({ key: `card:${m}:suspense`, source: "card", date, amount: "-137.20", description: "SQ *UNKNOWN MERCHANT 4471", merchant: v.unknownsq.name, counterparty: { type: "VENDOR", id: v.unknownsq.id }, categoryCode: "9999", categoryStatus: "UNCATEGORIZED", confidence: 0.2, reason: "Merchant not recognized — parked in suspense pending identification", flags: ["UNCATEGORIZED", "REVIEW_REQUIRED", "NEW_MERCHANT"], meta: { receipt: "none" } });
    ctx.postTx(tx, "9999", { tags: ["suspense"] });
    ctx.caseTx("suspense_current_month", tx);
  }

  ctx.caseEntity("international_worker_ambiguity", ...ctx.refs.workers.cn.map((w) => w.id));
}

function distributionApproval(ctx: GenContext, tx: Transaction): ApprovalRequest {
  const owner = ctx.refs.workers.owner;
  const requestedAt = ts(addDays(tx.date, -2), 10);
  return {
    id: DISTRIBUTION_APPROVAL_ID,
    action: {
      id: sid("act", "owner-distribution"),
      kind: "PROPOSE_DISTRIBUTION",
      agent: "USER",
      description: `Shareholder distribution of ${OWNER_DISTRIBUTION} USD to ${owner.displayName}`,
      amount: { amount: money(OWNER_DISTRIBUTION), currency: "USD" },
      targetIds: [tx.id, owner.id],
      payload: { accountCode: "3100", transactionId: tx.id, isSynthetic: true },
      reason: "Owner requested a distribution; reasonable-compensation interplay flagged for CPA review",
      financialImpact: `Equity decreases by ${OWNER_DISTRIBUTION}; cash decreases by ${OWNER_DISTRIBUTION}`,
      sourceDocumentIds: [],
      confidence: 1,
      reversible: false,
      createdAt: requestedAt,
      context: { touchesEquity: true, movesMoney: true, involvesRelatedParty: true, touchesRestrictedAccount: true },
    },
    risk: { actionId: sid("act", "owner-distribution"), level: "RED", reasons: ["Restricted equity account 3100", "Related party", "Moves money"], requiredApproverRoles: ["OWNER"], materialityBreached: false, autoExecutable: false, policyRefs: ["restricted-accounts"], assessedAt: requestedAt },
    requestedApproverRoles: ["OWNER"],
    status: "APPROVED",
    requestedAt,
    decidedAt: ts(addDays(tx.date, -1), 9),
    decidedBy: OWNER_ACTOR.id,
    decidedByRole: "OWNER",
    decisionComment: "Approved (synthetic lab approval — simulation only; no money moves).",
    auditEventIds: [],
  };
}
