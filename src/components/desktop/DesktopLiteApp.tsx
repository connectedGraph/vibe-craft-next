"use client";

import Script from "next/script";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyListChanges,
  BOARD_COLORS,
  confettiBurst,
  defaultState,
  dict,
  loadLang,
  loadState,
  persist,
  playSound,
  saveLang,
  todayString,
  type AuraState,
  type Clipboard,
  type DailyLog,
  type InboxItem,
  type Lang,
  type Pit,
} from "@/lib/tools/desktopLite";

const QUOTES = ['"纯粹至美，至简则灵"', '"把灵感交给剪贴板，把心交给专注"', '"少即是多"', '"深沉的知识，始于每一次开坑"'];

const NAV_ICONS = ["fa-solid fa-compass", "fa-solid fa-feather-pointed", "fa-solid fa-map", "fa-solid fa-seedling"];

export default function DesktopLiteApp() {
  const [lang, setLang] = useState<Lang>("cn");
  const [mainTab, setMainTab] = useState(0);
  const [subTab, setSubTab] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [aura, setAura] = useState<AuraState>(defaultState);
  const auraRef = useRef<AuraState>(defaultState());
  const [logDate, setLogDate] = useState(() => todayString());
  const [clock, setClock] = useState("00:00:00");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const [sanitize, setSanitize] = useState<(html: string) => string>(() => (h: string) => h);

  // 视图内的输入草稿
  const [newTopic, setNewTopic] = useState("");
  const [logInput, setLogInput] = useState("");
  const [inbox, setInbox] = useState({ title: "", link: "", note: "", priority: "normal" as InboxItem["priority"] });
  const [pitFormOpen, setPitFormOpen] = useState(false);
  const [pitForm, setPitForm] = useState({ name: "", milestones: "" });
  const [milestoneDraft, setMilestoneDraft] = useState<Record<number, string>>({});
  const [plannerEdit, setPlannerEdit] = useState<Record<number, boolean>>({});
  const [plannerDraft, setPlannerDraft] = useState<Record<number, string>>({});

  const logInputRef = useRef<HTMLInputElement | null>(null);
  const mountedSync = useRef(false);

  const d = useMemo(() => dict(lang), [lang]);

  const setSavingFlash = useCallback(() => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 500);
  }, []);

  const commit = useCallback(
    (updater: (prev: AuraState) => AuraState, options?: { silent?: boolean }) => {
      setAura((prev) => {
        const next = updater(prev);
        auraRef.current = next;
        persist(next);
        return next;
      });
      if (!options?.silent) setSavingFlash();
    },
    [setSavingFlash],
  );

  // 初始化
  useEffect(() => {
    const loaded = loadState();
    auraRef.current = loaded;
    setAura(loaded);
    setLang(loadLang());
    setHydrated(true);
    import("dompurify")
      .then((m) => setSanitize(() => (h: string) => m.default.sanitize(h)))
      .catch(() => {});
  }, []);

  // 时钟
  useEffect(() => {
    const tick = () => setClock(new Date().toTimeString().split(" ")[0]);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  // 番茄钟
  useEffect(() => {
    if (!aura.pomodoro.isRunning) return;
    const id = window.setInterval(() => {
      const current = auraRef.current;
      if (current.pomodoro.remaining > 0) {
        const remaining = current.pomodoro.remaining - 1;
        commit(
          (prev) => ({ ...prev, pomodoro: { ...prev.pomodoro, remaining } }),
          { silent: true },
        );
        if (remaining % 10 === 0) playSound("tick");
      } else {
        playSound("complete");
        const wasFocus = current.pomodoro.state === "Focus";
        if (wasFocus) confettiBurst({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        commit(
          (prev) => {
            const duration = wasFocus ? 5 : 25;
            return {
              ...prev,
              pomodoro: {
                ...prev.pomodoro,
                isRunning: false,
                streak: wasFocus ? prev.pomodoro.streak + 1 : prev.pomodoro.streak,
                duration,
                remaining: duration * 60,
                state: wasFocus ? "Short Break" : "Focus",
              },
            };
          },
          { silent: true },
        );
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [aura.pomodoro.isRunning, commit]);

  // 云同步
  useEffect(() => {
    if (mountedSync.current) return;
    let cancelled = false;
    let tries = 0;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      const widget = (window as unknown as { SyncWidget?: { mount: (o: unknown) => void } }).SyncWidget;
      if (widget) {
        window.clearInterval(timer);
        mountedSync.current = true;
        const applyTo = <K extends "clipboards" | "inboxItems" | "pits">(key: K) => (
          changes: { id: string; op?: string; data?: Partial<AuraState[K][number]>; updatedAt?: number }[],
        ) => {
          let changed = false;
          commit((prev) => {
            const list = [...(prev[key] as AuraState[K][number][])];
            changed = applyListChanges(list as { id: number | string; updatedAt?: number }[], changes as never[]);
            return changed ? ({ ...prev, [key]: list } as AuraState) : prev;
          }, { silent: true });
          return changed;
        };

        widget.mount({
          app: "desktop-lite",
          collections: {
            clipboards: {
              read: () => auraRef.current.clipboards,
              getId: (r: Clipboard) => r.id,
              getUpdatedAt: (r: Clipboard) => Number(r.updatedAt) || 0,
              applyChanges: applyTo("clipboards"),
            },
            inboxItems: {
              read: () => auraRef.current.inboxItems,
              getId: (r: InboxItem) => r.id,
              getUpdatedAt: (r: InboxItem) => Number(r.updatedAt) || 0,
              applyChanges: applyTo("inboxItems"),
            },
            pits: {
              read: () => auraRef.current.pits,
              getId: (r: Pit) => r.id,
              getUpdatedAt: (r: Pit) => Number(r.updatedAt) || 0,
              applyChanges: applyTo("pits"),
            },
            dailyLogs: {
              read: () => Object.entries(auraRef.current.dailyLogs || {}).map(([date, v]) => ({ id: date, ...v })),
              getId: (r: { id: string }) => r.id,
              getUpdatedAt: (r: { updatedAt?: number }) => Number(r.updatedAt) || 0,
              applyChanges: (
                changes: { id: string; op?: string; data?: Record<string, unknown>; updatedAt?: number }[],
              ) => {
                let changed = false;
                commit((prev) => {
                  const dailyLogs = { ...prev.dailyLogs };
                  for (const ch of changes) {
                    if (ch.op === "delete") {
                      if (dailyLogs[ch.id]) {
                        delete dailyLogs[ch.id];
                        changed = true;
                      }
                      continue;
                    }
                    if (!ch.data) continue;
                    const { id: _id, ...rest } = ch.data;
                    dailyLogs[ch.id] = {
                      ...(rest as unknown as DailyLog),
                      updatedAt: Math.max(Number(ch.data.updatedAt) || 0, Number(ch.updatedAt) || 0),
                    };
                    changed = true;
                  }
                  return changed ? { ...prev, dailyLogs } : prev;
                }, { silent: true });
                return changed;
              },
            },
            settings: {
              read: () => [
                {
                  id: "__singleton__",
                  logTopics: auraRef.current.logTopics,
                  currentLogTopic: auraRef.current.currentLogTopic,
                  plannerSlots: auraRef.current.plannerSlots,
                  timeline: auraRef.current.timeline,
                  pomodoro: { duration: auraRef.current.pomodoro.duration },
                  updatedAt: Number(auraRef.current.__settingsUpdatedAt) || 0,
                },
              ],
              getId: (r: { id: string }) => r.id,
              getUpdatedAt: (r: { updatedAt: number }) => Number(r.updatedAt) || 0,
              applyChanges: (
                changes: { op?: string; data?: Record<string, unknown>; updatedAt?: number }[],
              ) => {
                let changed = false;
                commit((prev) => {
                  let next = { ...prev };
                  for (const ch of changes) {
                    if (ch.op === "delete" || !ch.data) continue;
                    const data = ch.data as {
                      logTopics?: string[];
                      currentLogTopic?: string;
                      plannerSlots?: Record<number, string>;
                      timeline?: AuraState["timeline"];
                      pomodoro?: { duration?: number };
                    };
                    if (Array.isArray(data.logTopics)) next.logTopics = data.logTopics;
                    if (typeof data.currentLogTopic === "string") next.currentLogTopic = data.currentLogTopic;
                    if (data.plannerSlots && typeof data.plannerSlots === "object") next.plannerSlots = data.plannerSlots;
                    if (Array.isArray(data.timeline)) next.timeline = data.timeline;
                    if (data.pomodoro && Number.isFinite(data.pomodoro.duration)) {
                      next.pomodoro = {
                        ...next.pomodoro,
                        duration: data.pomodoro.duration as number,
                        remaining: next.pomodoro.isRunning
                          ? next.pomodoro.remaining
                          : (data.pomodoro.duration as number) * 60,
                      };
                    }
                    next.__settingsUpdatedAt = ch.updatedAt;
                    changed = true;
                  }
                  return next;
                }, { silent: true });
                return changed;
              },
            },
          },
          onApplied: () => setSaving(false),
        });
      } else if (++tries > 40) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [commit]);

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        playSound("click");
        setMainTab(Number(e.key) - 1);
        setSubTab(0);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setMainTab(1);
        setSubTab(1);
        window.setTimeout(() => logInputRef.current?.focus(), 80);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next: Lang = prev === "cn" ? "en" : "cn";
      saveLang(next);
      return next;
    });
  }, []);

  const switchMain = useCallback((index: number) => {
    playSound("click");
    setMainTab(index);
    setSubTab(0);
  }, []);

  const switchSub = useCallback((index: number) => {
    playSound("click");
    setSubTab(index);
  }, []);

  const logData = aura.dailyLogs[logDate] || { focus: 5, energy: 5, mood: 5, entries: [] };

  // ===== 各视图动作 =====
  const addBoard = useCallback(() => {
    playSound("click");
    commit((prev) => {
      const nextId = prev.clipboards.length ? Math.max(...prev.clipboards.map((b) => b.id)) + 1 : 1;
      return {
        ...prev,
        clipboards: [
          ...prev.clipboards,
          {
            id: nextId,
            title: `Board #${nextId}`,
            content: "",
            color: BOARD_COLORS[Math.floor(Math.random() * BOARD_COLORS.length)],
          },
        ],
      };
    });
  }, [commit]);

  const updateBoard = useCallback(
    (id: number, patch: Partial<Clipboard>) => {
      commit((prev) => ({
        ...prev,
        clipboards: prev.clipboards.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }));
    },
    [commit],
  );

  const addLogEntry = useCallback(() => {
    const text = logInput.trim();
    if (!text) return;
    playSound("success");
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    commit((prev) => {
      const day = prev.dailyLogs[logDate] || { focus: 5, energy: 5, mood: 5, entries: [] };
      return {
        ...prev,
        dailyLogs: {
          ...prev.dailyLogs,
          [logDate]: { ...day, entries: [...(day.entries || []), { topic: prev.currentLogTopic, text, time }] },
        },
      };
    });
    setLogInput("");
    window.setTimeout(() => logInputRef.current?.focus(), 50);
  }, [commit, logDate, logInput]);

  const addTopic = useCallback(() => {
    const value = newTopic.trim();
    if (!value) return;
    playSound("click");
    commit((prev) =>
      prev.logTopics.includes(value)
        ? { ...prev, currentLogTopic: value }
        : { ...prev, logTopics: [...prev.logTopics, value], currentLogTopic: value },
    );
    setNewTopic("");
  }, [commit, newTopic]);

  const removeTopic = useCallback(
    (topic: string) => {
      if (aura.logTopics.length <= 1) return;
      playSound("click");
      commit((prev) => {
        const logTopics = prev.logTopics.filter((t) => t !== topic);
        return {
          ...prev,
          logTopics,
          currentLogTopic: prev.currentLogTopic === topic ? logTopics[0] : prev.currentLogTopic,
        };
      });
    },
    [aura.logTopics.length, commit],
  );

  const addInbox = useCallback(() => {
    const title = inbox.title.trim();
    if (!title) return;
    playSound("success");
    commit((prev) => ({
      ...prev,
      inboxItems: [{ id: Date.now(), title, link: inbox.link.trim(), note: inbox.note.trim(), priority: inbox.priority, done: false }, ...prev.inboxItems],
    }));
    setInbox({ title: "", link: "", note: "", priority: "normal" });
  }, [commit, inbox]);

  const createPit = useCallback(() => {
    const name = pitForm.name.trim();
    if (!name) return;
    playSound("success");
    const milestones = pitForm.milestones
      .trim()
      ? pitForm.milestones
          .split(/[,，]/)
          .filter((s) => s.trim())
          .map((s) => ({ label: s.trim(), done: false }))
      : [];
    commit((prev) => ({ ...prev, pits: [{ id: Date.now(), name, milestones }, ...prev.pits] }));
    setPitForm({ name: "", milestones: "" });
    setPitFormOpen(false);
  }, [commit, pitForm]);

  const toggleMilestone = useCallback(
    (pitIndex: number, stoneIndex: number) => {
      playSound("success");
      commit((prev) => {
        const pits = prev.pits.map((pit, i) =>
          i === pitIndex
            ? {
                ...pit,
                milestones: pit.milestones.map((m, j) => (j === stoneIndex ? { ...m, done: !m.done } : m)),
              }
            : pit,
        );
        const total = pits[pitIndex].milestones.length;
        const completed = pits[pitIndex].milestones.filter((m) => m.done).length;
        if (total > 0 && total === completed) {
          window.setTimeout(() => confettiBurst({ particleCount: 150, spread: 80, origin: { y: 0.6 } }), 0);
        }
        return { ...prev, pits };
      });
    },
    [commit],
  );

  const addMilestone = useCallback(
    (pitIndex: number) => {
      const label = (milestoneDraft[pitIndex] || "").trim();
      if (!label) return;
      playSound("tick");
      commit((prev) => ({
        ...prev,
        pits: prev.pits.map((pit, i) => (i === pitIndex ? { ...pit, milestones: [...pit.milestones, { label, done: false }] } : pit)),
      }));
      setMilestoneDraft((prev) => ({ ...prev, [pitIndex]: "" }));
    },
    [commit, milestoneDraft],
  );

  const togglePlanner = useCallback(
    (slot: number) => {
      playSound("click");
      const editing = plannerEdit[slot];
      if (editing) {
        const text = plannerDraft[slot] ?? auraRef.current.plannerSlots[slot] ?? "";
        commit((prev) => ({ ...prev, plannerSlots: { ...prev.plannerSlots, [slot]: text } }));
      } else {
        setPlannerDraft((prev) => ({ ...prev, [slot]: auraRef.current.plannerSlots[slot] || "" }));
      }
      setPlannerEdit((prev) => ({ ...prev, [slot]: !editing }));
    },
    [commit, plannerDraft, plannerEdit],
  );

  // ===== 渲染工具 =====
  const preview = (md: string) => sanitize(marked.parse(md || "") as string);

  const timerMins = Math.floor(aura.pomodoro.remaining / 60);
  const timerSecs = aura.pomodoro.remaining % 60;
  const totalDur = aura.pomodoro.duration * 60;
  const offset = 502.6 * (1 - (totalDur - aura.pomodoro.remaining) / totalDur);

  if (!hydrated) {
    return <div className="flex min-h-screen items-center justify-center bg-[#FAF9F6] text-sm text-neutral-400">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen bg-[#FAF9F6] text-[#1C1C1A] antialiased" style={{ fontFamily: "'Geist','Plus Jakarta Sans',sans-serif" }}>
      <style>{`
        .aura-prose h1 { font-size:1.5rem; font-weight:700; margin-top:1rem; margin-bottom:.5rem; }
        .aura-prose h2 { font-size:1.25rem; font-weight:600; margin-top:.8rem; margin-bottom:.4rem; }
        .aura-prose p { margin-bottom:.6rem; color:#4B5563; line-height:1.6; }
        .aura-prose ul { list-style-type:disc; padding-left:1.25rem; margin-bottom:.6rem; }
        .aura-prose ol { list-style-type:decimal; padding-left:1.25rem; margin-bottom:.6rem; }
        .aura-prose li { margin-bottom:.25rem; color:#4B5563; }
        .aura-prose code { background-color:#F3F4F6; padding:.1rem .3rem; border-radius:.25rem; font-size:.875rem; }
        .aura-prose blockquote { border-left:3px solid #D1D5DB; padding-left:.75rem; color:#6B7280; font-style:italic; }
        .aura-scroll::-webkit-scrollbar { width:4px; height:4px; }
        .aura-scroll::-webkit-scrollbar-thumb { background:#EAEAE2; border-radius:10px; }
      `}</style>
      <link
        rel="stylesheet"
        precedence="default"
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      />
      <Script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js" strategy="afterInteractive" />
      <Script src="/shared/sync-client.js" strategy="afterInteractive" />
      <Script src="/shared/sync-widget.js" strategy="afterInteractive" />
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&family=Geist:wght@100..900&display=swap"
      />

      <aside
        className="relative flex shrink-0 flex-col justify-between border-r border-neutral-200/60 bg-white"
        style={{ width: collapsed ? 60 : 256, minWidth: 60, transition: "all .3s cubic-bezier(.16,1,.3,1)" }}
      >
        <div>
          <div className="p-6 pb-4">
            <div className="flex items-center space-x-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 font-serif text-xs font-bold tracking-widest text-white">
                A
              </div>
              {!collapsed && (
                <div>
                  <h1 className="font-serif text-base font-bold tracking-tight text-neutral-800">Aura</h1>
                  <p className="font-sans text-xs text-neutral-400">{d.sidebarSubtitle}</p>
                </div>
              )}
            </div>
          </div>
          <nav className="space-y-1.5 px-3 py-4">
            {d.navTabs.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => switchMain(index)}
                className={`flex w-full items-center space-x-3 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                  mainTab === index ? "bg-neutral-100 text-neutral-800" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
                } ${collapsed ? "justify-center !px-0" : ""}`}
              >
                <i className={`${NAV_ICONS[index]} text-sm`} />
                {!collapsed && <span>{label}</span>}
              </button>
            ))}
          </nav>
        </div>

        {!collapsed && (
          <div className="border-t border-neutral-100 p-6">
            <div className="rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
              <div className="mb-1 flex items-center space-x-2 text-xs text-neutral-400">
                <i className="fa-regular fa-calendar" />
                <span>{new Date().toLocaleDateString(lang === "cn" ? "zh-CN" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
              </div>
              <div className="text-xs font-medium text-neutral-500">{quote}</div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="absolute -right-3 top-1/2 z-50 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs text-neutral-400 shadow-sm transition-all hover:bg-neutral-50 hover:text-neutral-800"
        >
          <i className={`fa-solid ${collapsed ? "fa-chevron-right" : "fa-chevron-left"}`} />
        </button>
      </aside>

      <main className="flex max-h-screen min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-b border-neutral-200/60 bg-white/50 px-6 backdrop-blur-md">
          <div className="flex items-center space-x-3">
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{d.navTabs[mainTab]}</span>
            <span className="text-xs text-neutral-300">|</span>
            <span className="font-mono text-xs text-neutral-500">{clock}</span>
          </div>
          <div className="flex items-center space-x-2">
            {d.subTabs[mainTab].map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => switchSub(index)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  subTab === index ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={toggleLang}
              className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-all hover:bg-neutral-200"
            >
              {d.langBtn}
            </button>
            <div className="flex items-center space-x-1.5 text-xs text-emerald-600">
              <i className="fa-solid fa-circle-check" />
              <span>{saving ? d.saving : d.saveOk}</span>
            </div>
          </div>
        </header>

        <div className="flex-1 p-6 md:p-8">
          {/* 工作台 / 专注 */}
          {mainTab === 0 && subTab === 0 && (
            <div className="space-y-8">
              <div>
                <h2 className="font-serif text-2xl font-bold tracking-tight text-neutral-800">{d.greeting}</h2>
                <p className="mt-1 text-sm text-neutral-400">{d.greetingSub}</p>
              </div>
              <div className="mx-auto max-w-md rounded-3xl border border-neutral-200/60 bg-white p-8 shadow-[0_2px_12px_-1px_rgba(0,0,0,0.03),0_8px_30px_-4px_rgba(0,0,0,0.04)]">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">{d.focusLabel}</span>
                  <div className="flex items-center space-x-1 text-xs font-medium text-amber-600">
                    <i className="fa-solid fa-fire" />
                    <span>
                      {d.streakLabel}: {aura.pomodoro.streak} {d.streakUnit}
                    </span>
                  </div>
                </div>
                <div className="relative mx-auto my-6 flex h-44 w-44 items-center justify-center">
                  <svg className="h-full w-full -rotate-90 transform">
                    <circle cx="88" cy="88" r="80" stroke="#FAF9F6" strokeWidth="8" fill="transparent" />
                    <circle
                      cx="88"
                      cy="88"
                      r="80"
                      stroke="#1C1C1A"
                      strokeWidth="8"
                      fill="transparent"
                      strokeDasharray="502.6"
                      strokeDashoffset={offset}
                      className="transition-all duration-300 ease-linear"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-mono text-4xl font-bold tracking-tight text-neutral-800">
                      {String(timerMins).padStart(2, "0")}:{String(timerSecs).padStart(2, "0")}
                    </span>
                    <span className="mt-1 text-[10px] uppercase tracking-widest text-neutral-400">{aura.pomodoro.state}</span>
                  </div>
                </div>
                <div className="flex items-center justify-center space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      playSound("click");
                      commit((prev) => ({ ...prev, pomodoro: { ...prev.pomodoro, isRunning: !prev.pomodoro.isRunning } }), {
                        silent: true,
                      });
                    }}
                    className="rounded-xl bg-neutral-800 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:scale-105 hover:bg-neutral-900 active:scale-95"
                  >
                    {aura.pomodoro.isRunning ? (
                      <>
                        <i className="fa-solid fa-pause mr-1.5" /> {d.pause}
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-play mr-1.5" />{" "}
                        {aura.pomodoro.remaining < totalDur ? d.resumeFocus : d.startFocus}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      playSound("click");
                      commit((prev) => ({
                        ...prev,
                        pomodoro: { ...prev.pomodoro, isRunning: false, remaining: prev.pomodoro.duration * 60 },
                      }), { silent: true });
                    }}
                    className="rounded-xl bg-neutral-100 p-2.5 text-xs text-neutral-600 transition-all hover:bg-neutral-200"
                  >
                    <i className="fa-solid fa-arrow-rotate-left" />
                  </button>
                </div>
                <div className="mt-6 flex justify-between gap-1.5 border-t border-neutral-100 pt-4">
                  {[
                    [25, "Focus", d.preset25],
                    [5, "Short Break", d.preset5],
                    [15, "Long Break", d.preset15],
                  ].map(([minutes, name, label]) => (
                    <button
                      key={String(name)}
                      type="button"
                      onClick={() => {
                        playSound("click");
                        commit((prev) => ({
                          ...prev,
                          pomodoro: {
                            ...prev.pomodoro,
                            isRunning: false,
                            duration: minutes as number,
                            remaining: (minutes as number) * 60,
                            state: name as string,
                          },
                        }), { silent: true });
                      }}
                      className="flex-1 rounded-lg bg-neutral-50 py-1.5 text-center text-[11px] font-medium text-neutral-600 transition hover:bg-neutral-100"
                    >
                      {label as string}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 工作台 / 剪贴板 */}
          {mainTab === 0 && subTab === 1 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">{d.clipTitle}</span>
                  <h3 className="text-sm font-semibold text-neutral-800">{d.clipSub}</h3>
                </div>
                <button
                  type="button"
                  onClick={addBoard}
                  className="flex items-center space-x-1 rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition-all hover:bg-neutral-50"
                >
                  <i className="fa-solid fa-plus text-[10px]" />
                  <span>{d.addBoard}</span>
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {aura.clipboards.map((board) => (
                  <div
                    key={board.id}
                    className={`group relative flex min-h-[190px] flex-col justify-between rounded-2xl border p-5 shadow-sm transition-all hover:shadow-md ${board.color || "border-neutral-200/60 bg-white"}`}
                  >
                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <input
                          type="text"
                          value={board.title}
                          onChange={(e) => updateBoard(board.id, { title: e.target.value })}
                          className="w-3/4 rounded border-none bg-transparent px-1 text-xs font-semibold text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                        />
                        <div className="flex space-x-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            title="Copy"
                            onClick={() => {
                              if (board.content) {
                                navigator.clipboard.writeText(board.content).then(() => playSound("success"));
                              }
                            }}
                            className="p-1 text-neutral-400 transition hover:text-neutral-800"
                          >
                            <i className="fa-regular fa-copy text-xs" />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => {
                              playSound("click");
                              commit((prev) => ({ ...prev, clipboards: prev.clipboards.filter((b) => b.id !== board.id) }));
                            }}
                            className="p-1 text-neutral-400 transition hover:text-rose-600"
                          >
                            <i className="fa-regular fa-trash-can text-xs" />
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={board.content}
                        onChange={(e) => updateBoard(board.id, { content: e.target.value })}
                        placeholder={d.boardPlaceholder}
                        className="h-24 w-full resize-none border-none bg-transparent p-0 font-sans text-xs text-neutral-600 focus:outline-none focus:ring-0"
                      />
                    </div>
                    <div className="flex items-center justify-between border-t border-black/5 pt-2">
                      <span className="text-[10px] text-neutral-400">#{board.id}</span>
                      <div className="flex space-x-1">
                        {[
                          ["bg-amber-50/60 border-amber-100", "bg-amber-200"],
                          ["bg-indigo-50/60 border-indigo-100", "bg-indigo-200"],
                          ["bg-emerald-50/60 border-emerald-100", "bg-emerald-200"],
                          ["bg-rose-50/60 border-rose-100", "bg-rose-200"],
                        ].map(([color, dot]) => (
                          <span
                            key={color}
                            onClick={() => {
                              playSound("tick");
                              updateBoard(board.id, { color });
                            }}
                            className={`h-2.5 w-2.5 cursor-pointer rounded-full transition hover:scale-125 ${dot}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 日志 / 身心指标 */}
          {mainTab === 1 && subTab === 0 && (
            <div className="space-y-6">
              <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="font-serif text-2xl font-bold tracking-tight text-neutral-800">{d.logTitle}</h2>
                  <p className="mt-1 text-sm text-neutral-400">{d.logSub}</p>
                </div>
                <DateNav value={logDate} onChange={setLogDate} prev={d.prevDay} next={d.nextDay} />
              </div>
              <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-[0_2px_12px_-1px_rgba(0,0,0,0.03),0_8px_30px_-4px_rgba(0,0,0,0.04)]">
                <span className="mb-4 block text-xs font-bold uppercase tracking-wider text-neutral-400">{d.pulseTitle}</span>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  {[
                    [d.focusMetric, "focus"],
                    [d.energyMetric, "energy"],
                    [d.moodMetric, "mood"],
                  ].map(([label, key]) => (
                    <div key={String(key)}>
                      <div className="mb-2 flex justify-between text-xs font-medium text-neutral-600">
                        <span>{label as string}</span>
                        <span>{logData[key as "focus"]}/10</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={logData[key as "focus"]}
                        onChange={(e) =>
                          commit((prev) => {
                            const day = prev.dailyLogs[logDate] || { focus: 5, energy: 5, mood: 5, entries: [] };
                            return {
                              ...prev,
                              dailyLogs: { ...prev.dailyLogs, [logDate]: { ...day, [key as string]: Number(e.target.value) } },
                            };
                          })
                        }
                        className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-neutral-100 accent-neutral-800"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 日志 / 记录 */}
          {mainTab === 1 && subTab === 1 && (
            <div className="space-y-6">
              <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="font-serif text-xl font-bold tracking-tight text-neutral-800">{d.logTitle}</h2>
                  <p className="mt-1 text-sm text-neutral-400">{logDate}</p>
                </div>
                <DateNav compact value={logDate} onChange={setLogDate} prev={d.prevDay} next={d.nextDay} />
              </div>
              <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-[0_2px_12px_-1px_rgba(0,0,0,0.03),0_8px_30px_-4px_rgba(0,0,0,0.04)]">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-neutral-500">{d.logTopicLabel}</span>
                  {aura.logTopics.map((topic) => (
                    <span
                      key={topic}
                      onClick={() => {
                        commit((prev) => ({ ...prev, currentLogTopic: topic }));
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        removeTopic(topic);
                      }}
                      className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                        topic === aura.currentLogTopic ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                      }`}
                    >
                      {topic}
                    </span>
                  ))}
                  <span className="inline-flex items-center">
                    <input
                      type="text"
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addTopic()}
                      placeholder={d.addTopicPlaceholder}
                      className="w-20 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs transition-all focus:w-28 focus:outline-none"
                    />
                    <button type="button" onClick={addTopic} className="ml-1 text-xs text-neutral-400 hover:text-neutral-800">
                      <i className="fa-solid fa-plus" />
                    </button>
                  </span>
                </div>
                <div className="mb-4 flex items-center space-x-2">
                  <input
                    ref={logInputRef}
                    type="text"
                    value={logInput}
                    onChange={(e) => setLogInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === "Enter") addLogEntry();
                    }}
                    placeholder={d.logInputPlaceholder}
                    className="flex-1 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-2.5 text-xs transition focus:bg-white focus:outline-none focus:ring-1 focus:ring-neutral-200"
                  />
                  <button
                    type="button"
                    onClick={addLogEntry}
                    className="rounded-xl bg-neutral-800 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-neutral-900"
                  >
                    <i className="fa-solid fa-plus mr-1" />
                    Ctrl+Enter
                  </button>
                </div>
                <div className="aura-scroll max-h-[400px] space-y-2 overflow-y-auto pr-1">
                  {(logData.entries || []).length === 0 ? (
                    <div className="py-8 text-center text-xs italic text-neutral-400">{d.noLogs}</div>
                  ) : (
                    logData.entries
                      .slice()
                      .reverse()
                      .map((entry, idx) => {
                        const realIdx = logData.entries.length - 1 - idx;
                        return (
                          <div
                            key={`${entry.time}-${realIdx}`}
                            className="flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 p-3 text-xs transition-all hover:bg-neutral-100/50"
                          >
                            <div className="flex flex-1 items-center space-x-2">
                              <span className="shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                                {entry.topic}
                              </span>
                              <span className="text-neutral-700">{entry.text}</span>
                            </div>
                            <div className="flex shrink-0 items-center space-x-2">
                              <span className="text-[10px] text-neutral-400">{entry.time || ""}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  playSound("click");
                                  commit((prev) => {
                                    const day = prev.dailyLogs[logDate] || { focus: 5, energy: 5, mood: 5, entries: [] };
                                    const entries = [...(day.entries || [])];
                                    entries.splice(realIdx, 1);
                                    return { ...prev, dailyLogs: { ...prev.dailyLogs, [logDate]: { ...day, entries } } };
                                  });
                                }}
                                className="text-neutral-300 transition hover:text-rose-500"
                              >
                                <i className="fa-regular fa-trash-can text-[11px]" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 指引 / 全局战略 + 本周聚焦 */}
          {mainTab === 2 && subTab < 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-xl font-bold tracking-tight text-neutral-800">
                  {subTab === 0 ? d.globalGuide : d.weeklyFocus}
                </h2>
                <button
                  type="button"
                  onClick={() => togglePlanner(subTab + 1)}
                  className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium transition-all hover:bg-neutral-50"
                >
                  <i className="fa-solid fa-pen-to-square mr-1" />
                  <span>{plannerEdit[subTab + 1] ? d.preview : d.edit}</span>
                </button>
              </div>
              <div className="flex min-h-[450px] flex-col rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-[0_2px_12px_-1px_rgba(0,0,0,0.03),0_8px_30px_-4px_rgba(0,0,0,0.04)]">
                {plannerEdit[subTab + 1] ? (
                  <textarea
                    value={plannerDraft[subTab + 1] ?? aura.plannerSlots[subTab + 1] ?? ""}
                    onChange={(e) => setPlannerDraft((prev) => ({ ...prev, [subTab + 1]: e.target.value }))}
                    placeholder="# Write in Markdown..."
                    className="w-full flex-1 resize-none rounded-xl border border-neutral-100 bg-neutral-50 p-3 font-mono text-xs transition focus:bg-white focus:outline-none"
                  />
                ) : (
                  <div
                    className="aura-prose flex-1 overflow-y-auto text-xs"
                    dangerouslySetInnerHTML={{ __html: preview(aura.plannerSlots[subTab + 1] || "") }}
                  />
                )}
              </div>
            </div>
          )}

          {/* 指引 / 时间流 */}
          {mainTab === 2 && subTab === 2 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-xl font-bold tracking-tight text-neutral-800">{d.dailyFlow}</h2>
                <button
                  type="button"
                  onClick={() => {
                    playSound("click");
                    commit((prev) => ({ ...prev, timeline: [] }));
                  }}
                  className="text-xs text-neutral-400 transition hover:text-rose-500"
                >
                  <i className="fa-regular fa-trash-can mr-1" />
                  {d.clearTimeline}
                </button>
              </div>
              <div className="aura-scroll max-h-[500px] space-y-3 overflow-y-auto rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-[0_2px_12px_-1px_rgba(0,0,0,0.03),0_8px_30px_-4px_rgba(0,0,0,0.04)]">
                {aura.timeline.map((slot, idx) => (
                  <div
                    key={`${slot.hour}-${idx}`}
                    className={`group flex cursor-pointer items-center justify-between rounded-2xl p-4 transition-all ${
                      slot.active ? "bg-neutral-800 text-white" : "border border-neutral-100 bg-neutral-50 text-neutral-800 hover:bg-neutral-100/70"
                    }`}
                  >
                    <div
                      className="flex flex-1 items-center space-x-3"
                      onClick={() => {
                        playSound("tick");
                        commit((prev) => ({
                          ...prev,
                          timeline: prev.timeline.map((s, i) => (i === idx ? { ...s, active: !s.active } : s)),
                        }));
                      }}
                    >
                      <span className={`shrink-0 font-mono text-[10px] font-semibold tracking-tight ${slot.active ? "text-neutral-400" : "text-neutral-500"}`}>
                        {slot.hour}
                      </span>
                      <span className="text-xs text-neutral-300">|</span>
                      <input
                        type="text"
                        value={slot.task}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          commit((prev) => ({
                            ...prev,
                            timeline: prev.timeline.map((s, i) => (i === idx ? { ...s, task: e.target.value } : s)),
                          }), { silent: true })
                        }
                        className="w-full border-none bg-transparent p-0 text-xs font-medium focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        playSound("click");
                        commit((prev) => ({ ...prev, timeline: prev.timeline.filter((_, i) => i !== idx) }));
                      }}
                      className="p-1 text-neutral-400 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
                    >
                      <i className="fa-solid fa-xmark text-xs" />
                    </button>
                  </div>
                ))}
                <div
                  onClick={() => {
                    playSound("click");
                    const now = new Date();
                    const start = `${String(now.getHours()).padStart(2, "0")}:00`;
                    const end = `${String((now.getHours() + 1) % 24).padStart(2, "0")}:00`;
                    commit((prev) => ({ ...prev, timeline: [...prev.timeline, { hour: `${start} - ${end}`, task: "New task", active: false }] }));
                  }}
                  className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed border-neutral-200 p-3 text-xs text-neutral-400 transition hover:border-neutral-800 hover:text-neutral-800"
                >
                  <i className="fa-solid fa-plus mr-1.5" />
                  {d.addSlot}
                </div>
              </div>
            </div>
          )}

          {/* 开坑 / 信息暂存 */}
          {mainTab === 3 && subTab === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-serif text-xl font-bold tracking-tight text-neutral-800">{d.inboxTitle}</h2>
                <p className="mt-1 text-sm text-neutral-400">{d.inboxSub}</p>
              </div>
              <div className="rounded-3xl border border-neutral-200/60 bg-white p-6 shadow-[0_2px_12px_-1px_rgba(0,0,0,0.03),0_8px_30px_-4px_rgba(0,0,0,0.04)]">
                <div className="mb-6 space-y-3 rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input
                      type="text"
                      value={inbox.title}
                      onChange={(e) => setInbox((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder={d.inboxTitleInput}
                      className="rounded-xl border border-neutral-200/60 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-400"
                    />
                    <input
                      type="text"
                      value={inbox.link}
                      onChange={(e) => setInbox((prev) => ({ ...prev, link: e.target.value }))}
                      placeholder={d.inboxLinkInput}
                      className="rounded-xl border border-neutral-200/60 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-400"
                    />
                  </div>
                  <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-3">
                    <input
                      type="text"
                      value={inbox.note}
                      onChange={(e) => setInbox((prev) => ({ ...prev, note: e.target.value }))}
                      placeholder={d.inboxNoteInput}
                      className="rounded-xl border border-neutral-200/60 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-neutral-400 md:col-span-2"
                    />
                    <select
                      value={inbox.priority}
                      onChange={(e) => setInbox((prev) => ({ ...prev, priority: e.target.value as InboxItem["priority"] }))}
                      className="rounded-xl border border-neutral-200/60 bg-white px-3 py-2 text-xs text-neutral-600 focus:outline-none"
                    >
                      <option value="high">{d.priorityHigh}</option>
                      <option value="normal">{d.priorityNormal}</option>
                      <option value="low">{d.priorityLow}</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={addInbox}
                    className="w-full rounded-xl bg-neutral-800 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-neutral-900"
                  >
                    <i className="fa-solid fa-paper-plane mr-1.5" />
                    {d.addToInbox}
                  </button>
                </div>
                <div className="aura-scroll max-h-[350px] space-y-3 overflow-y-auto pr-1">
                  {aura.inboxItems.length === 0 ? (
                    <div className="py-8 text-center text-xs italic text-neutral-400">{d.emptyInbox}</div>
                  ) : (
                    aura.inboxItems.map((item, idx) => {
                      const badge =
                        item.priority === "high"
                          ? "bg-rose-50 text-rose-600"
                          : item.priority === "normal"
                            ? "bg-amber-50 text-amber-600"
                            : "bg-sky-50 text-sky-600";
                      const prio = item.priority === "high" ? d.priorityHigh : item.priority === "normal" ? d.priorityNormal : d.priorityLow;
                      return (
                        <div
                          key={item.id}
                          className={`flex flex-col space-y-2 rounded-2xl border border-neutral-100 bg-neutral-50/70 p-4 transition-all ${item.done ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <div className="flex items-center space-x-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge}`}>{prio}</span>
                                {item.link ? (
                                  <a href={item.link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-neutral-800 hover:underline">
                                    {item.title} <i className="fa-solid fa-up-right-from-square text-[9px] text-neutral-400" />
                                  </a>
                                ) : (
                                  <span className="text-xs font-semibold text-neutral-800">{item.title}</span>
                                )}
                              </div>
                              <p className="text-[11px] text-neutral-500">{item.note || ""}</p>
                            </div>
                            <div className="flex shrink-0 space-x-1">
                              <button
                                type="button"
                                onClick={() => {
                                  playSound("success");
                                  commit((prev) => ({
                                    ...prev,
                                    inboxItems: prev.inboxItems.map((x, i) => (i === idx ? { ...x, done: !x.done } : x)),
                                  }));
                                }}
                                className={`p-1.5 transition ${item.done ? "text-emerald-500" : "text-neutral-300 hover:text-emerald-500"}`}
                              >
                                <i className="fa-solid fa-check-circle text-sm" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  playSound("click");
                                  commit((prev) => ({ ...prev, inboxItems: prev.inboxItems.filter((_, i) => i !== idx) }));
                                }}
                                className="p-1.5 text-neutral-300 transition hover:text-rose-500"
                              >
                                <i className="fa-regular fa-trash-can text-sm" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 开坑 / 知识坑 */}
          {mainTab === 3 && subTab === 1 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-xl font-bold tracking-tight text-neutral-800">{d.pitsTitle}</h2>
                  <p className="mt-1 text-sm text-neutral-400">{d.pitsSub}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    playSound("click");
                    setPitFormOpen(true);
                  }}
                  className="flex items-center space-x-1 rounded-xl border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
                >
                  <i className="fa-solid fa-compass-drafting text-[10px]" />
                  <span>{d.newPit}</span>
                </button>
              </div>

              {pitFormOpen && (
                <div className="space-y-3 rounded-2xl border border-neutral-100 bg-neutral-50 p-4">
                  <input
                    type="text"
                    value={pitForm.name}
                    onChange={(e) => setPitForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder={d.pitNamePlaceholder}
                    className="w-full rounded-xl border border-neutral-200/60 bg-white px-3 py-2 text-xs focus:outline-none"
                  />
                  <input
                    type="text"
                    value={pitForm.milestones}
                    onChange={(e) => setPitForm((prev) => ({ ...prev, milestones: e.target.value }))}
                    placeholder={d.pitMilestonePlaceholder}
                    className="w-full rounded-xl border border-neutral-200/60 bg-white px-3 py-2 text-xs focus:outline-none"
                  />
                  <div className="flex justify-end space-x-2">
                    <button
                      type="button"
                      onClick={() => setPitFormOpen(false)}
                      className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100"
                    >
                      {d.pitCancel}
                    </button>
                    <button
                      type="button"
                      onClick={createPit}
                      className="rounded-lg bg-neutral-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-neutral-900"
                    >
                      {d.pitCreate}
                    </button>
                  </div>
                </div>
              )}

              <div className="aura-scroll max-h-[500px] space-y-4 overflow-y-auto pr-1">
                {aura.pits.length === 0 ? (
                  <div className="py-8 text-center text-xs italic text-neutral-400">{d.noPits}</div>
                ) : (
                  aura.pits.map((pit, pitIdx) => {
                    const total = pit.milestones.length;
                    const completed = pit.milestones.filter((m) => m.done).length;
                    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                    return (
                      <div key={pit.id} className="space-y-4 rounded-2xl border border-neutral-100 bg-neutral-50/50 p-5 shadow-sm">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="text-xs font-bold text-neutral-800">{pit.name}</h4>
                            <div className="mt-1 flex items-center space-x-2">
                              <div className="h-1 w-24 overflow-hidden rounded-full bg-neutral-200">
                                <div className="h-full bg-neutral-800" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[9px] font-semibold text-neutral-400">
                                {pct}% {d.achieved}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              playSound("click");
                              commit((prev) => ({ ...prev, pits: prev.pits.filter((_, i) => i !== pitIdx) }));
                            }}
                            className="text-xs text-neutral-400 transition hover:text-rose-500"
                          >
                            <i className="fa-solid fa-xmark" />
                          </button>
                        </div>
                        <div className="space-y-1.5 pl-1">
                          {pit.milestones.map((stone, stoneIdx) => (
                            <label key={`${stone.label}-${stoneIdx}`} className="flex cursor-pointer select-none items-center space-x-2 text-xs text-neutral-600">
                              <input
                                type="checkbox"
                                checked={stone.done}
                                onChange={() => toggleMilestone(pitIdx, stoneIdx)}
                                className="rounded border-neutral-300 text-neutral-800 focus:ring-0"
                              />
                              <span className={stone.done ? "text-neutral-400 line-through" : ""}>{stone.label}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center space-x-2 border-t border-dashed border-neutral-200/60 pt-2">
                          <input
                            type="text"
                            value={milestoneDraft[pitIdx] || ""}
                            onChange={(e) => setMilestoneDraft((prev) => ({ ...prev, [pitIdx]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && addMilestone(pitIdx)}
                            placeholder={d.pitStepPlaceholder}
                            className="flex-1 rounded-lg border border-neutral-200/50 bg-white px-3 py-1 text-[10px] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => addMilestone(pitIdx)}
                            className="rounded-lg bg-neutral-800 px-2.5 py-1 text-[10px] text-white"
                          >
                            {d.pitAddStep}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex h-8 shrink-0 items-center space-x-4 border-t border-neutral-100 bg-white/80 px-6 text-[10px] text-neutral-400">
          <span>
            Ctrl+1~4 <span>{d.hintSwitch}</span>
          </span>
          <span>
            Ctrl+B <span>{d.hintSidebar}</span>
          </span>
          <span>
            Ctrl+L <span>{d.hintLog}</span>
          </span>
          <span>
            Ctrl+Enter <span>{d.hintSubmit}</span>
          </span>
        </div>
      </main>
    </div>
  );
}

function DateNav({
  value,
  onChange,
  prev,
  next,
  compact,
}: {
  value: string;
  onChange: (value: string) => void;
  prev: string;
  next: string;
  compact?: boolean;
}) {
  const shift = (offset: number) => {
    playSound("click");
    const date = new Date(value);
    date.setDate(date.getDate() + offset);
    onChange(todayString(date));
  };
  return (
    <div className="flex items-center space-x-2">
      <button
        type="button"
        onClick={() => shift(-1)}
        className="rounded-xl border border-neutral-200 bg-white p-2 text-xs text-neutral-600 transition hover:bg-neutral-50"
      >
        <i className="fa-solid fa-chevron-left" /> {compact ? "" : prev}
      </button>
      <span className={`rounded-xl border border-neutral-200 bg-white px-4 py-2 font-medium text-neutral-700 ${compact ? "text-xs" : "text-sm"}`}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => shift(1)}
        className="rounded-xl border border-neutral-200 bg-white p-2 text-xs text-neutral-600 transition hover:bg-neutral-50"
      >
        {compact ? "" : next} <i className="fa-solid fa-chevron-right" />
      </button>
    </div>
  );
}
