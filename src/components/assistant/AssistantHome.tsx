"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/Drawer";
import type { Briefing } from "@/lib/views";
import { ActionCard } from "./ActionCard";
import { preferencesApi, streamAssistant, type ActionView, type AssistantTurn, type StreamEvent } from "./client";
import { Composer, type Scope } from "./Composer";
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

export function AssistantHome({ briefing, initialHistory, scopes, connected, model, spokenReplies: spokenInitial, partnerName }: { briefing: Briefing; initialHistory: AssistantTurn[]; scopes: Scope[]; connected: boolean; model: string; spokenReplies: boolean; partnerName: string | null }) {
  const [turns, setTurns] = useState<LiveTurn[]>(initialHistory);
  const [scope, setScope] = useState<Scope>(scopes.includes("me") ? "me" : scopes[0]);
  const [busy, setBusy] = useState(false);
  const [spoken, setSpoken] = useState(spokenInitial);
  const [connectOpen, setConnectOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const speech = useSpokenReplies(spoken);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, busy]);

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

  const stop = () => abortRef.current?.abort();

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

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-3xl flex-col">
      <div className="flex-1">
        <BriefingBlock briefing={briefing} partnerName={partnerName} />
        <div className="mt-6 space-y-5" data-testid="conversation">
          {turns.map((t, i) => (
            <Turn key={`${t.createdAt}-${i}`} turn={t} index={i} onActionChange={onActionChange} />
          ))}
          <div ref={endRef} style={{ scrollMarginBottom: "16rem" }} />
        </div>
      </div>
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-10 mt-6 bg-bg pb-2 pt-3 lg:bottom-0 lg:pb-4">
        <Composer scopes={scopes} scope={scope} onScope={setScope} onSend={send} busy={busy} onStop={stop} showStarters={turns.length === 0 || !busy} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[12px] text-ink-3">
          <div className="flex flex-wrap items-center gap-2">
            {connected ? (
              <span className="inline-flex items-center gap-1.5" data-testid="assistant-status">
                <span className="h-1.5 w-1.5 rounded-full bg-good" /> Claude connected · {model}
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5" data-testid="assistant-status">
                  <span className="h-1.5 w-1.5 rounded-full bg-warn" /> Preview mode: fixed wording, real figures
                </span>
                <button type="button" className="link text-[12px]" onClick={() => setConnectOpen(true)} data-testid="connect-assistant">
                  Connect assistant
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {speech.supported && (
              <button type="button" className={`text-[12px] ${spoken ? "text-accent" : "text-ink-3"} hover:text-ink`} onClick={toggleSpoken} aria-pressed={spoken} data-testid="spoken-replies">
                Spoken replies {spoken ? "on" : "off"}
              </button>
            )}
            {speech.speaking && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={speech.mute} data-testid="mute">
                Mute
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 px-1 text-[11.5px] text-ink-3">The assistant reads and drafts; it never pays, moves money or changes payroll. Voice uses your browser&apos;s speech services when you press the microphone.</p>
      </div>
      <Drawer open={connectOpen} onClose={() => setConnectOpen(false)} title="Connect the assistant" eyebrow="Setup">
        <p className="text-[13.5px] text-ink-2">Previews use the same server-side tools as the model, with fixed wording. To get conversational answers, set an Anthropic API key where the server runs and restart it. The key never reaches the browser.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-3 p-3 text-[12.5px]">{`ANTHROPIC_API_KEY=sk-ant-...\nFINANCE_DESK_MODEL=claude-opus-5   # optional`}</pre>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
          <li>Answers stream and can be stopped; failed calls retry twice.</li>
          <li>Money figures always come from the finance engine, never from the model.</li>
          <li>Your partner&apos;s private rows never enter your model context.</li>
        </ul>
      </Drawer>
    </div>
  );
}

function BriefingBlock({ briefing, partnerName }: { briefing: Briefing; partnerName: string | null }) {
  return (
    <header data-testid="briefing">
      <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">{briefing.greeting}</h1>
      <div className="mt-2 space-y-1 text-[14px] text-ink-2">
        {briefing.summary.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
        {briefing.moneyLine && (
          <p>
            {briefing.moneyLine.label}: <span className="num font-medium text-ink">{briefing.moneyLine.value}</span>
            {briefing.moneyLine.caveat && <span className="text-ink-3"> · {briefing.moneyLine.caveat}</span>}
          </p>
        )}
      </div>
      {briefing.attention.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="attention">
          {briefing.attention.map((item) => (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">{item.label}</span>
                <span className="block text-[12.5px] text-ink-3">{item.blocks}</span>
              </span>
              <Link href={hrefForItem(item.action?.kind)} className="btn btn-secondary btn-sm">
                {item.where}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {briefing.upcoming.length > 0 && (
        <p className="mt-3 text-[12.5px] text-ink-3">
          Next 14 days: {briefing.upcoming.map((o) => `${o.label} ${o.dueDate.slice(5)}${o.amount.kind === "known" ? "" : " (amount unknown)"}`).join(" · ")}
          {partnerName ? ` · ${partnerName}'s private space is not included.` : ""}
        </p>
      )}
    </header>
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
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[14px] text-ink">{turn.text}</p>
      </div>
    );
  }
  const env = turn.envelope;
  const actionIds = new Set<string>();
  return (
    <div className="space-y-3" data-testid="turn-assistant">
      {turn.tools && turn.tools.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-[12px] text-ink-3" aria-live="polite">
          {turn.tools.map((t) => (
            <li key={t.name} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5">
              {t.status === "running" && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />}
              {TOOL_LABEL[t.name] ?? t.name}
              {t.status === "error" && <span className="text-bad">failed</span>}
            </li>
          ))}
        </ul>
      )}
      {(turn.text || turn.pending) && (
        <div className="max-w-none whitespace-pre-wrap text-[14.5px] leading-6" data-testid="assistant-text">
          {turn.text}
          {turn.pending && !turn.text && (
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ink-3" />
              Working…
            </span>
          )}
        </div>
      )}
      {turn.error && <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">{turn.error}</p>}
      {env?.mode === "preview" && !turn.pending && <p className="text-[11.5px] text-ink-3">Preview answer (no model connected). Figures are computed; wording is fixed.</p>}
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
