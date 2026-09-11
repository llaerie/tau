"use client";

import { useActionState, useState, useTransition } from "react";
import { register, signInDemo, signInWithPassword } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/helpers";

export function DemoPersonaButtons() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (persona: string) =>
    start(async () => {
      const r = await signInDemo(persona);
      if (r && !r.ok) setError(r.error);
    });
  return (
    <div className="mt-4 grid gap-2">
      <button type="button" className="btn btn-primary justify-between" disabled={pending} onClick={() => go("will")} data-testid="persona-will">
        <span>Will</span>
        <span className="text-xs font-normal opacity-80">CEO · company owner · his personal space</span>
      </button>
      <button type="button" className="btn btn-secondary justify-between" disabled={pending} onClick={() => go("arielle")} data-testid="persona-arielle">
        <span>Arielle</span>
        <span className="text-xs font-normal text-ink-3">Creative Director · her personal space</span>
      </button>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

export function LiveAuthForms({ inviteCode }: { inviteCode: string }) {
  const [mode, setMode] = useState<"signin" | "register">(inviteCode ? "register" : "signin");
  const [signInState, signInAction, signInPending] = useActionState<ActionResult | undefined, FormData>(signInWithPassword, undefined);
  const [regState, regAction, regPending] = useActionState<ActionResult | undefined, FormData>(register, undefined);
  return (
    <div className="card p-5">
      <div className="mb-4 flex gap-1 rounded-lg bg-surface-3 p-1 text-sm">
        <button type="button" className={`flex-1 rounded-md py-1.5 ${mode === "signin" ? "bg-surface font-medium shadow-card" : "text-ink-2"}`} onClick={() => setMode("signin")}>Sign in</button>
        <button type="button" className={`flex-1 rounded-md py-1.5 ${mode === "register" ? "bg-surface font-medium shadow-card" : "text-ink-2"}`} onClick={() => setMode("register")}>Create account</button>
      </div>
      {mode === "signin" ? (
        <form action={signInAction} className="space-y-3">
          <label className="block text-sm"><span className="label">Email</span><input name="email" type="email" autoComplete="email" required className="input mt-1" /></label>
          <label className="block text-sm"><span className="label">Password</span><input name="password" type="password" autoComplete="current-password" required className="input mt-1" /></label>
          {signInState && !signInState.ok && <p className="text-sm text-bad">{signInState.error}</p>}
          <button className="btn btn-primary w-full" disabled={signInPending}>{signInPending ? "Signing in…" : "Sign in"}</button>
        </form>
      ) : (
        <form action={regAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm"><span className="label">Your first name</span><input name="name" required className="input mt-1" placeholder="Will" /></label>
            <label className="block text-sm"><span className="label">Your role</span><input name="title" className="input mt-1" placeholder="CEO" /></label>
          </div>
          <label className="block text-sm"><span className="label">Email</span><input name="email" type="email" autoComplete="email" required className="input mt-1" /></label>
          <label className="block text-sm"><span className="label">Password (10+ characters)</span><input name="password" type="password" autoComplete="new-password" minLength={10} required className="input mt-1" /></label>
          <label className="block text-sm"><span className="label">Invite code (if you were invited)</span><input name="inviteCode" defaultValue={inviteCode} className="input mt-1" /></label>
          {!inviteCode && (
            <>
              <label className="block text-sm"><span className="label">Company name</span><input name="workspaceName" className="input mt-1" placeholder="Your company" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm"><span className="label">Partner&apos;s first name</span><input name="partnerName" className="input mt-1" placeholder="Arielle" /></label>
                <label className="block text-sm"><span className="label">Partner&apos;s role</span><input name="partnerTitle" className="input mt-1" placeholder="Creative Director" /></label>
              </div>
              <p className="text-xs text-ink-3">Your partner gets a private personal space you cannot see. Invite them from Settings afterwards. Using the names Will and Arielle pre-fills the plan you described (travel goal, spending plan, household bills).</p>
            </>
          )}
          {regState && !regState.ok && <p className="text-sm text-bad">{regState.error}</p>}
          <button className="btn btn-primary w-full" disabled={regPending}>{regPending ? "Creating…" : inviteCode ? "Join workspace" : "Create workspace"}</button>
          <p className="text-xs text-ink-3">Data stays in this server&apos;s private database. No invitations are sent by Finance Desk; owners share invite links themselves.</p>
        </form>
      )}
    </div>
  );
}
