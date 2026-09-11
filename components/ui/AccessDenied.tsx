import Link from "next/link";
import { Notice } from "./Notice";

export function AccessDenied({ permission, role }: { permission: string; role: string }) {
  return (
    <Notice tone="bad" title="Access restricted">
      Your lab role <span className="mono">{role}</span> lacks the <span className="mono">{permission}</span> permission. Switch roles in{" "}
      <Link href="/settings?tab=session" className="underline">
        Settings → Session
      </Link>
      .
    </Notice>
  );
}
