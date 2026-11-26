import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vibe Craft",
  description: "学习与表达积累工具集",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Vibe Craft", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        {/* 图标字体本地托管：断网 / CDN 被墙时也不会出现空白按钮 */}
        <link rel="stylesheet" href="/vendor/phosphor/regular/style.css" precedence="default" />
        <link rel="stylesheet" href="/vendor/phosphor/bold/style.css" precedence="default" />
        <link rel="stylesheet" href="/vendor/phosphor/fill/style.css" precedence="default" />
      </head>
      <body className="min-h-full bg-[#eef1ff] text-slate-900">{children}</body>
    </html>
  );
}
