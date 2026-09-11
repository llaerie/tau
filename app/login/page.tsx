import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveAuthMode } from "@/lib/security/auth-mode";
import { authenticateFullModeToken } from "@/lib/security/auth";
import { SESSION_COOKIE_NAME } from "@/lib/security/session";
import { VERSION_TAG } from "@/components/shell/nav";
import { LoginForm } from "@/components/auth/LoginForm";
import type { SearchParams } from "@/lib/ui/page";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (resolveAuthMode() !== "full") redirect("/overview");
  const q = await searchParams;
  const next = Array.isArray(q.next) ? q.next[0] : q.next;

  const jar = await cookies();
  let signedIn = false;
  try {
    authenticateFullModeToken(jar.get(SESSION_COOKIE_NAME)?.value);
    signedIn = true;
  } catch {
    signedIn = false;
  }
  if (signedIn) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <div className="text-[22px] font-semibold tracking-tight">Tau AI CFO</div>
          <div className="mt-0.5 text-[12px] text-muted">{VERSION_TAG}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-5 shadow-[var(--shadow)]">
          <h1 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Sign in</h1>
          <p className="mb-4 text-[13px] text-muted">Use the account an owner created for you. Your role decides what you can see and approve.</p>
          <LoginForm next={next} />
        </div>
        <p className="mt-4 text-center text-[11px] text-faint">Synthetic lab data only — no live financial accounts are connected. Sessions expire after 12 hours.</p>
      </div>
    </main>
  );
}
