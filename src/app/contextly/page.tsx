import type { Metadata } from "next";
import ContextlyApp from "@/components/contextly/ContextlyApp";

export const metadata: Metadata = {
  title: "Contextly · Vibe Craft",
  description: "带上下文的词汇积累：生词、当前句、前后句一起记",
};

export default function ContextlyPage() {
  return <ContextlyApp />;
}
