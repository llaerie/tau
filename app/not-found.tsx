import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">404</div>
      <h1 className="mt-2 text-[22px] font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-[13px] text-muted">That route is not part of the Phase One console.</p>
      <Link href="/overview" className="mt-5 inline-flex h-8 items-center rounded-md border border-accent bg-accent px-3 text-[13px] font-medium text-accent-fg">
        Go to Overview
      </Link>
    </main>
  );
}
