"use client";

import { useCallback, useMemo, useRef, useState } from "react";

type Settings = {
  font: string;
  size: number;
  lh: number;
  ls: number;
  ws: number;
  bg: string;
  text: string;
};

type TabId = "test-cn" | "test-en" | "test-code";

const FONT_OPTIONS = [
  { value: "'Lexend', 'Noto Sans SC', sans-serif", label: "Lexend (专为阅读优化)" },
  { value: "'OpenDyslexic', sans-serif", label: "OpenDyslexic (专业抗障碍)" },
  { value: "'Noto Sans SC', sans-serif", label: "思源黑体 (标准无衬线)" },
  { value: "'Comic Sans MS', cursive", label: "Comic Sans (非对称推荐)" },
  { value: "serif", label: "系统衬线 (宋体)" },
];

const TABS: { id: TabId; label: string }[] = [
  { id: "test-cn", label: "中文测试" },
  { id: "test-en", label: "English Test" },
  { id: "test-code", label: "Code Clarity" },
];

const DEFAULTS: Settings = {
  font: "'Lexend', 'Noto Sans SC', sans-serif",
  size: 18,
  lh: 1.6,
  ls: 0,
  ws: 0,
  bg: "#ffffff",
  text: "#1a1a1a",
};

const PRESETS: Record<string, { settings: Settings; ruler?: boolean }> = {
  default: { settings: DEFAULTS },
  dyslexia: {
    settings: { font: "'OpenDyslexic', sans-serif", size: 22, lh: 2.0, ls: 2, ws: 6, bg: "#fdfbf7", text: "#1a202c" },
    ruler: true,
  },
  reading: {
    settings: { font: "'Lexend', sans-serif", size: 20, lh: 1.8, ls: 0.5, ws: 2, bg: "#f4ecd8", text: "#433422" },
  },
  dark: {
    settings: { font: "'Noto Sans SC', sans-serif", size: 18, lh: 1.7, ls: 0.5, ws: 0, bg: "#1a1b1e", text: "#e2e8f0" },
  },
};

const CODE_SAMPLE = `function processInput(id, value) {
  // Can you distinguish '1', 'l', and 'I'?
  const filter_ID = "l1I";
  const result = id === 1 || id === 'l' ? value : null;

  // Is 'rn' looking like 'm'?
  const kernel = "kernal_process_rn";

  return result;
}`;

