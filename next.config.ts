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
    return [];
  },
  async redirects() {
    const tools: string[] = [];
    return [
      { source: "/login.html", destination: "/login", permanent: false },
      { source: "/admin.html", destination: "/admin", permanent: false },
      // 静态工具目录 → index.html
      ...tools.map((t) => ({ source: `/${t}`, destination: `/${t}/index.html`, permanent: false })),
      { source: "/index.html", destination: "/", permanent: false },
      // 已 React 化的工具：旧静态地址回跳
      { source: "/adhd-text/index.html", destination: "/adhd-text", permanent: false },
      { source: "/contextly/index.html", destination: "/contextly", permanent: false },
      { source: "/expressing/index.html", destination: "/expressing", permanent: false },
      { source: "/desktop-lite/index.html", destination: "/desktop-lite", permanent: false },
      // 旧版 /legacy/* 地址跳回新路径
      { source: "/legacy/:path*", destination: "/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
