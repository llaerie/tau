export function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <p className="label">Finance Desk</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Configuration needed</h1>
      <p className="mt-4 text-ink-2">{message}</p>
      <pre className="mt-6 overflow-x-auto rounded-xl bg-surface-3 p-4 text-sm">{`# synthetic demo\nFINANCE_DESK_MODE=demo pnpm dev\n\n# real data\nFINANCE_DESK_MODE=live AUTH_SECRET=$(openssl rand -hex 32) pnpm start`}</pre>
      <p className="mt-4 text-sm text-ink-3">Finance Desk never falls back to demo access when live mode is misconfigured.</p>
    </main>
  );
}
