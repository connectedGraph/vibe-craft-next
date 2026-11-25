import type { Metadata } from "next";
import AdhdTextApp from "@/components/adhd/AdhdTextApp";

export const metadata: Metadata = {
  title: "Typography Lab · Vibe Craft",
  description: "阅读排版实验：字号、行高、字距与抗阅读障碍字体",
};

export default function AdhdTextPage() {
  return <AdhdTextApp />;
}
