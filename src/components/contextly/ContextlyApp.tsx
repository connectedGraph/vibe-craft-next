"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addCard,
  applyRemoteChanges,
  dailyQueue,
  deleteCard,
  EMPTY_CARD,
  loadData,
  rateCard,
  saveSettings,
  splitHighlight,
  updateCard,
  type Card,
  type StoreData,
} from "@/lib/tools/contextly";

type View = "home" | "library" | "editor" | "settings" | "study-setup" | "study-session";

type CardForm = Pick<Card, "term" | "sentence" | "preContext" | "postContext" | "definition">;

const EMPTY_FORM: CardForm = { ...EMPTY_CARD };

const DEMO_CARD: CardForm = {
  term: "epiphany",
  sentence: "It was a sudden epiphany that changed his life path forever.",
  preContext: "He had been struggling with the problem for years without a solution.",
  postContext: "From that moment on, he knew exactly what he needed to do.",
  definition: "n. 顿悟，突然的感悟; (神灵的)显现",
};

async function callDeepSeek(key: string, messages: { role: string; content: string }[], system = "") {
  if (!key) throw new Error("Missing API Key. Please set it in Settings.");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
      temperature: 0.7,
      max_tokens: 2000,
      stream: false,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || "API Request Failed");
  }
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || "") as string;
}

async function smartFill(key: string, term: string): Promise<CardForm> {
  const system = `You are an expert English language tutor.
Your task is to create a high-quality flashcard for a given English term.
Return ONLY a raw JSON object (no markdown code blocks) with the following structure:
{
    "sentence": "A clear, exemplary English sentence using the term.",
    "preContext": "One sentence describing the situation BEFORE the target sentence.",
    "postContext": "One sentence describing the outcome or situation AFTER the target sentence.",
    "definition": "A concise definition in Simplified Chinese (CN), including part of speech."
}`;
  const result = await callDeepSeek(key, [{ role: "user", content: `Create a flashcard for the term: "${term}"` }], system);
  const clean = result.replace(/```json|```/g, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return {
      term,
      sentence: parsed.sentence || "",
      preContext: parsed.preContext || "",
      postContext: parsed.postContext || "",
      definition: parsed.definition || "",
    };
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        term,
        sentence: parsed.sentence || "",
        preContext: parsed.preContext || "",
        postContext: parsed.postContext || "",
        definition: parsed.definition || "",
      };
    }
    throw new Error("Failed to parse AI response as JSON");
  }
}

