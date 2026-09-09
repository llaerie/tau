/**
 * Owner education snippets ("Why this matters"). Plain language, 2-5 sentences each.
 * These teach concepts; they never state tax rates, thresholds or legal conclusions.
 */

export type EducationConceptKey =
  | "cash_vs_profit"
  | "gross_vs_net"
  | "accrual_basis"
  | "owner_salary_vs_distribution"
  | "working_capital"
  | "cash_runway"
  | "npv"
  | "reasonable_compensation"
  | "related_party"
  | "prepaid_amortization"
  | "depreciation"
  | "payroll_liabilities"
  | "thirteen_week_cash"
  | "budget_variance"
  | "contribution_margin"
  | "break_even"
  | "ar_aging"
  | "period_lock"
  | "personal_business_separation"
  | "estimated_taxes";

export type EducationTopic = "accounting" | "cash" | "payroll" | "tax" | "planning" | "controls" | "finance";

export interface EducationSnippet {
  key: EducationConceptKey;
  title: string;
  topics: EducationTopic[];
  whyItMatters: string;
}

const S = (key: EducationConceptKey, title: string, topics: EducationTopic[], whyItMatters: string): EducationSnippet => ({ key, title, topics, whyItMatters });

export const EDUCATION_SNIPPETS: EducationSnippet[] = [
  S("cash_vs_profit", "Cash vs. profit", ["accounting", "cash"], "Profit is what the income statement says you earned; cash is what is actually in the bank. A profitable month can still drain cash when customers pay late or you prepay a year of software. Watching both keeps you from being surprised by a low balance right after a strong month."),
  S("gross_vs_net", "Gross vs. net", ["payroll", "accounting"], "Gross pay is what an employee earns before taxes and deductions; net pay is what lands in their account. The company also pays employer taxes on top of gross, so the true cost is higher than either number. When a figure like '$8,000 a month' is given without saying which basis it uses, every downstream calculation is unreliable until that is clarified."),
  S("accrual_basis", "Accrual basis", ["accounting"], "Under accrual accounting, revenue is recorded when it is earned and expenses when they are incurred, not when cash moves. It shows the true economics of a month even if the invoice is paid later. Cash-basis books are simpler but can hide obligations you already owe."),
  S("owner_salary_vs_distribution", "Owner salary vs. distribution", ["payroll", "tax"], "As an S corporation shareholder-employee, you can receive money as wages (through payroll, with payroll taxes) or as distributions (a return of profits). The mix matters for taxes and compliance, and the wage portion must be reasonable for the work performed. Deciding that mix is a professional judgment for your CPA, not something the system sets on its own."),
  S("working_capital", "Working capital", ["finance", "cash"], "Working capital is current assets minus current liabilities: roughly what you have to operate with after paying what is due soon. Low or negative working capital means a single slow customer payment can cause a cash squeeze. Managing receivables, payables and reserves is how you keep it healthy."),
  S("cash_runway", "Cash runway", ["cash", "planning"], "Runway is how many months you can keep operating at the current burn rate before cash runs out. It is computed from actual balances and recent net outflows, not from hopes about future revenue. Knowing the runway tells you how early you need to act on collections, costs or financing."),
  S("npv", "Net present value (NPV)", ["finance"], "NPV values a decision by discounting all future cash flows back to today at a required rate of return. A positive NPV means the investment is expected to create value after accounting for the time value of money. It turns 'should we buy this?' into a comparable number, as long as the assumptions behind the cash flows are explicit."),
  S("reasonable_compensation", "Reasonable compensation", ["tax", "payroll"], "S corporation owners who work in the business are expected to pay themselves a reasonable wage before taking distributions. What counts as reasonable depends on the role, hours, skills and comparable pay, and it is a professional judgment. The system can show you the facts and the tentative assumption, but the decision belongs with your CPA."),
  S("related_party", "Related-party transactions", ["controls", "tax"], "A related party is someone connected to the owner, such as a family member, a fiancée or a company they control. Transactions with related parties are legitimate but attract scrutiny, so they must be documented at clear terms and disclosed to your CPA. Flagging them is how the system makes sure nothing is hidden by accident."),
  S("prepaid_amortization", "Prepaid expenses and amortization", ["accounting"], "When you pay for a year of insurance or software up front, the cost belongs to each month you use it, not just the month you paid. Recording it as a prepaid asset and expensing a slice each month keeps monthly results comparable. Skipping this makes one month look terrible and the rest look better than they are."),
  S("depreciation", "Depreciation", ["accounting", "tax"], "Equipment that lasts years is expensed over its useful life rather than all at once, so each period carries a fair share of the cost. Your books use straight-line depreciation for clarity. Tax depreciation can follow different elections, which is a choice your CPA makes."),
  S("payroll_liabilities", "Payroll liabilities", ["payroll", "cash"], "Every payroll creates amounts you owe to tax agencies: taxes withheld from employees plus the employer's own taxes. That money sits in your bank account for a while but is not yours. Tracking it as a liability prevents spending it and missing a deposit."),
  S("thirteen_week_cash", "13-week cash forecast", ["cash", "planning"], "A 13-week cash forecast lays out expected inflows and outflows week by week for the next quarter. It is short enough to be accurate and long enough to see a shortfall coming. Reviewing it weekly turns cash management from reacting into planning."),
  S("budget_variance", "Budget variance", ["planning"], "Variance is the difference between what you planned and what happened, by line and by month. Large variances are not automatically bad, but each one deserves an explanation: timing, volume, price or a one-off. Explaining variances is how a budget becomes a management tool instead of a document."),
  S("contribution_margin", "Contribution margin", ["finance"], "Contribution margin is revenue minus the variable costs of delivering it, such as cloud compute and API usage. It shows how much each dollar of sales contributes toward fixed costs like salaries and rent. A thin contribution margin means growth will not fix profitability on its own."),
  S("break_even", "Break-even", ["finance", "planning"], "Break-even is the revenue level at which contribution margin exactly covers fixed costs. Below it you lose money; above it each extra dollar of margin is profit. Knowing your break-even tells you how much revenue cushion you really have."),
  S("ar_aging", "Accounts receivable aging", ["cash", "controls"], "AR aging groups unpaid invoices by how overdue they are. The older an invoice, the less likely it is to be collected in full, and the more it strains cash. Reviewing aging weekly catches slow payers before they become bad debts."),
  S("period_lock", "Period lock", ["controls", "accounting"], "Locking a month means its numbers are final: no entry can change them without an explicit, approved unlock. This protects reports you have already relied on and keeps the audit trail honest. Corrections are made as new dated entries, never by rewriting history."),
  S("personal_business_separation", "Personal / business separation", ["controls", "tax"], "Mixing personal and business money makes the books unreliable and can weaken the liability protection your LLC provides. Business accounts pay business expenses; the owner is paid through payroll or documented distributions. Anything that looks personal is flagged for your decision rather than quietly deducted."),
  S("estimated_taxes", "Estimated taxes", ["tax", "cash"], "Because an S corporation's profit flows through to the owner's personal return, tax on it is generally paid during the year through the owner's estimated payments, while the entity itself may owe state-level taxes. Missing estimates leads to penalties and a large bill later. Your personal estimates are outside this business system; the system only reminds you that they exist."),
];

const BY_KEY = new Map(EDUCATION_SNIPPETS.map((s) => [s.key, s]));

export function educationFor(conceptKey: string): EducationSnippet | undefined {
  return BY_KEY.get(conceptKey as EducationConceptKey);
}

export function conceptsForTopic(topic: EducationTopic | string): EducationSnippet[] {
  return EDUCATION_SNIPPETS.filter((s) => s.topics.includes(topic as EducationTopic));
}

export function educationKeys(): EducationConceptKey[] {
  return EDUCATION_SNIPPETS.map((s) => s.key);
}
