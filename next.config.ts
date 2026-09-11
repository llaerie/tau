import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  async redirects() {
    return [
      { source: "/overview", destination: "/", permanent: false },
      { source: "/assistant", destination: "/", permanent: false },
      { source: "/scenarios", destination: "/", permanent: false },
      { source: "/onboarding", destination: "/", permanent: false },
      { source: "/company", destination: "/money?space=company", permanent: false },
      { source: "/household", destination: "/money?space=household", permanent: false },
      { source: "/personal/:id", destination: "/money?space=me", permanent: false },
      { source: "/accounts", destination: "/money", permanent: false },
      { source: "/transactions", destination: "/activity", permanent: false },
      { source: "/transactions/import", destination: "/activity", permanent: false },
      { source: "/more", destination: "/settings", permanent: false },
    ];
  },
};

export default nextConfig;
