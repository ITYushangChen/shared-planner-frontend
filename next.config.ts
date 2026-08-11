import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许局域网 IP / Cloudflare 隧道在开发模式下加载 /_next 资源
  allowedDevOrigins: ["*.trycloudflare.com", "10.88.12.34"],
  experimental: {
    optimizePackageImports: [
      "@fullcalendar/core",
      "@fullcalendar/react",
      "@fullcalendar/daygrid",
      "@fullcalendar/timegrid",
      "@fullcalendar/interaction",
    ],
  },
};

export default nextConfig;
