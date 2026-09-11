"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ActionCard } from "@/components/assistant/ActionCard";
import { actionsApi, idempotencyKey, type ActionView } from "@/components/assistant/client";

/** Draft → preview → approve → apply for a page-initiated action. Refreshes server data once applied. */
export function useDraftAction(prefix: string) {
  const router = useRouter();
  const [action, setAction] = useState<ActionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useCallback(
    async (type: string, payload: unknown) => {
      setBusy(true);
      setError(null);
      try {
        setAction(await actionsApi.draft(type, payload, idempotencyKey(prefix)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not prepare the change.");
      } finally {
        setBusy(false);
      }
    },
    [prefix],
  );
  const onChange = useCallback(
    (a: ActionView) => {
      setAction(a);
      if (a.status === "applied") router.refresh();
    },
    [router],
  );
  const clear = useCallback(() => setAction(null), []);
  return { action, error, busy, draft, onChange, clear };
}

export function ActionFlowCard({ action, onChange, onDone }: { action: ActionView; onChange: (a: ActionView) => void; onDone?: () => void }) {
  return (
    <div className="mt-3">
      <ActionCard actionId={action.id} initial={action} onChange={onChange} />
      {(action.status === "applied" || action.status === "cancelled") && onDone && (
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={onDone}>
          Done
        </button>
      )}
    </div>
  );
}
