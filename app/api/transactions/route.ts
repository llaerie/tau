import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, readJson } from "@/lib/ui/api";
import { addManualTransaction } from "@/lib/ui/manual-entry";
import { toPlain } from "@/lib/ui/serialize";

interface Body {
  sourceAccountId?: string;
  date?: string;
  postedDate?: string;
  amount?: string | number;
  description?: string;
}

/** Enter a bank/card transaction by hand (OWNER / FINANCE_OPERATOR). Lands UNCATEGORIZED with an audit event. */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<Body>(req);
  const rt = await getRuntime();
  const tx = await addManualTransaction(rt, actor, { sourceAccountId: String(body.sourceAccountId ?? ""), date: String(body.date ?? ""), postedDate: typeof body.postedDate === "string" && body.postedDate ? body.postedDate : undefined, amount: body.amount ?? "", description: String(body.description ?? "") });
  return json({ transaction: toPlain(tx), message: `Transaction ${tx.id} entered (${tx.amount} ${tx.currency} on ${tx.date}); it is UNCATEGORIZED until reviewed.` }, { status: 201 });
}, "PROPOSE_ACTIONS");
