import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dashboard pages read the login cookie on every request, so we use
  // classic dynamic rendering instead of Cache Components for Phase 1.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "sharp"],
  experimental: {
    serverActions: { bodySizeLimit: "3mb" }, // logo uploads
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
