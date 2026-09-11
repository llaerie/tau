export interface NavItem {
  href: string;
  label: string;
  group: "Command" | "Operations" | "Governance";
  badgeKey?: "approvals" | "attention";
}

export const NAV: NavItem[] = [
  { href: "/overview", label: "Overview", group: "Command" },
  { href: "/cfo", label: "CFO", group: "Command", badgeKey: "attention" },
  { href: "/company", label: "Company setup", group: "Command" },
  { href: "/transactions", label: "Transactions", group: "Operations" },
  { href: "/accounting", label: "Accounting", group: "Operations" },
  { href: "/cash", label: "Cash", group: "Operations" },
  { href: "/budget", label: "Budget & forecast", group: "Operations" },
  { href: "/payroll", label: "Payroll", group: "Operations" },
  { href: "/ap", label: "Payables", group: "Operations" },
  { href: "/ar", label: "Receivables", group: "Operations" },
  { href: "/tax", label: "Tax", group: "Operations" },
  { href: "/documents", label: "Documents", group: "Operations" },
  { href: "/reports", label: "Reports", group: "Operations" },
  { href: "/approvals", label: "Approvals", group: "Governance", badgeKey: "approvals" },
  { href: "/academy", label: "Academy", group: "Governance" },
  { href: "/audit", label: "Audit", group: "Governance" },
  { href: "/settings", label: "Settings", group: "Governance" },
];

export const VERSION_TAG = "Phase One – Training Lab";
