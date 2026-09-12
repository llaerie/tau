import { AssistantHome } from "@/components/assistant/AssistantHome";
import type { RailItem } from "@/components/assistant/ContextRail";
import { dateLabel } from "@/components/ui";
import { requireViewer } from "@/lib/actions/helpers";
import { loadHistory } from "@/lib/assistant/history";
import { getConfig } from "@/lib/config";
import { loadPreferences } from "@/lib/data/spaces";
import { formatAmount, isKnown } from "@/lib/finance/money";
import { buildBriefing } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const viewer = await requireViewer();
  const config = getConfig();
  const briefing = buildBriefing(viewer);
  const prefs = loadPreferences(viewer.user.id);
  const history = loadHistory(viewer.workspace.id, viewer.user.id, 40);

  const scopes = [
    ...(viewer.spaces.some((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id) ? (["me"] as const) : []),
    ...(viewer.spaces.some((sp) => sp.kind === "company") ? (["company"] as const) : []),
    ...(viewer.spaces.some((sp) => sp.kind === "household") ? (["household"] as const) : []),
  ];
  const partner = viewer.persons.find((p) => p.id !== viewer.person?.id) ?? null;

  // One money summary lives in the rail; the items beside it are upcoming payments
  // first, then anything still waiting for review. At most three, never repeated.
  const upcoming: RailItem[] = briefing.upcoming.slice(0, 3).map((o) => ({
    id: o.id,
    label: o.label,
    detail: `${dateLabel(o.dueDate)} · ${isKnown(o.amount) ? formatAmount(o.amount) : "amount unknown"}`,
    href: "/activity",
    tone: isKnown(o.amount) ? "neutral" : "unknown",
  }));
  const review: RailItem[] = briefing.attention.slice(0, 3 - upcoming.length).map((i) => ({
    id: i.key,
    label: i.label,
    detail: i.where,
    href: i.action?.kind === "set-food-target" ? "/money?space=me#food" : i.action?.kind === "confirm-withholding" ? "/settings#payroll" : "/settings",
    tone: "warn",
  }));

  return (
    <AssistantHome
      briefing={briefing}
      initialHistory={history}
      scopes={scopes.length ? [...scopes] : ["me"]}
      connected={!!config.anthropicApiKey}
      model={config.model}
      spokenReplies={prefs.spokenReplies}
      partnerName={partner?.name ?? null}
      railItems={[...upcoming, ...review]}
    />
  );
}
