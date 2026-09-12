"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantPresence, type PresenceState } from "@/components/AssistantPresence";
import { Drawer } from "@/components/Drawer";
import type { Briefing } from "@/lib/views";
import { ActionCard } from "./ActionCard";
import { preferencesApi, streamAssistant, type ActionView, type AssistantTurn, type StreamEvent } from "./client";
import { ActionStarters, Composer, type Scope } from "./Composer";
import { ContextRail, type RailItem } from "./ContextRail";
import { ResultCard } from "./ResultCard";
import { useSpokenReplies } from "./useSpeech";

interface LiveTurn extends AssistantTurn {
  pending?: boolean;
  tools?: { name: string; status: "running" | "done" | "error" }[];
  error?: string;
}

const TOOL_LABEL: Record<string, string> = {
  get_briefing: "Reading your briefing",
  get_money_summary: "Summarising the money",
  get_personal_food_plan: "Checking the food plan",
  search_transactions: "Searching activity",
  get_upcoming_obligations: "Listing upcoming payments",
  get_subscription_plan: "Reading subscriptions",
  explain_metric: "Tracing the calculation",
  evaluate_purchase: "Evaluating the purchase",
  get_review_items: "Checking what is unknown",
  get_partner_summary: "Reading the shared summary",
  draft_budget_change: "Drafting the plan change",
  draft_expense: "Drafting the record",
  draft_purchase_plan: "Drafting the purchase plan",
  draft_subscription_change: "Drafting the subscription change",
};

const STARTERS: Record<Scope, { label: string; hint: string; message: string }[]> = {
  me: [
    { label: "What can I spend?", hint: "Take-home, food and what is left", message: "How much can I spend on food?" },
    { label: "Record a receipt", hint: "Log a purchase, split it if shared", message: "Record a receipt" },
    { label: "Plan a purchase", hint: "Check timing before you buy", message: "Plan a purchase" },
  ],
  company: [
    { label: "What is committed?", hint: "Receipts, payroll and known costs", message: "What is the company committed to this month?" },
    { label: "AI tools cost", hint: "Subscriptions and metered usage", message: "What are all our AI tools costing?" },
    { label: "Plan a purchase", hint: "Check it against recorded cash", message: "Plan a purchase" },
  ],
  household: [
    { label: "What is due?", hint: "The next two weeks", message: "What is due in the next 30 days?" },
    { label: "Company-paid bills", hint: "What the company covers", message: "What does the company pay for the household?" },
    { label: "Record a receipt", hint: "Groceries and shared costs", message: "Record a receipt" },
  ],
};

