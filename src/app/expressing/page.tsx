import type { Metadata } from "next";
import ExpressingApp from "@/components/expressing/ExpressingApp";

export const metadata: Metadata = {
  title: "Expressing · Vibe Craft",
  description: "中文 → 地道英文：初稿与润色后表达左右对比",
};

export default function ExpressingPage() {
  return <ExpressingApp />;
}
