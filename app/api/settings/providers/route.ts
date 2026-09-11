import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { PROVIDER_OPTIONS, PROVIDER_CONFIG_KEYS } from "@/lib/integrations/providers";
import { answerConfig } from "@/lib/ui/config";
import { toPlain } from "@/lib/ui/serialize";

const SECTION_FOR: Record<string, string> = { ACCOUNTING: "Accounting system", PAYROLL: "Payroll provider", BANK_DATA: "Bank accounts", DOCUMENT: "Document retention", INTERNATIONAL_WORKFORCE: "International workforce" };
const KEY_FOR: Record<string, string> = { ACCOUNTING: PROVIDER_CONFIG_KEYS.ACCOUNTING, PAYROLL: PROVIDER_CONFIG_KEYS.PAYROLL, BANK_DATA: PROVIDER_CONFIG_KEYS.BANK_DATA, DOCUMENT: PROVIDER_CONFIG_KEYS.DOCUMENT, INTERNATIONAL_WORKFORCE: PROVIDER_CONFIG_KEYS.INTERNATIONAL };

/** Record a provider *choice* as an UNCONFIRMED config field. No account or connection is ever created. */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<{ kind?: string; providerKey?: string }>(req);
  const kind = String(body.kind ?? "");
  const opt = PROVIDER_OPTIONS.find((o) => o.key === body.providerKey && o.kind === kind);
  if (!KEY_FOR[kind]) return apiError(`kind must be one of ${Object.keys(KEY_FOR).join(", ")}`);
  if (!opt) return apiError("providerKey is not an offered option for this kind");
  const rt = await getRuntime();
  const current = await answerConfig(rt, actor, { key: KEY_FOR[kind], value: opt.key, status: "UNCONFIRMED", section: SECTION_FOR[kind], label: `${kind} provider choice`, note: `PROPOSED: ${opt.vendor} selected in the setup wizard. No live account was created or connected (Phase One).`, eventType: "PROVIDER_CHOICE_RECORDED" });
  return json({ current: toPlain(current), message: `${opt.vendor} recorded as an UNCONFIRMED choice — no live account created.` });
}, "EDIT_CONFIG");