export function AssistantHome({
  briefing,
  initialHistory,
  scopes,
  connected,
  model,
  spokenReplies: spokenInitial,
  partnerName,
  railItems,
}: {
  briefing: Briefing;
  initialHistory: AssistantTurn[];
  scopes: Scope[];
  connected: boolean;
  model: string;
  spokenReplies: boolean;
  partnerName: string | null;
  railItems: RailItem[];
}) {
  const [turns, setTurns] = useState<LiveTurn[]>(initialHistory);
  const [scope, setScope] = useState<Scope>(scopes.includes("me") ? "me" : scopes[0]);
  const [busy, setBusy] = useState(false);
  const [spoken, setSpoken] = useState(spokenInitial);
  const [connectOpen, setConnectOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const speech = useSpokenReplies(spoken);

  const active = turns.length > 0;
  const presence: PresenceState = busy ? "working" : connected ? "idle" : "offline";

  // Publish the docked composer's real height so anything scrolling itself into
  // view can clear it. A fixed guess is wrong: the dock is much taller on a phone.
  useEffect(() => {
    const el = dockRef.current;
    const root = document.documentElement;
    if (!el || !active) {
      root.style.setProperty("--fd-dock-space", "24px");
      return;
    }
    const write = () => root.style.setProperty("--fd-dock-space", `${Math.round(el.getBoundingClientRect().height) + 52}px`);
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  // Keep the end of the conversation clear of the docked composer, so an
  // action card's approve row is never hidden behind it.
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }), 60);
    return () => window.clearTimeout(id);
  }, [turns.length, busy, active]);

  const send = useCallback(
    async (text: string) => {
      if (busy) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      const userTurn: LiveTurn = { role: "user", text, createdAt: new Date().toISOString(), scope };
      const draft: LiveTurn = { role: "assistant", text: "", createdAt: new Date().toISOString(), scope, pending: true, tools: [] };
      setTurns((t) => [...t, userTurn, draft]);
      const patch = (fn: (t: LiveTurn) => LiveTurn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
      try {
        const envelope = await streamAssistant(
          text,
          scope,
          (e: StreamEvent) => {
            if (e.type === "text") patch((t) => ({ ...t, text: t.text + e.delta }));
            if (e.type === "tool") patch((t) => ({ ...t, tools: [...(t.tools ?? []).filter((x) => x.name !== e.name), { name: e.name, status: e.status }] }));
          },
          controller.signal,
        );
        patch((t) => ({ ...t, text: envelope.text, envelope, pending: false, tools: [] }));
        speech.speak(envelope.summary || envelope.text);
      } catch (err) {
        const aborted = controller.signal.aborted;
        patch((t) => ({ ...t, pending: false, tools: [], error: aborted ? "Stopped. Nothing was saved." : err instanceof Error ? err.message : "The assistant failed. Nothing was saved." }));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, scope, speech],
  );

  const toggleSpoken = async () => {
    const next = !spoken;
    setSpoken(next);
    if (!next) speech.mute();
    try {
      await preferencesApi.update({ spokenReplies: next });
    } catch {
      setSpoken(!next);
    }
  };

  const onActionChange = (turnIndex: number, a: ActionView) => {
    setTurns((all) => all.map((t, i) => (i === turnIndex && t.envelope ? { ...t, envelope: { ...t.envelope, actionDrafts: t.envelope.actionDrafts.map((d) => (d.id === a.id ? { ...d, version: a.version } : d)) } } : t)));
  };

  const rail = useMemo(() => <ContextRail briefing={briefing} items={railItems} testId="context-rail" />, [briefing, railItems]);

  return (
    <div className="mx-auto w-full max-w-[760px] min-[1180px]:grid min-[1180px]:max-w-[1140px] min-[1180px]:grid-cols-[minmax(0,1fr)_var(--fd-context-rail)] min-[1180px]:items-start min-[1180px]:gap-7">
      <div className={`flex min-w-0 flex-col gap-4 sm:gap-5 ${active ? "min-h-[calc(100dvh-13rem)] lg:min-h-[calc(100dvh-9rem)]" : ""}`}>
        {active ? (
          <CompactHeader briefing={briefing} presence={presence} onClear={() => setTurns([])} />
        ) : (
          <IdleHeader briefing={briefing} presence={presence} connected={connected} />
        )}

        {!active && <ActionStarters starters={STARTERS[scope]} onPick={send} busy={busy} />}

        {active && (
          <div className="flex-1 space-y-6 pb-2" data-testid="conversation">
            {turns.map((t, i) => (
              <Turn key={`${t.createdAt}-${i}`} turn={t} index={i} onActionChange={onActionChange} />
            ))}
          </div>
        )}
        <div ref={endRef} className="h-px" style={{ scrollMarginBottom: "var(--fd-dock-space, 15rem)" }} />

        <div ref={dockRef} className={active ? "sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 mt-auto bg-bg pb-1 pt-2 lg:bottom-3" : ""}>
          <Composer scopes={scopes} scope={scope} onScope={setScope} onSend={send} busy={busy} onStop={() => abortRef.current?.abort()} docked={active} />
          <StatusLine
            connected={connected}
            model={model}
            spoken={spoken}
            speaking={speech.speaking}
            voiceSupported={speech.supported}
            onToggleSpoken={toggleSpoken}
            onMute={speech.mute}
            onConnect={() => setConnectOpen(true)}
          />
        </div>

        {!active && (
          <div className="min-[1180px]:hidden">
            <ContextRail briefing={briefing} items={railItems.slice(0, 3)} testId="context-inline" />
          </div>
        )}
      </div>

      <aside className="hidden min-[1180px]:block min-[1180px]:sticky min-[1180px]:top-[92px]" aria-label="Context">
        {rail}
      </aside>

      <Drawer open={connectOpen} onClose={() => setConnectOpen(false)} title="Connect the assistant" eyebrow="Setup">
        <p className="text-[14px] text-ink-2">
          Previews use the same server-side tools the model would use, with fixed wording. To get conversational answers, set an Anthropic API key where the server runs and restart it. The key never reaches the browser.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-[var(--fd-radius-field)] bg-surface-2 p-3 text-[13px]">{`ANTHROPIC_API_KEY=sk-ant-...\nFINANCE_DESK_MODEL=claude-opus-5   # optional`}</pre>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">
          <li>Answers stream and can be stopped. Failed calls retry twice.</li>
          <li>Money figures always come from the finance engine, never from the model.</li>
          <li>{partnerName ? `${partnerName}'s` : "Your partner's"} private rows never enter your model context.</li>
        </ul>
      </Drawer>
    </div>
  );
}

function IdleHeader({ briefing, presence, connected }: { briefing: Briefing; presence: PresenceState; connected: boolean }) {
  const next = briefing.nextStep;
  const setup = briefing.incomplete || !!next;
  return (
    <header data-testid="briefing">
      <div className="flex items-start gap-4">
        <AssistantPresence state={presence} size={56} />
        <div className="min-w-0 flex-1 pt-1">
          <h1 className="text-[28px] font-semibold leading-[1.12] tracking-tight sm:text-[34px] lg:text-[38px]">
            {setup ? "Let’s finish your money plan." : briefing.greeting}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
            {setup ? `${briefing.greeting} ${briefing.summary[0] ?? ""}` : briefing.summary[0] ?? "Ask me anything about your money."}
          </p>
        </div>
      </div>

      {next && (
        <div className="card mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 sm:py-4" data-testid="next-step">
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold">{next.label}</span>
            <span className="block text-[13px] leading-snug text-ink-2">{next.blocks}</span>
          </span>
          <Link href={hrefForItem(next.action?.kind)} className="btn btn-primary btn-sm shrink-0">
            {next.action?.kind === "set-food-target" ? "Set it now" : "Fix this"}
          </Link>
        </div>
      )}

      {!connected && (
        <p className="mt-3 hidden text-[13px] text-ink-3 sm:block">
          This briefing is computed from your own records, not written by a model.
        </p>
      )}
    </header>
  );
}

function CompactHeader({ briefing, presence, onClear }: { briefing: Briefing; presence: PresenceState; onClear: () => void }) {
  return (
    <header className="flex items-center justify-between gap-3" data-testid="briefing">
      <div className="flex min-w-0 items-center gap-3">
        <AssistantPresence state={presence} size={38} />
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-semibold">{briefing.personName}’s assistant</span>
          <span className="block truncate text-[12.5px] text-ink-3">As of {briefing.asOf}</span>
        </span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClear} data-testid="clear-conversation">
        New conversation
      </button>
    </header>
  );
}

