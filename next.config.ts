import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // 尚未迁移的工具暂时反代到旧 Node 服务
    return [{ source: "/legacy/:path*", destination: "http://127.0.0.1:8792/:path*" }];
  },
  async redirects() {
    return [
      { source: "/login.html", destination: "/login", permanent: false },
      { source: "/admin.html", destination: "/admin", permanent: false },
    ];
  },
};

export default nextConfig;
