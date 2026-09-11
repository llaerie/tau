export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-48 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
    </div>
  );
}
