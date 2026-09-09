/**
 * Ground truth for the deliberately difficult cases embedded in the synthetic dataset.
 * Definitions (expected treatment) live here; the generator fills in the concrete ids.
 */
import type { ID, TransactionFlag } from "@/lib/core/types";
import type { GenContext } from "./context";

export interface GroundTruthCase {
  key: string;
  title: string;
  transactionIds: ID[];
  entityIds: ID[];
  expectedCategoryCode?: string;
  expectedFlags: TransactionFlag[];
  correctTreatment: string;
  explanation: string;
}

type Definition = Omit<GroundTruthCase, "transactionIds" | "entityIds">;

export const GROUND_TRUTH_DEFINITIONS: readonly Definition[] = [
  {
    key: "opening_balance",
    title: "Opening capital contribution",
    expectedCategoryCode: "3000",
    expectedFlags: ["RELATED_PARTY"],
    correctTreatment: "Dr 1000 Operating Checking / Cr 3000 Shareholder Capital as an OPENING_BALANCE entry; equity, not revenue.",
    explanation: "The owner's initial deposit funds the company. It is paid-in capital and must never appear on the income statement.",
  },
  {
    key: "duplicate_subscription",
    title: "Duplicate subscription charges (Notion charged twice; second Zoom plan)",
    expectedCategoryCode: "7000",
    expectedFlags: ["POSSIBLE_DUPLICATE", "REVIEW_REQUIRED"],
    correctTreatment: "Both charges really hit the card, so both post to 7000; flag the second Notion charge for a vendor dispute/refund and the redundant Zoom plan for cancellation.",
    explanation: "Same vendor, same amount, same month is a duplicate-billing signal; a redundant second plan is recurring waste. Neither is an import duplicate, so neither may be dropped from the ledger.",
  },
  {
    key: "missing_receipt",
    title: "Card purchase over the receipt threshold with no document",
    expectedCategoryCode: "7400",
    expectedFlags: ["MISSING_RECEIPT"],
    correctTreatment: "Post as office supplies (SUGGESTED, not approved) and request the receipt; the category cannot be approved until the document arrives.",
    explanation: "Substantiation policy requires a receipt above the threshold. The absence of a Document is the finding, not the amount.",
  },
  {
    key: "late_customer_payment",
    title: "Harbor Analytics pays 25 days after the due date",
    expectedCategoryCode: "1100",
    expectedFlags: ["RELATED_PARTY"],
    correctTreatment: "Apply the receipt against the open invoice (Dr 1000 / Cr 1100); the invoice was OVERDUE for 25 days and should have triggered a collection reminder; no revenue is recognized at payment.",
    explanation: "Revenue was recognized when invoiced under the accrual method; the late receipt only clears AR. The related-party flag is inherited from the customer.",
  },
  {
    key: "personal_expense_on_company_card",
    title: "Saturday-evening restaurant charge with no business purpose",
    expectedCategoryCode: "7990",
    expectedFlags: ["POSSIBLE_PERSONAL", "REVIEW_REQUIRED"],
    correctTreatment: "Reclassify from 7300 Meals to 7990 Non-Deductible / Personal (restricted) or to 1260 Due from Shareholder, and seek owner reimbursement.",
    explanation: "Weekend timing, no attendees, no business purpose and no receipt: this is a personal expense that must not be treated as deductible.",
  },
  {
    key: "legitimate_business_meal",
    title: "Weekday client meal with receipt, attendees and business purpose",
    expectedCategoryCode: "7300",
    expectedFlags: [],
    correctTreatment: "Post to 7300 Meals (Business) with the receipt linked; the 50% tax limitation is a tax-time item, not a bookkeeping reclass.",
    explanation: "Receipt lists attendees and purpose, weekday, reasonable amount — the contrast case to the personal charge.",
  },
  {
    key: "transfer_between_accounts",
    title: "Monthly checking → savings transfer",
    expectedCategoryCode: "1010",
    expectedFlags: ["TRANSFER"],
    correctTreatment: "One entry Dr 1010 / Cr 1000 covering both bank lines; never revenue or expense.",
    explanation: "Both sides of the transfer appear as bank transactions; they must be paired so cash is neither double counted nor recognized as income.",
  },
  {
    key: "card_payment_transfer",
    title: "Credit card autopay from checking",
    expectedCategoryCode: "2050",
    expectedFlags: ["TRANSFER"],
    correctTreatment: "Dr 2050 Business Credit Card / Cr 1000 Checking; the expenses were recognized when the charges posted.",
    explanation: "Paying the card settles a liability. Categorizing it as an expense would double count every card charge.",
  },
  {
    key: "payroll_net_pay",
    title: "Payroll net pay disbursements",
    expectedCategoryCode: "6000",
    expectedFlags: [],
    correctTreatment: "Each net-pay debit is one line of the compound payroll entry (gross wages Dr 6000/6010, employer taxes Dr 6100, withholdings Cr 2200/2210/2220/2230, net Cr 1000).",
    explanation: "Net pay is not the expense; gross wages plus employer taxes are. The bank line only settles the net amount.",
  },
  {
    key: "payroll_tax_liabilities",
    title: "Accrued payroll tax liabilities and their remittance",
    expectedCategoryCode: "2200",
    expectedFlags: [],
    correctTreatment: "Liabilities accrue on the pay date; remittances (IRS USATAXPYMT, EDD EFT PAYMENT) debit the liability accounts, never expense.",
    explanation: "Employer taxes were expensed in the payroll entry; paying them later reduces the payable. Due dates come from tax rules, which are not seeded here, so dueDate is null.",
  },
  {
    key: "payroll_tax_deposit",
    title: "A single federal payroll tax deposit",
    expectedCategoryCode: "2200",
    expectedFlags: [],
    correctTreatment: "Dr 2200 Federal Payroll Taxes Payable / Cr 1000; link to the payroll run's liability record.",
    explanation: "The deposit settles withholdings and FICA accrued at the prior month's payroll; it is not a tax expense of the company.",
  },
  {
    key: "equipment_purchase",
    title: "Laptop purchase capitalized as a fixed asset",
    expectedCategoryCode: "1500",
    expectedFlags: ["LARGE_UNUSUAL"],
    correctTreatment: "Capitalize to 1500 Computer Equipment, create a FixedAsset (36 months straight-line, salvage 0) and post monthly depreciation Dr 7700 / Cr 1590; tax treatment (Section 179 / bonus) is a CPA judgment.",
    explanation: "A multi-year asset above the capitalization threshold is not a period expense.",
  },
  {
    key: "annual_software_prepaid",
    title: "Annual software licence prepaid and amortized",
    expectedCategoryCode: "1200",
    expectedFlags: [],
    correctTreatment: "Dr 1200 Prepaid Expenses at purchase; amortize 99.00/month to 7000 Software over 12 months.",
    explanation: "An annual licence benefits twelve months; expensing it all in the purchase month misstates both months.",
  },
  {
    key: "incorrect_vendor_category",
    title: "Figma charge approved to Meals instead of Software",
    expectedCategoryCode: "7000",
    expectedFlags: [],
    correctTreatment: "Reclassify to 7000 Software Subscriptions; the APPROVED status was wrong and a correcting entry is required.",
    explanation: "Vendor identity determines the category; an approved status does not make a wrong category right.",
  },
  {
    key: "refunded_purchase",
    title: "Purchase refunded nine days later",
    expectedCategoryCode: "7400",
    expectedFlags: ["REFUND"],
    correctTreatment: "Post the charge Dr 7400 / Cr 2050 and the refund Dr 2050 / Cr 7400 so the net expense is zero; link the two transactions.",
    explanation: "A refund reverses the original expense; it is not income.",
  },
  {
    key: "partial_invoice_payment",
    title: "Project invoice paid in two instalments",
    expectedCategoryCode: "1100",
    expectedFlags: [],
    correctTreatment: "Apply 5,000 then 3,000 against the same invoice; status PARTIALLY_PAID in between; AR subledger must equal GL 1100 at every date.",
    explanation: "Payments are applied to invoices, not matched to revenue; the open balance is what the aging report must show.",
  },
  {
    key: "international_worker_ambiguity",
    title: "China-based workers paid via international platform",
    expectedCategoryCode: "6060",
    expectedFlags: ["INTERNATIONAL", "REVIEW_REQUIRED"],
    correctTreatment: "Record payments to 6060 International Worker Payments (Classification Pending) with SUGGESTED status; escalate classification, withholding and 1099/W-8 questions to counsel and the CPA; never assert employee or contractor status.",
    explanation: "All cross-border facts are unknown (null ConfigFields). The correct answer is an escalation, not a classification.",
  },
  {
    key: "owner_distribution",
    title: "Shareholder distribution to the owner",
    expectedCategoryCode: "3100",
    expectedFlags: ["RELATED_PARTY", "REVIEW_REQUIRED"],
    correctTreatment: "Dr 3100 Shareholder Distributions / Cr 1000 with an APPROVED approval; equity, not expense; S-corp reasonable-compensation interplay is a CPA judgment.",
    explanation: "Distributions to the sole shareholder reduce equity and require approval because 3100 is a restricted account.",
  },
  {
    key: "owner_wage",
    title: "Owner salary through payroll",
    expectedCategoryCode: "6010",
    expectedFlags: ["RELATED_PARTY"],
    correctTreatment: "Owner gross wages post to 6010 Officer Compensation (restricted), not 6000; the compensation amount is PROFESSIONAL_REVIEW_REQUIRED.",
    explanation: "Officer compensation is reported separately on the S-corp return and its reasonableness is a professional judgment.",
  },
  {
    key: "month_end_accrual",
    title: "Quarter-end CPA fee accrued then reversed",
    expectedCategoryCode: "7200",
    expectedFlags: [],
    correctTreatment: "Dr 7200 / Cr 2100 on the quarter-end date (ADJUSTING), auto-reverse on the first of the next month, then record the actual bill through AP.",
    explanation: "The accrual matches the expense to the period served; the reversal prevents double counting when the bill arrives.",
  },
  {
    key: "prior_period_correction",
    title: "March charge miscoded to 7400, corrected in May",
    expectedCategoryCode: "7000",
    expectedFlags: [],
    correctTreatment: "Post a CORRECTING reversal + re-entry pair dated in the open month (May) tagged prior-period-correction; do not edit the soft-closed March entry.",
    explanation: "Posted entries are immutable; a correction is a new pair of entries with a reason and a link to the original.",
  },
  {
    key: "bank_fee",
    title: "Monthly service and wire fees",
    expectedCategoryCode: "7500",
    expectedFlags: [],
    correctTreatment: "Dr 7500 Bank Fees / Cr 1000.",
    explanation: "Routine bank charges are operating expenses posted from the bank feed.",
  },
  {
    key: "franchise_tax_payment",
    title: "California franchise tax payment",
    expectedCategoryCode: "7900",
    expectedFlags: [],
    correctTreatment: "Dr 7900 State Franchise / Entity Taxes / Cr 1000; record a PAID TaxObligation whose amount comes from the bank record, not from a rule.",
    explanation: "The payment is a company-level tax expense; whether the amount was correct is a CPA question because no tax rule is seeded.",
  },
  {
    key: "large_unusual_purchase",
    title: "Large workstation purchase from a new vendor",
    expectedCategoryCode: "1500",
    expectedFlags: ["LARGE_UNUSUAL", "NEW_MERCHANT", "REVIEW_REQUIRED"],
    correctTreatment: "Flag for review, capitalize to 1500 with a FixedAsset record and depreciate; confirm the purchase was authorized.",
    explanation: "An amount far outside the vendor pattern from a first-time merchant is a control signal even when the accounting is straightforward.",
  },
  {
    key: "uncategorized_transaction",
    title: "Venmo payment with unknown payee",
    expectedFlags: ["UNCATEGORIZED", "REVIEW_REQUIRED"],
    correctTreatment: "Leave UNCATEGORIZED with no journal entry until the payee and purpose are known; ask the owner; never guess a category.",
    explanation: "Insufficient information: the correct output is a question, not a category.",
  },
  {
    key: "suspense_current_month",
    title: "Unknown merchant posted to suspense in the current month",
    expectedCategoryCode: "9999",
    expectedFlags: ["UNCATEGORIZED", "REVIEW_REQUIRED", "NEW_MERCHANT"],
    correctTreatment: "Posted to 9999 Suspense pending identification; must be cleared before the period can lock.",
    explanation: "Suspense is a temporary holding account; the lock control enforces a zero balance.",
  },
  {
    key: "vendor_missing_w9",
    title: "Domestic contractor paid without a W-9 on file",
    expectedCategoryCode: "6050",
    expectedFlags: ["NEW_MERCHANT", "REVIEW_REQUIRED"],
    correctTreatment: "Post to 6050 Contractor Payments (Domestic); request a W-9; the 1099 question is flagged for CPA review.",
    explanation: "Tax document status UNKNOWN blocks year-end information reporting; the bookkeeping is fine, the compliance item is open.",
  },
  {
    key: "duplicate_vendor_bill",
    title: "CPA bill received twice under different numbers",
    expectedFlags: [],
    correctTreatment: "Mark the second bill DUPLICATE with duplicateOfId; post and pay only the first.",
    explanation: "Different bill numbers for the same vendor, amount and period are a duplicate-invoice control finding.",
  },
  {
    key: "related_party_customer",
    title: "Recurring receipts from a related-party customer",
    expectedCategoryCode: "1100",
    expectedFlags: ["RELATED_PARTY"],
    correctTreatment: "Apply receipts to Harbor invoices normally but carry the related-party flag; the arrangement needs disclosure and pricing review.",
    explanation: "Harbor Analytics is associated with the CEO's father; concentration and related-party review are both required.",
  },
];

export function buildGroundTruth(ctx: GenContext): GroundTruthCase[] {
  return GROUND_TRUTH_DEFINITIONS.map((def) => {
    const ids = ctx.cases.get(def.key);
    if (!ids || (ids.transactionIds.length === 0 && ids.entityIds.length === 0)) {
      throw new Error(`Synthetic generator: ground-truth case ${def.key} was never populated`);
    }
    return { ...def, expectedFlags: [...def.expectedFlags], transactionIds: [...ids.transactionIds], entityIds: [...ids.entityIds] };
  });
}