function StatusLine({
  connected,
  model,
  spoken,
  speaking,
  voiceSupported,
  onToggleSpoken,
  onMute,
  onConnect,
}: {
  connected: boolean;
  model: string;
  spoken: boolean;
  speaking: boolean;
  voiceSupported: boolean;
  onToggleSpoken: () => void;
  onMute: () => void;
  onConnect: () => void;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-1 text-[12.5px] text-ink-3">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5" data-testid="assistant-status">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-good" : "bg-warn"}`} />
          {connected ? `Claude connected · ${model}` : "Preview mode · computed figures, fixed wording"}
        </span>
        {!connected && (
          <button type="button" className="link text-[12.5px]" onClick={onConnect} data-testid="connect-assistant">
            Connect assistant
          </button>
        )}
      </span>
      <span className="flex items-center gap-2">
        {voiceSupported && (
          <button type="button" className={`text-[12.5px] ${spoken ? "text-accent" : "text-ink-3"} hover:text-ink`} onClick={onToggleSpoken} aria-pressed={spoken} data-testid="spoken-replies">
            Spoken replies {spoken ? "on" : "off"}
          </button>
        )}
        {speaking && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onMute} data-testid="mute">
            Mute
          </button>
        )}
      </span>
    </div>
  );
}

function hrefForItem(kind?: string): string {
  switch (kind) {
    case "set-food-target":
      return "/money?space=me#food";
    case "confirm-withholding":
      return "/settings#payroll";
    case "open-subscriptions":
      return "/money?space=company#subscriptions";
    case "open-plans":
      return "/money?space=company#plans";
    default:
      return "/settings";
  }
}

