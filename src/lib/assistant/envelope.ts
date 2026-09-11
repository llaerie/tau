/** Structured answer envelope rendered by the client. Money values come from tools, never from the model. */
export type ComponentKind = "food_plan" | "money_summary" | "purchase_scenario" | "obligations" | "receipt_draft" | "plan_change" | "subscriptions" | "partner_summary" | "review_items" | "transactions" | "metric";

export interface ResultValue {
  id: string;
  label: string;
  value: string;
  status?: "known" | "estimate" | "unknown" | "attention";
  note?: string;
}

export interface ResultComponent {
  kind: ComponentKind;
  title: string;
  values: ResultValue[];
  rows?: { label: string; value: string; note?: string; status?: ResultValue["status"] }[];
  actionId?: string;
  scope?: string;
  asOf?: string;
  missing?: string[];
  assumptions?: string[];
  metricId?: string;
}

export interface NextAction {
  label: string;
  kind: "approve_action" | "open_route" | "set_food_target" | "connect_assistant";
  actionId?: string;
  href?: string;
}

export interface AssistantEnvelope {
  answerType: "answer" | "draft" | "refusal" | "error" | "preview";
  mode: "claude" | "preview";
  summary: string;
  text: string;
  scope: "me" | "company" | "household";
  asOf: string;
  components: ResultComponent[];
  missing: string[];
  nextAction: NextAction | null;
  evidence: { tool: string; input: Record<string, unknown>; error?: string }[];
  actionDrafts: { id: string; type: string; version: number }[];
}

export interface AssistantTurn {
  role: "user" | "assistant";
  text: string;
  envelope?: AssistantEnvelope;
  createdAt: string;
  scope?: "me" | "company" | "household";
}