export default function ContextlyApp() {
  const [data, setData] = useState<StoreData>({ settings: {}, cards: [] });
  const [view, setView] = useState<View>("home");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CardForm>(EMPTY_FORM);
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [session, setSession] = useState<{ mode: "plan" | "free"; queue: Card[]; index: number; flipped: boolean }>({
    mode: "plan",
    queue: [],
    index: 0,
    flipped: false,
  });
  const [mnemonics, setMnemonics] = useState<Record<string, string>>({});
  const mountedSync = useRef(false);

  const refresh = useCallback(() => setData(loadData()), []);

  // 首次加载：空库时补一张演示卡（与旧版 init 行为一致）
  useEffect(() => {
    const initial = loadData();
    if (initial.cards.length === 0) {
      addCard(DEMO_CARD);
      setData(loadData());
    } else {
      setData(initial);
    }
  }, []);

  // 云端回调会写 localStorage，这里跟本地事件同步
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("contextly:change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("contextly:change", handler);
      window.removeEventListener("storage", handler);
    };
  }, [refresh]);

  // 挂载公共同步挂件（仍是 public/shared 里那份 vanilla 脚本）
  useEffect(() => {
    if (mountedSync.current) return;
    let cancelled = false;
    let tries = 0;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      const widget = (window as unknown as { SyncWidget?: { mount: (opts: unknown) => void } }).SyncWidget;
      if (widget) {
        window.clearInterval(timer);
        mountedSync.current = true;
        widget.mount({
          app: "contextly",
          collections: {
            cards: {
              read: () => loadData().cards,
              getId: (c: Card) => c.id,
              getUpdatedAt: (c: Card) => Number(c.updatedAt) || Number(c.created) || 0,
              applyChanges: (changes: { id: string; op?: string; data?: Partial<Card>; updatedAt?: number }[]) => {
                const changed = applyRemoteChanges(changes);
                if (changed) refresh();
                return changed;
              },
            },
          },
          onApplied: () => {
            refresh();
            setView((current) => (["home", "library", "settings"].includes(current) ? current : "home"));
          },
        });
      } else if (++tries > 40) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const cards = data.cards;
  const stats = cards.length;
  const dueCount = useMemo(() => dailyQueue(cards).length, [cards]);
  const apiKey = data.settings?.apiKey || "";

  const openEditor = useCallback((card?: Card) => {
    if (card) {
      setEditingId(card.id);
      setForm({
        term: card.term,
        sentence: card.sentence,
        preContext: card.preContext,
        postContext: card.postContext,
        definition: card.definition,
      });
    } else {
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
    setView("editor");
  }, []);

  const startSession = useCallback(
    (mode: "plan" | "free") => {
      const all = loadData().cards;
      const queue = mode === "plan" ? dailyQueue(all) : [...all].sort(() => 0.5 - Math.random());
      if (mode === "free") queue.forEach((c) => (c._isFreeReview = true));
      setSession({ mode, queue, index: 0, flipped: false });
      setView("study-session");
    },
    [],
  );

  const submitCard = useCallback(() => {
    const term = form.term.trim();
    const sentence = form.sentence.trim();
    if (!term || !sentence) {
      window.alert("Word and Sentence are required.");
      return;
    }
    const payload = {
      term,
      sentence,
      preContext: form.preContext.trim(),
      postContext: form.postContext.trim(),
      definition: form.definition.trim(),
    };
    if (editingId) {
      const old = loadData().cards.find((c) => c.id === editingId);
      if (old) updateCard({ ...old, ...payload });
    } else {
      addCard(payload);
    }
    refresh();
    setView("library");
  }, [editingId, form, refresh]);

  const removeCard = useCallback(
    (id: string) => {
      if (!window.confirm("Delete this card?")) return;
      deleteCard(id);
      refresh();
      setView("library");
    },
    [refresh],
  );

  const runSmartFill = useCallback(async () => {
    const term = form.term.trim();
    if (!term) {
      window.alert("Please enter a word first.");
      return;
    }
    setAiBusy(true);
    try {
      const filled = await smartFill(apiKey, term);
      setForm((prev) => ({ ...prev, ...filled }));
    } catch (e) {
      window.alert(`AI Error: ${(e as Error).message}\nMake sure you have set a valid API Key in Settings.`);
    } finally {
      setAiBusy(false);
    }
  }, [apiKey, form.term]);

  const showMnemonic = useCallback(
    async (card: Card) => {
      if (mnemonics[card.id]) return;
      setMnemonics((prev) => ({ ...prev, [card.id]: "✨ Dreaming up a mnemonic..." }));
      try {
        const text = await callDeepSeek(
          apiKey,
          [
            {
              role: "user",
              content: `Give me a short, memorable mnemonic (memory aid) for the English word "${card.term}" which means "${card.definition}".
                It can be an English association, a Chinese harmonic (谐音), or a logic bridge. Keep it under 30 words. Output plain text only.`,
            },
          ],
          "You are a creative memory expert.",
        );
        setMnemonics((prev) => ({ ...prev, [card.id]: text }));
      } catch {
        setMnemonics((prev) => ({ ...prev, [card.id]: "Error: Please check API Key in settings." }));
      }
    },
    [apiKey, mnemonics],
  );

  const flipCard = useCallback(() => setSession((s) => ({ ...s, flipped: true })), []);

  const submitRating = useCallback(
    (rating: 1 | 2 | 3 | 4) => {
      const card = session.queue[session.index];
      if (!card) return;
      updateCard(rateCard(card, rating));
      refresh();
      setSession((s) => ({ ...s, index: s.index + 1, flipped: false }));
    },
    [refresh, session.index, session.queue],
  );

  const currentCard = session.queue[session.index];
  const done = session.index >= session.queue.length;

  return (
    <div
      className="flex h-[100dvh] w-full items-center justify-center overflow-hidden p-3 sm:p-4"
      style={{ background: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)", fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <style>{`
        .ctx-scroll::-webkit-scrollbar { width: 4px; }
        .ctx-scroll::-webkit-scrollbar-track { background: transparent; }
        .ctx-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 10px; }
        .ctx-glass { background: rgba(255,255,255,0.25); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255,255,255,0.5); box-shadow: 0 8px 32px 0 rgba(31,38,135,0.15); }
        .ctx-highlight { background: linear-gradient(120deg, rgba(253,224,71,0.6) 0%, rgba(253,224,71,0) 100%);
          background-repeat: no-repeat; background-size: 100% 40%; background-position: 0 88%;
          padding: 0 2px; font-weight: 600; color: #000; }
        .ctx-fade { animation: ctxFade 0.3s ease-out forwards; }
        .ctx-slide { animation: ctxSlide 0.4s ease-out forwards; }
        @keyframes ctxFade { 0% { opacity: 0 } 100% { opacity: 1 } }
        @keyframes ctxSlide { 0% { opacity: 0; transform: translateY(20px) } 100% { opacity: 1; transform: translateY(0) } }
        .ctx-spinner { border: 3px solid rgba(255,255,255,0.3); border-top-color: #4f46e5; border-radius: 50%;
          animation: ctxSpin 1s linear infinite; }
        @keyframes ctxSpin { to { transform: rotate(360deg) } }
      `}</style>
      <Script src="https://unpkg.com/@phosphor-icons/web" strategy="afterInteractive" />
      <Script src="/shared/sync-client.js" strategy="afterInteractive" />
      <Script src="/shared/sync-widget.js" strategy="afterInteractive" />

      <div className="ctx-glass relative flex h-[calc(100dvh-1.5rem)] max-h-[720px] w-full max-w-[600px] flex-col overflow-hidden rounded-3xl text-gray-800 transition-all duration-300 sm:aspect-square sm:h-auto sm:max-h-none">
        {aiBusy && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/30 backdrop-blur-sm">
            <div className="ctx-spinner mb-2 h-10 w-10" />
            <span className="animate-pulse text-sm font-medium text-indigo-800">Consulting DeepSeek...</span>
          </div>
        )}

        <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/40 px-4 sm:h-16 sm:px-6">
          <button type="button" className="flex cursor-pointer items-center gap-2" onClick={() => setView("home")}>
            <i className="ph ph-cube-transparent text-2xl text-indigo-600" />
            <span className="text-base font-bold tracking-tight sm:text-lg">
              Contextly{" "}
              <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-normal text-indigo-500">AI</span>
            </span>
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                setKeyDraft(loadData().settings?.apiKey || "");
                setView("settings");
              }}
              className="-mr-1 text-gray-600 transition-colors hover:text-indigo-600 max-sm:grid max-sm:h-10 max-sm:w-10 max-sm:place-items-center sm:mr-0"
              title="Settings"
            >
              <i className="ph ph-gear text-2xl" />
            </button>
            {view === "library" && (
              <button
                type="button"
                onClick={() => openEditor()}
                className="flex min-h-10 items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm text-white shadow-md transition-colors hover:bg-indigo-700 sm:min-h-0"
              >
                <i className="ph ph-plus-bold" /> Add
              </button>
            )}
            {view === "editor" && editingId && (
              <button type="button" onClick={() => removeCard(editingId)} className="p-2 text-red-500 hover:text-red-700 max-sm:grid max-sm:h-10 max-sm:w-10 max-sm:place-items-center">
                <i className="ph ph-trash text-xl" />
              </button>
            )}
          </div>
        </header>

        <main className="ctx-scroll relative flex-1 overflow-y-auto p-4 sm:p-6">
          {view === "home" && (
            <div className="ctx-fade flex min-h-full flex-col items-center justify-center gap-6">
              <div className="mb-2 text-center sm:mb-4">
                <h1 className="mb-2 text-2xl font-light text-indigo-900 sm:text-3xl">Hello, Learner.</h1>
                <p className="text-sm text-gray-600">Review your collection or explore new words.</p>
              </div>

              <div className="grid w-full max-w-sm grid-cols-2 gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={() => setView("library")}
                  className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-white/60 bg-white/40 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:bg-white/60 hover:shadow-xl"
                >
                  <i className="ph ph-books text-4xl text-indigo-600 transition-transform group-hover:scale-110" />
                  <span className="font-medium text-gray-700">Library</span>
                  <span className="rounded-full bg-white/50 px-2 py-0.5 text-xs text-gray-500">{stats} cards</span>
                </button>

                <button
                  type="button"
                  onClick={() => setView("study-setup")}
                  className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-white/60 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 shadow-lg transition-all duration-300 hover:-translate-y-1 hover:from-indigo-500/20 hover:to-purple-500/20 hover:shadow-xl"
                >
                  <i className="ph ph-brain text-4xl text-purple-600 transition-transform group-hover:scale-110" />
                  <span className="font-medium text-gray-700">Study</span>
                  <div className="flex items-center gap-1">
                    <span
                      className={`rounded-full bg-white/50 px-2 py-0.5 text-xs ${
                        dueCount > 0 ? "font-bold text-red-500" : "text-green-600"
                      }`}
                    >
                      {dueCount} Due
                    </span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {view === "settings" && (
            <div className="ctx-fade flex h-full flex-col gap-4">
              <h2 className="border-b border-black/5 pb-2 text-xl font-bold text-gray-800">Settings</h2>

              <div className="flex-1 space-y-6">
                <div className="rounded-xl border border-white/50 bg-white/40 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <i className="ph ph-sparkle text-xl text-indigo-500" />
                    <h3 className="font-bold text-gray-800">DeepSeek API Configuration</h3>
                  </div>
                  <p className="mb-4 text-sm text-gray-600">
                    To enable AI features like Smart Fill and Mnemonics, please enter your DeepSeek API Key.
                  </p>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-gray-500" htmlFor="input-api-key">
                      API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        id="input-api-key"
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        className="w-full rounded-lg border border-white/60 bg-white/50 p-3 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                        placeholder="sk-..."
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((v) => !v)}
                        className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                      >
                        <i className="ph ph-eye" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">Your key is stored locally in your browser.</p>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    saveSettings({ apiKey: keyDraft.trim() });
                    refresh();
                    window.alert("Settings Saved!");
                    setView("home");
                  }}
                  className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white shadow-lg transition-all hover:bg-indigo-700 active:scale-95"
                >
                  Save Settings
                </button>
              </div>
            </div>
          )}

          {view === "library" && (
            <div>
              {stats === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-gray-500">Empty Library</div>
              ) : (
                <div className="ctx-slide space-y-3 pb-4">
                  {[...cards].reverse().map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => openEditor(card)}
                      className="group block w-full cursor-pointer rounded-xl border border-white/50 bg-white/40 p-4 text-left transition-all hover:bg-white/60 hover:shadow-md"
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <h3 className="break-words text-lg font-bold text-indigo-900">{card.term}</h3>
                        <span className="shrink-0 rounded bg-white/50 px-1.5 py-0.5 text-xs text-gray-400">{card.state}</span>
                      </div>
                      <p className="line-clamp-2 break-words font-serif text-sm leading-snug text-gray-700 opacity-80 group-hover:opacity-100">
                        {card.sentence.length > 60 ? card.sentence.substring(0, 60) + "..." : card.sentence}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "editor" && (
            <div className="ctx-fade flex h-full flex-col gap-4">
              <div className="flex items-center justify-between border-b border-black/5 pb-2">
                <h2 className="text-xl font-bold text-gray-800">{editingId ? "Edit Card" : "New Card"}</h2>
              </div>

              <div className="ctx-scroll flex-1 space-y-4 overflow-y-auto pr-1">
                <div className="space-y-1">
                  <label className="flex justify-between text-xs font-bold uppercase text-gray-500" htmlFor="input-term">
                    Word / Phrase
                    <button
                      type="button"
                      onClick={runSmartFill}
                      className="flex items-center gap-1 rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600 transition-colors hover:text-indigo-800"
                    >
                      <i className="ph ph-sparkle-fill" /> AI Smart Fill
                    </button>
                  </label>
                  <input
                    id="input-term"
                    type="text"
                    value={form.term}
                    onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
                    className="w-full rounded-lg border border-white/60 bg-white/50 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                    placeholder="e.g. epiphany"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-gray-500" htmlFor="input-sentence">
                    Target Sentence
                  </label>
                  <textarea
                    id="input-sentence"
                    rows={2}
                    value={form.sentence}
                    onChange={(e) => setForm((f) => ({ ...f, sentence: e.target.value }))}
                    className="w-full rounded-lg border border-white/60 bg-white/50 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                    placeholder="The sentence containing the word..."
                  />
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-gray-500" htmlFor="input-pre">
                      Pre-Context
                    </label>
                    <textarea
                      id="input-pre"
                      rows={2}
                      value={form.preContext}
                      onChange={(e) => setForm((f) => ({ ...f, preContext: e.target.value }))}
                      className="w-full rounded-lg border border-white/60 bg-white/30 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                      placeholder="What happened before?"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase text-gray-500" htmlFor="input-post">
                      Post-Context
                    </label>
                    <textarea
                      id="input-post"
                      rows={2}
                      value={form.postContext}
                      onChange={(e) => setForm((f) => ({ ...f, postContext: e.target.value }))}
                      className="w-full rounded-lg border border-white/60 bg-white/30 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                      placeholder="What happened after?"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase text-gray-500" htmlFor="input-def">
                    Definition &amp; Notes
                  </label>
                  <textarea
                    id="input-def"
                    rows={3}
                    value={form.definition}
                    onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))}
                    className="w-full rounded-lg border border-white/60 bg-white/50 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                    placeholder="Meaning, translation, etc."
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={submitCard}
                  className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white shadow-lg shadow-indigo-500/30 transition-all hover:bg-indigo-700 active:scale-95"
                >
                  {editingId ? "Save Changes" : "Create Card"}
                </button>
              </div>
            </div>
          )}

          {view === "study-setup" && (
            <div className="ctx-fade flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="mb-2">
                <h2 className="text-2xl font-light text-indigo-900">Choose Mode</h2>
              </div>

              <button
                type="button"
                disabled={dueCount === 0}
                onClick={() => startSession("plan")}
                className={`group w-64 rounded-2xl border p-5 text-left transition-all ${
                  dueCount > 0
                    ? "cursor-pointer border-indigo-200 bg-white/60 hover:border-indigo-300 hover:bg-white/80 hover:shadow-lg"
                    : "cursor-not-allowed border-gray-200 bg-gray-100/50 opacity-60"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-lg font-bold text-gray-800">Daily Plan</span>
                  <i className="ph ph-calendar-check text-2xl text-indigo-600" />
                </div>
                <p className="mb-2 text-sm text-gray-600">Review scheduled cards based on FRSR algorithm.</p>
                <span className="inline-block rounded bg-indigo-100 px-2 py-1 text-xs font-bold text-indigo-700">
                  {dueCount} cards due
                </span>
              </button>

              <button
                type="button"
                onClick={() => startSession("free")}
                className="group w-full max-w-xs cursor-pointer rounded-2xl border border-purple-200 bg-white/40 p-5 text-left transition-all hover:border-purple-300 hover:bg-white/70 hover:shadow-lg"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-lg font-bold text-gray-800">Free Review</span>
                  <i className="ph ph-shuffle text-2xl text-purple-600" />
                </div>
                <p className="mb-2 text-sm text-gray-600">DIY Session. Randomly review cards.</p>
                <span className="inline-block rounded bg-purple-100 px-2 py-1 text-xs font-bold text-purple-700">
                  {stats} cards total
                </span>
              </button>
            </div>
          )}

          {view === "study-session" &&
            (done ? (
              <div className="ctx-fade flex h-full flex-col items-center justify-center text-center">
                <i className="ph ph-confetti mb-4 text-6xl text-indigo-500" />
                <h2 className="mb-2 text-2xl font-bold text-gray-800">Session Complete!</h2>
                <p className="mb-6 text-gray-600">You&apos;ve reviewed {session.queue.length} cards.</p>
                <button
                  type="button"
                  onClick={() => setView("home")}
                  className="rounded-full bg-indigo-600 px-6 py-2 text-white shadow-lg transition-transform hover:scale-105 hover:bg-indigo-700"
                >
                  Back Home
                </button>
              </div>
            ) : (
              currentCard && (
                <div className="relative flex min-h-full flex-col">
                  <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-gray-200/50">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${(session.index / session.queue.length) * 100}%` }}
                    />
                  </div>

                  <div className="ctx-fade ctx-scroll flex flex-1 flex-col items-start justify-center overflow-y-auto pr-2">
                    {currentCard.preContext && (
                      <p className="mb-3 break-words border-l-2 border-gray-300 pl-4 text-sm italic text-gray-500">
                        {currentCard.preContext}
                      </p>
                    )}

                    <div className="mb-4 break-words font-serif text-xl leading-relaxed text-gray-900 md:text-2xl">
                      {splitHighlight(currentCard.sentence, currentCard.term).map((part, i) =>
                        part.hit ? (
                          <span key={i} className="ctx-highlight">
                            {part.text}
                          </span>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </div>

                    {currentCard.postContext && (
                      <p className="mt-1 break-words border-l-2 border-gray-300 pl-4 text-sm italic text-gray-500">
                        {currentCard.postContext}
                      </p>
                    )}
                  </div>

                  {session.flipped && (
                    <div className="ctx-slide mt-4 flex-1 border-t border-white/40 pt-4">
                      <div className="relative w-full rounded-xl border border-white/50 bg-white/40 p-4">
                        <div className="mb-1 flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase text-indigo-600">Definition</h3>
                          <button
                            type="button"
                            onClick={() => showMnemonic(currentCard)}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-indigo-600 transition-colors hover:bg-indigo-50"
                          >
                            <i className="ph ph-magic-wand" /> AI Mnemonic
                          </button>
                        </div>
                        <p className="break-words text-gray-800">{currentCard.definition || "No definition."}</p>
                        {mnemonics[currentCard.id] && (
                          <div className="mt-3 rounded border-t border-indigo-100 bg-indigo-50/50 p-2 text-sm italic text-indigo-800">
                            <strong>🤖 AI Tip:</strong> {mnemonics[currentCard.id]}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto flex h-20 w-full items-center justify-center pt-4">
                    {!session.flipped ? (
                      <button
                        type="button"
                        onClick={flipCard}
                        className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white shadow-lg transition-all hover:bg-indigo-700 active:scale-95"
                      >
                        Show Answer
                      </button>
                    ) : (
                      <div className="grid w-full grid-cols-4 gap-2">
                        {[
                          [1, "Again", "1m", "bg-red-100 hover:bg-red-200 text-red-700"],
                          [2, "Hard", "10m", "bg-orange-100 hover:bg-orange-200 text-orange-700"],
                          [3, "Good", "1d", "bg-blue-100 hover:bg-blue-200 text-blue-700"],
                          [4, "Easy", "4d", "bg-green-100 hover:bg-green-200 text-green-700"],
                        ].map(([value, label, hint, cls]) => (
                          <button
                            key={label as string}
                            type="button"
                            onClick={() => submitRating(value as 1 | 2 | 3 | 4)}
                            className={`flex min-h-11 flex-col items-center justify-center rounded-lg py-2 text-sm font-medium transition-colors ${cls}`}
                          >
                            <span>{label as string}</span>
                            <span className="text-[10px] opacity-70">{hint as string}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            ))}
        </main>
      </div>
    </div>
  );
}