function Turn({ turn, index, onActionChange }: { turn: LiveTurn; index: number; onActionChange: (i: number, a: ActionView) => void }) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end" data-testid="turn-user">
        <p className="max-w-[85%] rounded-[var(--fd-radius-feature)] rounded-br-[8px] px-4 py-2.5 text-[15px] text-on-accent" style={{ background: "var(--fd-action-gradient)" }}>
          {turn.text}
        </p>
      </div>
    );
  }
  const env = turn.envelope;
  const actionIds = new Set<string>();
  return (
    <div className="space-y-3.5" data-testid="turn-assistant">
      {turn.tools && turn.tools.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-[12.5px] text-ink-3" aria-live="polite">
          {turn.tools.map((t) => (
            <li key={t.name} className="inline-flex items-center gap-1.5 rounded-[var(--fd-radius-pill)] bg-surface-2 px-3 py-1">
              {t.status === "running" && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />}
              {TOOL_LABEL[t.name] ?? t.name}
              {t.status === "error" && <span className="text-bad">failed</span>}
            </li>
          ))}
        </ul>
      )}
      {(turn.text || turn.pending) && (
        <div className="whitespace-pre-wrap text-[15.5px] leading-[1.6]" data-testid="assistant-text" aria-live="polite">
          {turn.text}
          {turn.pending && !turn.text && (
            <span className="inline-flex items-center gap-2 text-ink-3">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
              Working…
            </span>
          )}
        </div>
      )}
      {turn.error && <p className="rounded-[var(--fd-radius-card)] bg-bad-soft px-4 py-3 text-[13.5px] text-bad">{turn.error}</p>}
      {env?.mode === "preview" && !turn.pending && <p className="text-[12.5px] text-ink-3">Preview answer. Figures are computed; the wording is fixed, not generated.</p>}
      {env?.components.map((c, i) => {
        if (c.actionId) actionIds.add(c.actionId);
        return c.actionId ? <ActionCard key={c.actionId} actionId={c.actionId} onChange={(a) => onActionChange(index, a)} /> : <ResultCard key={`${c.kind}-${i}`} component={c} />;
      })}
      {env?.actionDrafts.filter((d) => !actionIds.has(d.id)).map((d) => <ActionCard key={d.id} actionId={d.id} onChange={(a) => onActionChange(index, a)} />)}
      {env?.nextAction && !turn.pending && (env.nextAction.kind === "open_route" || env.nextAction.kind === "set_food_target") && (
        <Link href={env.nextAction.kind === "set_food_target" ? "/money?space=me#food" : env.nextAction.href ?? "/"} className="btn btn-secondary btn-sm" data-testid="next-action">
          {env.nextAction.label}
        </Link>
      )}
    </div>
  );
}
