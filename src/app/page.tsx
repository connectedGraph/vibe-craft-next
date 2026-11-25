import Link from "next/link";
import { redirect } from "next/navigation";
import { authConfig, ensureSeedOnce, findUser, getMode, identityFromCookies } from "@/lib/auth";

export const dynamic = "force-dynamic";

  ensureSeedOnce();

const tools = [
  {
    href: "/prompt-capsule",
    name: "Prompt Capsule",
    desc: "把 AI 对话、问题和分析整理成可标注的知识卡。",
    icon: "📖",
    react: true,
    tag: "React",
  },
  {
    href: "/legacy/contextly/index.html",
    name: "Contextly",
    desc: "带上下文的词汇积累：生词、当前句、前后句一起记。",
    icon: "🔤",
    react: false,
    tag: "迁移中",
  },
  {
    href: "/legacy/expressing/index.html",
    name: "Expressing",
    desc: "中文 → 地道英文：初稿与润色后表达左右对比。",
    icon: "⇄",
    react: false,
    tag: "迁移中",
  },
  {
    href: "/legacy/desktop-lite/index.html",
    name: "Desktop Lite",
    desc: "Aura PKM：剪贴板、日志、索引和极简专注工作台。",
    icon: "🗂",
    react: false,
    tag: "迁移中",
  },
];

export default async function Home() {
  ensureSeedOnce();
  let identity = await identityFromCookies();
  if (!identity && getMode() === "off") {
    const admin = findUser(authConfig.adminUser || "admin");
    if (admin && !admin.disabled) identity = { username: admin.username, role: admin.role, user: admin };
  }
  if (!identity) redirect("/login");

  return (
    <main className="min-h-screen bg-[#0b0f19] bg-[radial-gradient(at_0%_0%,rgba(99,102,241,.18)_0px,transparent_50%),radial-gradient(at_100%_100%,rgba(168,85,247,.16)_0px,transparent_50%)] px-5 py-10 text-slate-100">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
              Vibe Craft
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              学习与表达积累工具集 · 数据本地存储，账号负责多设备同步
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              {identity.username}
              {identity.role === "admin" ? " · 管理员" : ""}
            </span>
            {identity.role === "admin" && (
              <Link href="/admin" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 transition hover:border-indigo-400/40 hover:text-indigo-300">
                管理
              </Link>
            )}
            <form action="/api/v1/auth/logout" method="post">
              <button className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 transition hover:border-red-400/40 hover:text-red-300">
                退出
              </button>
            </form>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.name}
              href={tool.href}
              className="group relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-400/30 hover:shadow-2xl hover:shadow-indigo-500/10"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative space-y-3">
                <div className="flex items-center justify-between">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-2xl text-indigo-300">
                    {tool.icon}
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${tool.react ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>
                    {tool.tag}
                  </span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-100 transition-colors group-hover:text-indigo-300">
                    {tool.name}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{tool.desc}</p>
                </div>
                <div className="text-xs font-semibold text-indigo-400 transition-transform group-hover:translate-x-1">
                  打开 →
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-center text-[11px] text-slate-600">
          Prompt Capsule 已迁移到 React；其余工具正在迁移，暂时通过 /legacy 访问旧版。
        </p>
      </div>
    </main>
  );
}
