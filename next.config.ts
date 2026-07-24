import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: [
    "lightningcss",
    "lightningcss-win32-x64-msvc",
    "whatsapp-web.js",
    "puppeteer",
  ],
  async headers() {
    const masterHeaders = [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/mavo", headers: masterHeaders },
      { source: "/api/mavo/:path*", headers: masterHeaders },
    ];
  },
};

export default nextConfig;

