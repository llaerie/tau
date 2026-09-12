/**
 * The assistant's visible presence. A compact layered emblem, 48-64px, not a
 * decorative centrepiece. Motion is tied to real state and stops when idle.
 */
export type PresenceState = "idle" | "working" | "listening" | "offline";

const LABEL: Record<PresenceState, string> = {
  idle: "Assistant ready",
  working: "Assistant working",
  listening: "Listening",
  offline: "Assistant not connected",
};

export function AssistantPresence({ state = "idle", size = 56, className = "" }: { state?: PresenceState; size?: number; className?: string }) {
  const active = state === "working" || state === "listening";
  const ring = state === "offline" ? "var(--fd-control-border)" : "var(--fd-primary)";
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={LABEL[state]}
      data-testid="assistant-presence"
      data-state={state}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{ background: `radial-gradient(circle at 34% 28%, var(--fd-emblem-halo), transparent 68%)`, transform: "scale(1.55)" }}
      />
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="relative">
        <defs>
          <linearGradient id="fd-emblem-core" x1="0" y1="0" x2="0.65" y2="1">
            <stop offset="0%" stopColor="var(--fd-primary)" />
            <stop offset="100%" stopColor="var(--fd-primary-strong)" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="30" fill="none" stroke={ring} strokeOpacity="0.28" strokeWidth="1.5" />
        <circle
          cx="32"
          cy="32"
          r="30"
          fill="none"
          stroke={ring}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray={state === "offline" ? "4 8" : "34 154"}
          className={active ? "fd-presence-spin" : ""}
          style={{ transformOrigin: "32px 32px" }}
        />
        <circle cx="32" cy="32" r="21" fill="url(#fd-emblem-core)" opacity={state === "offline" ? 0.34 : 1} />
        <circle cx="32" cy="32" r="21" fill="none" stroke="rgb(255 255 255 / 34%)" strokeWidth="1" />
        <path d="M24 30h16M24 36h10" stroke="var(--fd-on-primary)" strokeOpacity={state === "offline" ? 0.5 : 0.92} strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </span>
  );
}
