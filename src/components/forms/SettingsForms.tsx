"use client";

import { useActionState, useState, useTransition } from "react";
import { signOut } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/helpers";
import { createInvite, resetDemoData, revokeInvite, setSpaceRole } from "@/lib/actions/settings";

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button className="btn btn-secondary">Sign out</button>
    </form>
  );
}

export function ResetDemoButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn btn-secondary btn-sm" disabled={pending} data-testid="reset-demo" onClick={() => confirm("Reset all demo data to the original synthetic set?") && start(async () => { const r = await resetDemoData(); setMsg(r.ok ? "Demo data reset." : r.error); })}>
        {pending ? "Resetting…" : "Reset demo data"}
      </button>
      {msg && <span className="text-xs text-ink-2">{msg}</span>}
    </span>
  );
}

export function RoleSelect({ userId, spaceId, role, disabled }: { userId: string; spaceId: string; role: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <select className="input !min-h-[34px] !w-auto !py-1 text-sm" defaultValue={role} disabled={disabled || pending} aria-label="Role" onChange={(e) => start(async () => { const r = await setSpaceRole(userId, spaceId, e.target.value); setError(r.ok ? null : r.error); })}>
        <option value="none">No access</option>
        <option value="viewer">Viewer</option>
        <option value="editor">Editor</option>
        <option value="owner">Owner</option>
      </select>
      {error && <span className="block text-xs text-bad">{error}</span>}
    </span>
  );
}

export function InviteForm({ spaces }: { spaces: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult<{ code: string }> | undefined, FormData>(createInvite, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <label className="text-sm"><span className="label">Person&apos;s name</span><input name="personName" className="input mt-1" required placeholder="e.g. Sam" /></label>
      <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
        {spaces.map((sp) => (
          <label key={sp.id} className="text-sm"><span className="label">{sp.name}</span>
            <select name={`role:${sp.id}`} className="input mt-1" defaultValue="editor">
              <option value="none">No access</option>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="owner">Owner</option>
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create invite link"}</button>
        {state && !state.ok && <p className="text-sm text-bad">{state.error}</p>}
        {state?.ok && state.data && <p className="text-sm text-good">Created. Share <code className="rounded bg-surface-3 px-1">/sign-in?invite={state.data.code}</code> yourself.</p>}
      </div>
      <p className="text-xs text-ink-3 sm:col-span-2">The invited person gets their own private personal space. Nobody can be granted another person&apos;s personal space.</p>
    </form>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => { await revokeInvite(id); })}>Revoke</button>;
}
