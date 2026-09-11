import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, readJson } from "@/lib/ui/api";
import { addFinancialAccount, type AddFinancialAccountInput } from "@/lib/ui/manual-entry";
import { toPlain } from "@/lib/ui/serialize";

/** Register a bank account or card (last4 only) and confirm the matching finance-bible field. OWNER / FINANCE_OPERATOR. */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<Partial<AddFinancialAccountInput>>(req);
  const rt = await getRuntime();
  const result = await addFinancialAccount(rt, actor, {
    kind: body.kind as AddFinancialAccountInput["kind"],
    name: String(body.name ?? ""),
    institution: String(body.institution ?? ""),
    accountType: body.accountType,
    last4: String(body.last4 ?? ""),
    currency: typeof body.currency === "string" ? body.currency : undefined,
    glAccountId: typeof body.glAccountId === "string" ? body.glAccountId : undefined,
    openedDate: typeof body.openedDate === "string" ? body.openedDate : undefined,
    statementCloseDay: typeof body.statementCloseDay === "number" ? body.statementCloseDay : undefined,
    paymentDueDay: typeof body.paymentDueDay === "number" ? body.paymentDueDay : undefined,
  });
  return json({ account: toPlain(result.account), configField: toPlain(result.configField), message: `${body.kind === "CARD" ? "Card" : "Bank account"} ${result.account.name} ····${result.account.last4} registered; bible field ${result.configField.key} is now CONFIRMED.` }, { status: 201 });
}, "PROPOSE_ACTIONS");
