import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
