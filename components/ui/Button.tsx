import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ok";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg border-accent hover:opacity-90",
  secondary: "bg-surface text-fg border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-fg border-transparent hover:bg-surface-2",
  danger: "bg-surface text-bad border-bad/50 hover:bg-bad-soft",
  ok: "bg-surface text-ok border-ok/50 hover:bg-ok-soft",
};
const sizes: Record<ButtonSize, string> = { sm: "h-7 px-2.5 text-[12px]", md: "h-8 px-3 text-[13px]" };

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = ""): string {
  return `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({ variant = "secondary", size = "md", className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }) {
  return (
    <button className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "secondary", size = "md", className = "", children }: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}