export default function AdhdTextApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [rulerOn, setRulerOn] = useState(false);
  const [rulerVisible, setRulerVisible] = useState(false);
  const [rulerTop, setRulerTop] = useState(0);
  const [tab, setTab] = useState<TabId>("test-cn");
  const paperRef = useRef<HTMLElement | null>(null);

  const rulerHeight = settings.size * settings.lh;

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((name: string) => {
    const preset = PRESETS[name];
    if (!preset) return;
    setSettings(preset.settings);
    if (preset.ruler !== undefined) setRulerOn(preset.ruler);
  }, []);

  const onViewportMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!rulerOn || !paperRef.current) return;
      const rect = paperRef.current.getBoundingClientRect();
      setRulerVisible(true);
      setRulerTop(event.clientY - rect.top - rulerHeight / 2);
    },
    [rulerOn, rulerHeight],
  );

  const exportCss = useCallback(() => {
    const css = `/* Reading Optimization Config */
.optimized-reading {
  font-family: ${settings.font};
  font-size: ${settings.size}px;
  line-height: ${settings.lh};
  letter-spacing: ${settings.ls}px;
  word-spacing: ${settings.ws}px;
  background-color: ${settings.bg};
  color: ${settings.text};
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}`;
    console.log(css);
    navigator.clipboard?.writeText(css).catch(() => {});
    window.alert(
      `配置已生成并复制到剪贴板\n\n推荐参数:\n字号: ${settings.size}px\n行高: ${settings.lh}`,
    );
  }, [settings]);

  const paperStyle = useMemo<React.CSSProperties>(
    () => ({
      fontFamily: settings.font,
      fontSize: `${settings.size}px`,
      lineHeight: settings.lh,
      letterSpacing: `${settings.ls}px`,
      wordSpacing: `${settings.ws}px`,
      backgroundColor: settings.bg,
      color: settings.text,
    }),
    [settings],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100" style={{ fontFamily: "'Lexend', 'Noto Sans SC', sans-serif" }}>
      <style>{`
        @font-face {
          font-family: 'OpenDyslexic';
          src: url('https://cdn.jsdelivr.net/npm/opendyslexic@3.0.0/woff/OpenDyslexic-Regular.woff') format('woff');
        }
        .adhd-viewport::-webkit-scrollbar { width: 6px; }
        .adhd-viewport::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .adhd-viewport::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .adhd-viewport input[type="range"] {
          -webkit-appearance: none;
          height: 6px;
          background: #e2e8f0;
          border-radius: 5px;
          accent-color: #3b82f6;
        }
      `}</style>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;700&family=Noto+Sans+SC:wght@400;500;700&display=swap"
      />

      <header className="z-20 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="rounded-lg bg-blue-600 p-2">
            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">
            Typography Lab <span className="ml-2 text-sm font-light text-slate-400">v2.0</span>
          </h1>
        </div>
        <button
          type="button"
          onClick={exportCss}
          className="flex items-center rounded-full bg-slate-800 px-5 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-slate-700 active:scale-95"
        >
          <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16a2 2 0 012-2h4a2 2 0 012 2v2H8v-2z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
          导出 CSS 配置
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="z-10 w-80 shrink-0 space-y-8 overflow-y-auto border-r border-slate-200 bg-white p-6 shadow-xl">
          <section>
            <h3 className="mb-4 flex items-center text-xs font-bold uppercase tracking-widest text-slate-400">
              <span className="mr-2">Presets</span>
              <div className="h-px flex-1 bg-slate-100" />
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["default", "标准模式"],
                ["dyslexia", "抗障碍友好"],
                ["reading", "深度阅读"],
                ["dark", "极致暗黑"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium transition hover:border-blue-400 hover:text-blue-600"
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <h3 className="mb-2 flex items-center text-xs font-bold uppercase tracking-widest text-slate-400">
              <span className="mr-2">Styling</span>
              <div className="h-px flex-1 bg-slate-100" />
            </h3>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700" htmlFor="ctrl-font">
                字体族 (Font Family)
              </label>
              <select
                id="ctrl-font"
                value={settings.font}
                onChange={(e) => update("font", e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-4">
              <Slider
                label="字号"
                id="ctrl-size"
                value={settings.size}
                display={`${settings.size}px`}
                min={14}
                max={48}
                onChange={(v) => update("size", v)}
              />
              <Slider
                label="行高"
                id="ctrl-lh"
                value={settings.lh}
                display={String(settings.lh)}
                min={1}
                max={3.5}
                step={0.1}
                onChange={(v) => update("lh", v)}
              />
              <Slider
                label="字间距"
                id="ctrl-ls"
                value={settings.ls}
                display={`${settings.ls}px`}
                min={-1}
                max={15}
                step={0.5}
                onChange={(v) => update("ls", v)}
              />
              <Slider
                label="词间距 (英文)"
                id="ctrl-ws"
                value={settings.ws}
                display={`${settings.ws}px`}
                min={0}
                max={25}
                step={1}
                onChange={(v) => update("ws", v)}
              />
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="mb-2 flex items-center text-xs font-bold uppercase tracking-widest text-slate-400">
              <span className="mr-2">Colors</span>
              <div className="h-px flex-1 bg-slate-100" />
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400" htmlFor="ctrl-bg">
                  背景色
                </label>
                <input
                  id="ctrl-bg"
                  type="color"
                  value={settings.bg}
                  onChange={(e) => update("bg", e.target.value)}
                  className="h-10 w-full cursor-pointer rounded-lg border border-slate-100 p-1"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase text-slate-400" htmlFor="ctrl-text">
                  文字色
                </label>
                <input
                  id="ctrl-text"
                  type="color"
                  value={settings.text}
                  onChange={(e) => update("text", e.target.value)}
                  className="h-10 w-full cursor-pointer rounded-lg border border-slate-100 p-1"
                />
              </div>
            </div>
          </section>

          <section className="border-t border-slate-100 pt-4">
            <label className="group flex cursor-pointer items-center">
              <input
                id="ctrl-ruler"
                type="checkbox"
                checked={rulerOn}
                onChange={(e) => {
                  setRulerOn(e.target.checked);
                  setRulerVisible(e.target.checked);
                }}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="ml-3 text-sm font-medium text-slate-600 transition group-hover:text-blue-600">
                开启阅读辅助线 (Ruler)
              </span>
            </label>
          </section>
        </aside>

        <main className="relative flex flex-1 flex-col overflow-hidden">
          <nav className="flex shrink-0 border-b border-slate-200 bg-white px-8">
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`border-b-2 px-6 py-4 text-sm transition ${
                    active
                      ? "border-blue-600 font-bold text-blue-600"
                      : "border-transparent font-medium text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div
            className="adhd-viewport flex flex-1 justify-center overflow-y-auto bg-slate-100/50 p-12"
            onMouseMove={onViewportMove}
          >
            <article
              ref={paperRef}
              className="relative min-h-full w-full max-w-4xl rounded-sm p-16 shadow-2xl transition-all duration-300"
              style={paperStyle}
            >
              <div
                className="pointer-events-none absolute left-0 z-10 w-full"
                style={{
                  height: `${rulerHeight}px`,
                  top: `${rulerTop}px`,
                  display: rulerOn && rulerVisible ? "block" : "none",
                  backgroundColor: "rgba(59, 130, 246, 0.15)",
                  borderTop: "1px solid rgba(59, 130, 246, 0.3)",
                  borderBottom: "1px solid rgba(59, 130, 246, 0.3)",
                }}
              />

              {tab === "test-cn" && (
                <div className="space-y-6">
                  <h2 className="mb-8 text-3xl font-bold">中文排版易读性分析</h2>
                  <p>
                    对阅读障碍（Dyslexia）群体而言，文字排版的好坏决定了阅读是“获取信息”还是“受罪”。视觉拥挤（Visual
                    Crowding）是核心难点，当字符间距过小时，大脑会难以区分笔画归属，产生文字连在一起或者在“跳舞”的错觉。
                  </p>
                  <p>
                    请尝试左侧的<strong>“字间距 (Letter Spacing)”</strong>
                    滑块。对于有视觉压力的读者，增加 1-2px 的字间距往往能让阅读速度提升 20%
                    以上。同时，思源黑体这类无衬线字体，由于笔画末端没有多余的修饰，在小字号下通常比宋体更清晰。
                  </p>
                  <p>
                    高对比度也并非总是好事。纯黑 (#000) 与纯白 (#FFF) 的剧烈对比会产生闪烁感。尝试将背景调成米黄色
                    (#F4ECD8)，你会发现眼睛的紧绷感瞬间缓解。
                  </p>
                </div>
              )}

              {tab === "test-en" && (
                <div className="space-y-6">
                  <h2 className="mb-8 text-3xl font-bold">Dyslexia-Friendly English</h2>
                  <p>
                    English letters are notorious for their symmetry. Letters like &apos;b&apos; and &apos;d&apos;,
                    &apos;p&apos; and &apos;q&apos; are just mirrored versions of each other. In many fonts, these are
                    perfect geometrical flips, which makes rotation errors very common.
                  </p>
                  <div className="my-8 rounded-xl border border-blue-100 bg-blue-50/50 p-6 text-center font-mono text-4xl tracking-widest">
                    b d p q | u n | I l 1
                  </div>
                  <p>
                    Switch the font to <strong>&quot;OpenDyslexic&quot;</strong>. Notice how the bottom of each letter is
                    weighted? This provides a &quot;gravity&quot; effect, helping your brain understand which side is down
                    and preventing mental rotation. Another great choice is <strong>&quot;Lexend&quot;</strong>, which was
                    mathematically designed to reduce visual stress.
                  </p>
                  <p>
                    Increasing <strong>Word Spacing</strong> can also prevent words from blending into a gray blur,
                    allowing the brain to process one unit of meaning at a time.
                  </p>
                </div>
              )}

              {tab === "test-code" && (
                <div className="space-y-6">
                  <h2 className="mb-8 text-3xl font-bold">编程字符区分度</h2>
                  <p>
                    代码阅读不仅是逻辑理解，更是字符匹配。如果排版不当，简单的符号混淆可能导致灾难性的 Debug。
                  </p>
                  <pre className="overflow-x-auto rounded-lg bg-slate-900 p-8 font-mono text-lg text-slate-300 shadow-inner">
                    <code>{CODE_SAMPLE}</code>
                  </pre>
                  <p>
                    如果你在阅读上面的代码片段时感到费劲，请调整左侧的<strong>字间距</strong>或切换到{" "}
                    <strong>Lexend</strong> 字体。良好的行高（建议 1.8 以上）能有效防止视线在嵌套代码中迷失。
                  </p>
                </div>
              )}
            </article>
          </div>
        </main>
      </div>
    </div>
  );
}

function Slider({
  label,
  id,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  id: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex justify-between">
        <label className="text-sm font-semibold text-slate-700" htmlFor={id}>
          {label}
        </label>
        <span className="font-mono text-xs text-blue-500">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}
