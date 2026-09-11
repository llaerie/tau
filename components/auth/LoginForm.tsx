"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

function safeNext(next: string | undefined): string {
  // Only same-origin absolute paths; never protocol-relative or external.
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/overview";
  return next;
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `Sign-in failed (${res.status})`);
      setPassword("");
      router.replace(safeNext(next));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-describedby={error ? "login-error" : undefined}>
      <label className="block text-[12px] text-muted">
        Email
        <input name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1" autoFocus disabled={busy} />
      </label>
      <label className="block text-[12px] text-muted">
        Password
        <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="input mt-1" disabled={busy} />
      </label>
      {error ? (
        <div id="login-error" role="alert" className="rounded-md border border-bad/40 bg-bad-soft px-3 py-2 text-[12px] text-bad">
          {error}
        </div>
      ) : null}
      <button type="submit" disabled={busy || !email || !password} className="inline-flex h-9 w-full items-center justify-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
