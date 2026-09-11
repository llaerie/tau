"use client";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the digest is logged: no financial data, no stack in the console.
    console.error(`[ui] error boundary ${error.digest ?? ""}`);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-bad">Something went wrong</div>
      <h1 className="mt-2 text-[20px] font-semibold tracking-tight">The console hit an unexpected error</h1>
      <p className="mt-2 text-[13px] text-muted">{error.message || "Unknown error"}</p>
      {error.digest ? <p className="mono mt-1 text-[11px] text-faint">digest {error.digest}</p> : null}
      <button onClick={reset} className="mt-5 inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2">
        Try again
      </button>
    </main>
  );
}
