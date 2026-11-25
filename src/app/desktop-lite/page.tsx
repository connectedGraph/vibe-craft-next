import type { Metadata } from "next";
import DesktopLiteApp from "@/components/desktop/DesktopLiteApp";

export const metadata: Metadata = {
  title: "Aura PKM · Vibe Craft",
  description: "Aura PKM：剪贴板、日志、规划与知识坑的极简工作台",
};

export default function DesktopLitePage() {
  return <DesktopLiteApp />;
}
