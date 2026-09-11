"use client";
import { useEffect } from "react";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(`[ui] section error ${error.digest ?? ""}`);
  }, [error]);
  return (
    <div className="rounded-lg border border-bad/40 bg-bad-soft p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-bad">Section failed to render</div>
      <p className="mt-1 text-[13px]">{error.message || "Unknown error"}</p>
      {error.digest ? <p className="mono mt-1 text-[11px] text-faint">digest {error.digest}</p> : null}
      <button onClick={reset} className="mt-3 inline-flex h-7 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[12px] font-medium hover:bg-surface-2">
        Retry
      </button>
    </div>
  );
}
