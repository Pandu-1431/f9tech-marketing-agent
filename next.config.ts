import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dashboard pages read the login cookie on every request, so we use
  // classic dynamic rendering instead of Cache Components for Phase 1.
  poweredByHeader: false,
  // Basic security headers on every page (HSTS is set by nginx, see deploy/nginx.conf).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  serverExternalPackages: ["@electric-sql/pglite", "pg", "sharp", "ffmpeg-static"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" }, // logo + product screenshot uploads
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
