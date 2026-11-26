"use client";

import Script from "next/script";
import { marked } from "marked";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allTags,
  applyAnnotationHighlights,
  filterDocs,
  generateId,
  initialState,
  isSeedDocLike,
  loadState,
  newDoc,
  persistState,
  SEED_DOC_ID,
  type ExpressDoc,
  type ExpressState,
  type Mode,
} from "@/lib/tools/expressing";
import { useAccount } from "@/lib/useAccount";
import SyncConflicts, { type SyncConflictItem } from "@/components/SyncConflicts";

marked.setOptions({ breaks: true, gfm: true });

const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "view", label: "View", icon: "ph-bold ph-eye" },
  { id: "note", label: "Note", icon: "ph-bold ph-highlighter-circle" },
  { id: "edit", label: "Edit", icon: "ph-bold ph-pencil-simple" },
];

const MODE_BTN_ACTIVE = "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all bg-white shadow-sm text-gray-900 sm:py-1.5";
const MODE_BTN_IDLE = "flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-all text-gray-500 hover:text-gray-900 sm:py-1.5";

export default function ExpressingApp() {
  const [state, setState] = useState<ExpressState>(initialState);
  const stateRef = useRef<ExpressState>(initialState());
  const [hydrated, setHydrated] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [annoDraft, setAnnoDraft] = useState("");
  const [editorLabel, setEditorLabel] = useState<"Adding Note" | "Editing Note">("Adding Note");
  const [editorOpen, setEditorOpen] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [categoryModal, setCategoryModal] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [sanitize, setSanitize] = useState<(html: string) => string>(() => (h: string) => h);
  const [syncReady, setSyncReady] = useState(false);
  const { account, logout } = useAccount();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const mountedSync = useRef(false);

  const commit = useCallback((updater: (prev: ExpressState) => ExpressState) => {
    // 同步计算并更新 stateRef：同步回调（冲突处理）可能在同一 tick 连续调用多次
    const next = updater(stateRef.current);
    stateRef.current = next;
    persistState(next);
    setState(next);
  }, []);

  // 首屏：读本地状态（无数据时种一条示例，与旧版一致）
  useEffect(() => {
    const loaded = loadState();
    stateRef.current = loaded;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 一次性读取 localStorage 水合
    setState(loaded);
    setHydrated(true);
    import("dompurify")
      .then((m) => setSanitize(() => (h: string) => m.default.sanitize(h)))
      .catch(() => {});
  }, []);

  // 其他标签页写入时只同步文档数据，保留当前标签页的视图状态
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "bri_fix_pro_v1") return;
      const next = loadState();
      next.ui = stateRef.current.ui;
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const updateCategoryDropdowns = useCallback(() => {}, []);

  // 挂载云同步挂件
  useEffect(() => {
    if (mountedSync.current) return;
    let cancelled = false;
    let tries = 0;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      const widget = (
        window as unknown as {
          SyncWidget?: { mount: (opts: unknown) => void };
        }
      ).SyncWidget;
      if (widget) {
        window.clearInterval(timer);
        mountedSync.current = true;
        setSyncReady(true);
        widget.mount({
          app: "expressing",
          collections: {
            docs: {
              read: () => stateRef.current.docs,
              getId: (d: ExpressDoc) => d.id,
              getUpdatedAt: (d: ExpressDoc) => Number(d.updatedAt) || 0,
              applyChanges: (
                changes: { id: string; op?: string; data?: Partial<ExpressDoc>; updatedAt?: number }[],
              ) => {
                let changed = false;
                const docs = [...stateRef.current.docs];
                for (const ch of changes) {
                  const idx = docs.findIndex((d) => d.id === ch.id);
                  if (ch.op === "delete") {
                    if (idx !== -1) {
                      docs.splice(idx, 1);
                      changed = true;
                    }
                    continue;
                  }
                  if (!ch.data) continue;
                  const incoming = {
                    ...(ch.data as ExpressDoc),
                    updatedAt: Math.max(Number(ch.data.updatedAt) || 0, Number(ch.updatedAt) || 0),
                  };
                  // 云端可能还留着旧版随机 id 的示例；本地已有固定 id 时不再收进来
                  if (
                    incoming.id !== SEED_DOC_ID &&
                    isSeedDocLike(incoming) &&
                    docs.some((d) => d.id === SEED_DOC_ID)
                  ) {
                    continue;
                  }
                  if (idx === -1) {
                    docs.push(incoming);
                    changed = true;
                  } else if (Number(incoming.updatedAt) > Number(docs[idx].updatedAt || 0)) {
                    docs[idx] = incoming;
                    changed = true;
                  }
                }
                if (changed) {
                  commit((prev) => {
                    const activeDocId =
                      prev.activeDocId && docs.find((d) => d.id === prev.activeDocId)
                        ? prev.activeDocId
                        : docs.length
                          ? docs[0].id
                          : null;
                    return { ...prev, docs, activeDocId };
                  });
                }
                return changed;
              },
            },
            settings: {
              read: () => [
                {
                  id: "__singleton__",
                  categories: stateRef.current.categories,
                  updatedAt: Number(stateRef.current.__categoriesUpdatedAt) || 0,
                },
              ],
              getId: (r: { id: string }) => r.id,
              getUpdatedAt: (r: { updatedAt: number }) => Number(r.updatedAt) || 0,
              applyChanges: (
                changes: { op?: string; data?: { categories?: string[] }; updatedAt?: number }[],
              ) => {
                let changed = false;
                for (const ch of changes) {
                  if (ch.op === "delete" || !ch.data || !Array.isArray(ch.data.categories)) continue;
                  if (JSON.stringify(ch.data.categories) === JSON.stringify(stateRef.current.categories)) continue;
                  commit((prev) => ({
                    ...prev,
                    categories: ch.data!.categories as string[],
                    __categoriesUpdatedAt: ch.updatedAt,
                  }));
                  changed = true;
                }
                return changed;
              },
            },
          },
          onApplied: () => updateCategoryDropdowns(),
        });
      } else if (++tries > 40) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [commit, updateCategoryDropdowns]);

  const activeDoc = useMemo(
    () => state.docs.find((d) => d.id === state.activeDocId) || null,
    [state.docs, state.activeDocId],
  );

  // 切换文档时同步标签草稿
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 文档切换时把持久化标签同步到编辑草稿
    setTagDraft(activeDoc ? activeDoc.tags.join(", ") : "");
  }, [activeDoc?.id, activeDoc]);

  const tags = useMemo(() => allTags(state.docs), [state.docs]);
  const filtered = useMemo(() => filterDocs(state), [state]);

  const updateDoc = useCallback(
    (id: string, patch: Partial<ExpressDoc>) => {
      commit((prev) => ({
        ...prev,
        docs: prev.docs.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)),
      }));
    },
    [commit],
  );

  const selectDoc = useCallback(
    (id: string) => {
      setMobileSidebar(false);
      commit((prev) => ({ ...prev, activeDocId: id, ui: { ...prev.ui, globalMode: false } }));
    },
    [commit],
  );

  const createDoc = useCallback(() => {
    const doc = newDoc();
    setMobileSidebar(false);
    commit((prev) => ({
      ...prev,
      docs: [doc, ...prev.docs],
      activeDocId: doc.id,
      ui: { ...prev.ui, mode: "edit", globalMode: false },
    }));
    window.setTimeout(() => titleRef.current?.select(), 100);
  }, [commit]);

  const deleteDoc = useCallback(() => {
    const id = state.activeDocId;
    if (!id || !window.confirm("Delete this expression?")) return;
    const remaining = state.docs.filter((d) => d.id !== id);
    if (remaining.length === 0) {
      const doc = newDoc();
      commit((prev) => ({ ...prev, docs: [doc], activeDocId: doc.id, ui: { ...prev.ui, mode: "edit" } }));
    } else {
      commit((prev) => ({ ...prev, docs: remaining, activeDocId: remaining[0].id }));
    }
  }, [commit, state.activeDocId, state.docs]);

  const setMode = useCallback(
    (mode: Mode) => {
      setSelection(null);
      commit((prev) => ({
        ...prev,
        ui: { ...prev.ui, mode, drawerOpen: false, editingAnnotationId: null },
      }));
    },
    [commit],
  );

  // --- 标注 ---
  const onPreviewMouseUp = useCallback(() => {
    if (stateRef.current.ui.mode !== "note" || !previewRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!previewRef.current.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().trim();
    if (!text || sel.isCollapsed) {
      setSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setSelection({ text, top: rect.top - 50, left: rect.left + rect.width / 2 });
  }, []);

  const openDrawer = useCallback(
    (withEditor: boolean, text?: string, note?: string, editingId?: string | null) => {
      setPendingText(text ?? "");
      setAnnoDraft(note ?? "");
      setEditorOpen(withEditor);
      setEditorLabel(editingId ? "Editing Note" : "Adding Note");
      commit((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: true, editingAnnotationId: editingId ?? null } }));
      if (withEditor) window.setTimeout(() => document.getElementById("annotation-input")?.focus(), 50);
    },
    [commit],
  );

  const initiateAnnotation = useCallback(() => {
    if (!selection) return;
    setSelection(null);
    openDrawer(true, selection.text);
  }, [openDrawer, selection]);

  const saveAnnotation = useCallback(() => {
    const doc = activeDoc;
    if (!doc || !annoDraft.trim()) return;
    const editingId = state.ui.editingAnnotationId;
    commit((prev) => ({
      ...prev,
      docs: prev.docs.map((d) => {
        if (d.id !== doc.id) return d;
        if (editingId) {
          return {
            ...d,
            annotations: d.annotations.map((a) => (a.id === editingId ? { ...a, note: annoDraft } : a)),
            updatedAt: Date.now(),
          };
        }
        return {
          ...d,
          annotations: [...d.annotations, { id: generateId(), text: pendingText, note: annoDraft }],
          updatedAt: Date.now(),
        };
      }),
      ui: { ...prev.ui, editingAnnotationId: null, drawerOpen: false },
    }));
    setAnnoDraft("");
  }, [activeDoc, annoDraft, commit, pendingText, state.ui.editingAnnotationId]);

  const editAnnotation = useCallback(
    (id: string) => {
      const anno = activeDoc?.annotations.find((a) => a.id === id);
      if (!anno) return;
      openDrawer(true, anno.text, anno.note, id);
    },
    [activeDoc, openDrawer],
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      if (!activeDoc) return;
      commit((prev) => ({
        ...prev,
        docs: prev.docs.map((d) =>
          d.id === activeDoc.id
            ? { ...d, annotations: d.annotations.filter((a) => a.id !== id), updatedAt: Date.now() }
            : d,
        ),
      }));
    },
    [activeDoc, commit],
  );

  const onHighlightClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = (event.target as HTMLElement).closest("[data-anno-id]");
      if (!target) return;
      const id = target.getAttribute("data-anno-id");
      if (!id) return;
      if (state.ui.mode === "view") {
        commit((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: true } }));
        window.setTimeout(() => {
          const el = document.getElementById(`sidebar-anno-${id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-2", "ring-emerald-500");
            window.setTimeout(() => el.classList.remove("ring-2", "ring-emerald-500"), 1500);
          }
        }, 100);
      } else if (state.ui.mode === "note") {
        editAnnotation(id);
      }
    },
    [commit, editAnnotation, state.ui.mode],
  );

  // --- 分类 ---
  const addCategory = useCallback(() => {
    const value = newCategory.trim();
    if (!value || state.categories.includes(value)) return;
    commit((prev) => ({ ...prev, categories: [...prev.categories, value], __categoriesUpdatedAt: Date.now() }));
    setNewCategory("");
  }, [commit, newCategory, state.categories]);

  const removeCategory = useCallback(
    (cat: string) => {
      if (!window.confirm("Delete category? Files will move to General.")) return;
      commit((prev) => ({
        ...prev,
        categories: prev.categories.filter((c) => c !== cat),
        docs: prev.docs.map((d) => (d.category === cat ? { ...d, category: "General" } : d)),
        __categoriesUpdatedAt: Date.now(),
      }));
    },
    [commit],
  );

  // --- 导入导出 ---
  const exportBackup = useCallback(() => {
    const blob = new Blob([JSON.stringify(stateRef.current, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bri-fix-backup-${new Date().toISOString().slice(0, 10)}.bri`;
    a.click();
  }, []);

  const importBackup = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const loaded = JSON.parse(String(e.target?.result)) as ExpressState;
          if (!loaded.docs) throw new Error("no docs");
          const next: ExpressState = {
            ...initialState(),
            ...loaded,
            ui: {
              ...initialState().ui,
              ...(loaded.ui || {}),
              // 与旧版 initApp 一致：导入后回阅读态，侧栏展开
              mode: "view",
              sidebarOpen: true,
              drawerOpen: false,
              editingAnnotationId: null,
              globalMode: false,
            },
          };
          next.docs = next.docs.map((d) => ({ ...d, tags: d.tags || [], annotations: d.annotations || [] }));
          const doc = next.docs[0];
          next.activeDocId = doc ? doc.id : null;
          stateRef.current = next;
          setState(next);
          persistState(next);
          if (!doc) createDoc();
          window.alert("Import successful");
        } catch {
          window.alert("Invalid file");
        }
      };
      reader.readAsText(file);
    },
    [createDoc],
  );

  const exportMarkdown = useCallback(() => {
    if (!activeDoc) return;
    let md = `# ${activeDoc.title}\n\n`;
    md += `**Context (Chinese):** ${activeDoc.chinese}\n\n`;
    md += `| ❌ Avoid (Mistake) | ✅ Natural (Native) |\n| :--- | :--- |\n| ${activeDoc.mistake.replace(/\n/g, " ")} | **${activeDoc.native.replace(/\n/g, " ")}** |\n\n`;
    md += `## Analysis\n\n${activeDoc.explanation}\n\n`;
    if (activeDoc.annotations.length > 0) {
      md += `## 📝 Glossary Notes\n\n`;
      activeDoc.annotations.forEach((a) => (md += `- **${a.text}**: ${a.note}\n`));
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${activeDoc.title.replace(/\s+/g, "_")}.md`;
    a.click();
  }, [activeDoc]);

  // --- 渲染 ---
  const previewHtml = useMemo(() => {
    if (!activeDoc) return { native: "", explanation: "" };
    const native = sanitize(applyAnnotationHighlights(activeDoc.native || "", activeDoc.annotations));
    const explanation = sanitize(
      applyAnnotationHighlights(marked.parse(activeDoc.explanation || "") as string, activeDoc.annotations),
    );
    return { native, explanation };
  }, [activeDoc, sanitize]);

  const visibleDocs = filtered;

  if (!hydrated) {
    return <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-400">Loading…</div>;
  }

  return (
    <div
      className="relative flex h-screen w-screen overflow-hidden bg-gray-50 text-slate-800"
      style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
    >
      <style>{`
        .expr-preview .bri-highlight { background-color:#ffff00; border-bottom:2px solid #eab308; border-radius:3px; cursor:pointer; transition:all .2s; padding:0 2px; }
        .expr-preview.mode-view .bri-highlight:hover { background-color:#fde047; }
        .expr-preview.mode-view .bri-highlight.active { outline:2px solid #ca8a04; }
        .expr-prose :where(code):not(:where(pre code)) { color:#059669; background-color:#ecfdf5; padding:2px 5px; border-radius:4px; font-weight:500; border:1px solid #a7f3d0; }
        .expr-prose pre { background-color:#1e293b; color:#e2e8f0; border-radius:.5rem; padding:14px 16px; overflow-x:auto; }
        .expr-prose h1,.expr-prose h2,.expr-prose h3 { font-weight:700; margin:1.2em 0 .5em; }
        .expr-prose h3 { font-size:1.05em; }
        .expr-prose p { margin:.6em 0; }
        .expr-prose ul { list-style:disc; padding-left:1.3em; margin:.6em 0; }
        .expr-prose li { margin:.2em 0; }
        .expr-prose strong { font-weight:700; color:#0f172a; }
        .expr-sidebar-closed #expressing-sidebar { margin-left:-18rem; }
        /* 窄屏：左侧文档栏改为覆盖式抽屉，桌面（≥1024px）保持原布局 */
        @media (max-width: 1023.98px) {
          #expressing-sidebar {
            position: fixed; top: 0; bottom: 0; left: 0; z-index: 60;
            width: 18rem; min-width: 18rem; margin-left: 0 !important;
            transform: translateX(-100%); transition: transform .3s ease;
            box-shadow: 0 24px 60px -20px rgba(15,23,42,.45);
          }
          #expressing-sidebar.mobile-open { transform: translateX(0); }
        }
      `}</style>
      <Script src="/shared/sync-client.js" strategy="afterInteractive" />
      <Script src="/shared/sync-widget.js" strategy="afterInteractive" />

      <aside
        id="expressing-sidebar"
        className={`z-20 flex w-72 flex-shrink-0 flex-col border-r border-gray-200 bg-white shadow-[4px_0_24px_rgba(0,0,0,0.02)] transition-[margin] duration-300 ${mobileSidebar ? "mobile-open" : ""}`}
        style={{ marginLeft: state.ui.sidebarOpen ? 0 : "-18rem" }}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-100 px-5">
          <div className="flex select-none items-center gap-2 text-lg font-bold tracking-tight text-emerald-600">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-md shadow-emerald-100">
              <i className="ph-bold ph-arrows-left-right text-xl" />
            </div>
            Expressing
          </div>
          <button
            type="button"
            onClick={createDoc}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100"
            title="New Correction"
          >
            <i className="ph-bold ph-plus" />
          </button>
        </div>

        <div className="space-y-3 border-b border-gray-100 bg-gray-50/30 p-4">
          <div className="group relative">
            <i className="ph ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-emerald-600" />
            <input
              type="text"
              value={state.ui.searchQuery}
              onChange={(e) => commit((prev) => ({ ...prev, ui: { ...prev.ui, searchQuery: e.target.value } }))}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-all focus:border-emerald-600 focus:ring-2 focus:ring-emerald-50"
              placeholder="Search expressions..."
            />
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <select
                value={state.ui.searchCategory}
                onChange={(e) => commit((prev) => ({ ...prev, ui: { ...prev.ui, searchCategory: e.target.value } }))}
                className="w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-600 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-50"
              >
                <option value="">All Categories</option>
                {state.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <i className="ph-bold ph-caret-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" />
            </div>
            <button
              type="button"
              onClick={() => setCategoryModal(true)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-gray-500 shadow-sm transition-all hover:border-emerald-100 hover:bg-emerald-50 hover:text-emerald-600"
            >
              <i className="ph-bold ph-gear" />
            </button>
          </div>

          <div className="relative w-full">
            <select
              value={state.ui.searchTag}
              onChange={(e) => commit((prev) => ({ ...prev, ui: { ...prev.ui, searchTag: e.target.value } }))}
              className="w-full cursor-pointer appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-8 text-sm text-gray-600 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-50"
            >
              <option value="">All Tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <i className="ph-bold ph-tag pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400" />
            <i className="ph-bold ph-caret-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" />
          </div>
        </div>

        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="py-4 text-center text-xs text-gray-400">No expressions found.</div>
          ) : (
            filtered.map((doc) => {
              const isActive = state.activeDocId === doc.id && !state.ui.globalMode;
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => selectDoc(doc.id)}
                  className={`group w-full rounded-lg border p-3 text-left transition-all ${
                    isActive
                      ? "border-emerald-200 bg-emerald-50 shadow-sm"
                      : "border-transparent bg-transparent hover:border-gray-100 hover:bg-gray-50"
                  }`}
                >
                  <div className="mb-1 flex items-start justify-between">
                    <div className={`flex-1 truncate pr-2 text-sm font-medium ${isActive ? "text-emerald-600" : "text-gray-700"}`}>
                      {doc.title}
                    </div>
                  </div>
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        isActive ? "border border-emerald-100 bg-white text-emerald-600" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {doc.category}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-400">
                      {new Date(doc.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  {doc.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {doc.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded border border-gray-200 bg-gray-100 px-1 text-[9px] text-gray-500"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-gray-100 bg-gray-50/50 p-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 shadow-sm transition hover:bg-gray-50"
            >
              <i className="ph ph-upload-simple" /> Import
            </button>
            <button
              type="button"
              onClick={exportBackup}
              className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 shadow-sm transition hover:bg-gray-50"
            >
              <i className="ph ph-download-simple" /> Save
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".bri,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importBackup(file);
              e.target.value = "";
            }}
          />
          {account && (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 text-[11px] text-gray-500">
              {account.user ? (
                <>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <i className="ph-bold ph-user-circle text-sm text-emerald-500" />
                    <span className="truncate">
                      账号 <b className="font-semibold text-gray-700">{account.user.username}</b>
                      {account.user.role === "admin" ? " · 管理员" : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="shrink-0 font-semibold text-gray-500 transition hover:text-red-500"
                  >
                    退出登录
                  </button>
                </>
              ) : account.mode === "off" ? (
                <span className="italic text-gray-400">匿名模式 · 数据保存在本机</span>
              ) : (
                <>
                  <span className="text-gray-400">未登录 · 仅本机存储</span>
                  <a href="/login?next=/expressing" className="shrink-0 font-semibold text-emerald-600 hover:underline">
                    登录同步
                  </a>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {mobileSidebar && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileSidebar(false)}
        />
      )}

      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-white">
        <header className="sticky top-0 z-30 flex flex-col items-stretch gap-2 border-b border-gray-100 bg-white/80 px-3 py-2 backdrop-blur-sm lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:gap-0 lg:px-8 lg:py-0">
          <div className="mr-2 flex min-w-0 flex-1 items-center gap-2 lg:mr-4 lg:gap-4">
            <button
              type="button"
              aria-label="切换文档栏"
              onClick={() => {
                setMobileSidebar((v) => !v);
                commit((prev) => ({ ...prev, ui: { ...prev.ui, sidebarOpen: !prev.ui.sidebarOpen } }));
              }}
              className="-ml-2 shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 max-lg:grid max-lg:h-10 max-lg:w-10 max-lg:place-items-center"
            >
              <i className="ph-bold ph-list text-xl" />
            </button>

            {state.ui.globalMode && (
              <button
                type="button"
                onClick={() => commit((prev) => ({ ...prev, ui: { ...prev.ui, globalMode: false } }))}
                className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
              >
                <i className="ph-bold ph-arrow-left text-xl" />
              </button>
            )}

            {!state.ui.globalMode && activeDoc && (
              <div className="group w-full">
                <input
                  ref={titleRef}
                  type="text"
                  value={activeDoc.title}
                  onChange={(e) => updateDoc(activeDoc.id, { title: e.target.value || "Untitled" })}
                  className="w-full border-none bg-transparent text-xl font-bold tracking-tight text-gray-800 outline-none transition-colors placeholder-gray-300 focus:ring-0"
                  placeholder="Expression Summary (e.g. 'Asking for help')"
                />
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <span className="rounded border border-gray-200 bg-gray-100 px-2 py-0.5 text-gray-600">
                    {activeDoc.category}
                  </span>
                  <div className="flex gap-1">
                    {activeDoc.tags.map((t) => (
                      <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {state.ui.globalMode && (
              <div className="flex items-center gap-3 text-lg font-bold text-slate-700">
                <div className="rounded-md bg-emerald-100 p-1.5 text-emerald-600">
                  <i className="ph-fill ph-squares-four" />
                </div>
                Expression Library
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 lg:justify-end lg:gap-4">
            {!state.ui.globalMode && (
              <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={state.ui.mode === m.id ? MODE_BTN_ACTIVE : MODE_BTN_IDLE}
                  >
                    <i className={m.icon} /> <span className="hidden sm:inline">{m.label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="hidden h-6 w-px bg-gray-200 sm:block" />

            <div className="flex items-center gap-1 lg:gap-4">
            <button
              type="button"
              aria-label="表达库"
              onClick={() => commit((prev) => ({ ...prev, ui: { ...prev.ui, globalMode: !prev.ui.globalMode } }))}
              className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-emerald-50 hover:text-emerald-600 max-lg:grid max-lg:h-10 max-lg:w-10 max-lg:place-items-center"
            >
              <i className="ph-bold ph-squares-four text-xl" />
            </button>

            {!state.ui.globalMode && activeDoc && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="导出 Markdown"
                  onClick={exportMarkdown}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-slate-700 max-lg:grid max-lg:h-10 max-lg:w-10 max-lg:place-items-center"
                >
                  <i className="ph-bold ph-file-md text-xl" />
                </button>
                <button
                  type="button"
                  aria-label="删除文档"
                  onClick={deleteDoc}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 max-lg:grid max-lg:h-10 max-lg:w-10 max-lg:place-items-center"
                >
                  <i className="ph-bold ph-trash text-xl" />
                </button>
              </div>
            )}
            </div>
          </div>
        </header>

        <div className="relative flex flex-1 overflow-hidden bg-gray-50">
          {state.ui.globalMode && (
            <div className="h-full w-full overflow-y-auto p-4 sm:p-8">
              <div className="mx-auto max-w-7xl">
                <div className="mb-8 flex items-end justify-between border-b border-gray-100 pb-4">
                  <div>
                    <h2 className="text-3xl font-bold tracking-tight text-gray-800">Library</h2>
                    <p className="mt-1 text-sm text-gray-500">{visibleDocs.length} expression(s) saved</p>
                  </div>
                </div>
                {visibleDocs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <i className="ph ph-magnifying-glass text-3xl" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">No expressions found</h3>
                    <button
                      type="button"
                      onClick={createDoc}
                      className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-white shadow-sm transition hover:bg-emerald-700"
                    >
                      Add Expression
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-6 pb-20 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
                    {visibleDocs.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => selectDoc(doc.id)}
                        className="group relative flex h-72 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
                      >
                        <div className="absolute left-0 top-0 h-full w-1 bg-emerald-600 opacity-0 transition-opacity group-hover:opacity-100" />
                        <div className="mb-2 flex items-start justify-between">
                          <span className="rounded border border-gray-100 bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                            {doc.category}
                          </span>
                        </div>
                        {doc.tags.length > 0 && (
                          <div className="mb-3 flex flex-wrap gap-1">
                            {doc.tags.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="rounded border border-gray-100 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                        <h3 className="mb-2 truncate font-bold text-gray-800">{doc.title}</h3>
                        <div className="mt-1 flex-1 space-y-3 overflow-hidden">
                          <div className="mb-1 text-xs text-gray-400">Target: {doc.chinese}</div>
                          <div className="truncate rounded bg-red-50 p-2 text-xs text-red-600 line-through decoration-red-300 opacity-70">
                            {doc.mistake || "-"}
                          </div>
                          <div className="rounded border border-emerald-100 bg-emerald-50 p-2 text-sm font-semibold text-emerald-700 shadow-sm">
                            {doc.native || "-"}
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-400">
                          <div
                            className={`flex items-center gap-1 ${doc.annotations.length > 0 ? "font-medium text-emerald-600" : ""}`}
                          >
                            <i className="ph-fill ph-notebook" /> {doc.annotations.length} Notes
                          </div>
                          <div className="font-bold text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100">
                            Edit <i className="ph-bold ph-arrow-right" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!state.ui.globalMode && state.ui.mode === "edit" && activeDoc && (
            <div className="flex h-full flex-1 flex-col overflow-y-auto bg-gray-50">
              <div className="mx-auto w-full max-w-4xl space-y-6 p-4 pb-24 sm:p-8 sm:pb-32">
                <div className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 sm:gap-6 sm:p-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-400" htmlFor="input-category">
                      Category
                    </label>
                    <div className="relative">
                      <select
                        id="input-category"
                        value={activeDoc.category}
                        onChange={(e) => updateDoc(activeDoc.id, { category: e.target.value })}
                        className="w-full appearance-none rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm text-gray-700 outline-none transition-all focus:border-emerald-600 focus:bg-white focus:ring-1 focus:ring-emerald-600"
                      >
                        {state.categories.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <i className="ph-bold ph-caret-down pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400" />
                    </div>
                    <div
                      onClick={() => setCategoryModal(true)}
                      className="cursor-pointer text-right text-[10px] text-gray-400 hover:text-emerald-600"
                    >
                      + Manage Categories
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-400" htmlFor="input-tags">
                      Tags
                    </label>
                    <div className="relative">
                      <input
                        id="input-tags"
                        type="text"
                        value={tagDraft}
                        onChange={(e) => setTagDraft(e.target.value)}
                        onBlur={() =>
                          updateDoc(activeDoc.id, {
                            tags: tagDraft
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                          })
                        }
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-sm text-gray-700 outline-none transition-all focus:border-emerald-600 focus:bg-white focus:ring-1 focus:ring-emerald-600"
                        placeholder="e.g. business, casual, idioms"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="ml-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500" htmlFor="input-chinese">
                      <i className="ph-bold ph-translate text-indigo-500" /> Intended Meaning (Chinese)
                    </label>
                    <input
                      id="input-chinese"
                      type="text"
                      value={activeDoc.chinese}
                      onChange={(e) => updateDoc(activeDoc.id, { chinese: e.target.value })}
                      className="w-full rounded-xl border border-gray-200 bg-white p-4 font-medium text-gray-800 shadow-sm outline-none transition-all focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50"
                      placeholder="输入中文原意..."
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="ml-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-500" htmlFor="input-mistake">
                        <i className="ph-bold ph-x-circle" /> Common Mistake / Intuition
                      </label>
                      <textarea
                        id="input-mistake"
                        rows={3}
                        value={activeDoc.mistake}
                        onChange={(e) => updateDoc(activeDoc.id, { mistake: e.target.value })}
                        className="w-full resize-none rounded-xl border border-red-200 bg-red-50/20 p-4 font-medium text-gray-700 shadow-sm outline-none transition-all focus:border-red-500 focus:ring-4 focus:ring-red-50"
                        placeholder="Enter the wrong or Chinglish expression..."
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="ml-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600" htmlFor="input-native">
                        <i className="ph-bold ph-check-circle" /> Native / Natural
                      </label>
                      <textarea
                        id="input-native"
                        rows={3}
                        value={activeDoc.native}
                        onChange={(e) => updateDoc(activeDoc.id, { native: e.target.value })}
                        className="w-full resize-none rounded-xl border border-emerald-200 bg-emerald-50/20 p-4 font-bold text-gray-800 shadow-sm outline-none transition-all focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50"
                        placeholder="Enter the correct, natural expression..."
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="ml-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500" htmlFor="input-explanation">
                    <i className="ph-bold ph-article text-gray-600" /> Detailed Explanation (Markdown)
                  </label>
                  <textarea
                    id="input-explanation"
                    value={activeDoc.explanation}
                    onChange={(e) => updateDoc(activeDoc.id, { explanation: e.target.value })}
                    className="h-72 w-full resize-none rounded-xl border border-gray-200 bg-white p-4 font-mono text-sm leading-relaxed shadow-sm outline-none transition-all focus:border-emerald-600 focus:ring-4 focus:ring-emerald-50 sm:h-[400px] sm:p-5"
                    placeholder="Why is the mistake wrong? What is the nuance of the native expression?..."
                  />
                </div>
              </div>
            </div>
          )}

          {!state.ui.globalMode && state.ui.mode !== "edit" && activeDoc && (
            <div
              ref={previewRef}
              onMouseUp={onPreviewMouseUp}
              onKeyUp={onPreviewMouseUp}
              onTouchEnd={onPreviewMouseUp}
              className={`expr-preview h-full min-w-0 flex-1 overflow-y-auto bg-white ${state.ui.mode === "view" ? "mode-view" : "mode-note"}`}
            >
              {state.ui.mode === "note" && (
                <div className="sticky top-0 z-10 border-b border-yellow-200 bg-yellow-100 px-4 py-2 text-center text-xs font-bold uppercase tracking-widest text-yellow-800 shadow-sm">
                  <i className="ph-fill ph-pencil-simple" /> Annotation Mode: Select text in the &quot;Native&quot; or
                  &quot;Analysis&quot; sections.
                </div>
              )}

              <div className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:px-8 sm:py-12 sm:pb-40">
                <div className="space-y-10">
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 sm:px-6 sm:py-4">
                      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-400">Target Meaning</div>
                      <div className="text-lg font-medium text-gray-900">
                        {activeDoc.chinese || <span className="italic text-gray-300">No Chinese translation provided</span>}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-2 md:divide-x md:divide-y-0">
                      <div className="bg-red-50/10 p-4 transition-colors hover:bg-red-50/30 sm:p-6">
                        <div className="mb-3 flex items-center gap-2">
                          <i className="ph-fill ph-x-circle text-xl text-red-500" />
                          <span className="text-xs font-bold uppercase tracking-wider text-red-500">Avoid Saying</span>
                        </div>
                        <div className="font-medium text-gray-600 line-through decoration-red-300 decoration-2 decoration-wavy opacity-80">
                          {activeDoc.mistake || "..."}
                        </div>
                      </div>
                      <div className="relative bg-emerald-50/10 p-4 transition-colors hover:bg-emerald-50/30 sm:p-6">
                        <div className="mb-3 flex items-center gap-2">
                          <i className="ph-fill ph-check-circle text-xl text-emerald-600" />
                          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                            Natural Expression
                          </span>
                        </div>
                        <div
                          className="text-lg font-bold leading-relaxed text-gray-800"
                          onClick={onHighlightClick}
                          dangerouslySetInnerHTML={{ __html: previewHtml.native || "..." }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="group relative">
                    <h2 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
                      <i className="ph-fill ph-info" /> Analysis &amp; Nuance
                    </h2>
                    <div
                      className="expr-prose max-w-none text-gray-700"
                      onClick={onHighlightClick}
                      dangerouslySetInnerHTML={{ __html: previewHtml.explanation }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {selection && (
          <button
            type="button"
            onClick={initiateAnnotation}
            className="fixed z-[100] -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-xl"
            style={{ top: selection.top, left: selection.left }}
          >
            <span className="flex items-center gap-2">
              <i className="ph-fill ph-highlighter-circle text-lg text-yellow-400" />
              <span>Add Note</span>
            </span>
          </button>
        )}
      </main>

      <aside
        className="absolute bottom-0 right-0 top-0 z-50 flex w-full max-w-full flex-shrink-0 flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-300 sm:w-[400px]"
        style={{ transform: state.ui.drawerOpen ? "translateX(0)" : "translateX(100%)" }}
      >
        <div className="flex h-16 items-center justify-between border-b border-gray-100 bg-gray-50/50 px-5">
          <h2 className="flex items-center gap-2 font-bold text-gray-800">
            <i className="ph-fill ph-notebook text-emerald-600" /> Notes
          </h2>
          <button
            type="button"
            onClick={() => commit((prev) => ({ ...prev, ui: { ...prev.ui, drawerOpen: false, editingAnnotationId: null } }))}
            className="rounded-md p-1 text-gray-400 transition hover:bg-gray-200 hover:text-gray-700"
          >
            <i className="ph-bold ph-x text-lg" />
          </button>
        </div>

        {editorOpen ? (
          <div className="border-b border-gray-100 bg-emerald-50/30 p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">{editorLabel}</span>
            </div>
            <div className="mb-3 rounded-lg border border-emerald-100 border-l-4 border-l-emerald-600 bg-white p-3 text-sm font-medium italic text-gray-800 shadow-sm">
              {pendingText}
            </div>
            <textarea
              id="annotation-input"
              rows={5}
              value={annoDraft}
              onChange={(e) => setAnnoDraft(e.target.value)}
              className="mb-3 w-full resize-none rounded-lg border border-gray-300 p-3 font-mono text-sm outline-none transition-shadow focus:border-emerald-600 focus:ring-2 focus:ring-emerald-50"
              placeholder="Add context or grammar notes..."
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditorOpen(false);
                  commit((prev) => ({ ...prev, ui: { ...prev.ui, editingAnnotationId: null, drawerOpen: false } }));
                }}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAnnotation}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700"
              >
                {state.ui.editingAnnotationId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!activeDoc || activeDoc.annotations.length === 0 ? (
            <div className="mt-12 text-center text-sm italic text-gray-400">No notes added.</div>
          ) : (
            activeDoc.annotations.map((anno) => (
              <div
                key={anno.id}
                id={`sidebar-anno-${anno.id}`}
                className="group rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:shadow-md"
              >
                <div className="mb-2 flex items-start justify-between">
                  <span className="max-w-[180px] truncate rounded border border-yellow-200 bg-yellow-100 px-2 py-0.5 text-xs font-bold text-gray-800">
                    {anno.text}
                  </span>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => editAnnotation(anno.id)}
                      className="p-1 text-gray-400 hover:text-emerald-600"
                    >
                      <i className="ph-bold ph-pencil-simple" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAnnotation(anno.id)}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <i className="ph-bold ph-trash" />
                    </button>
                  </div>
                </div>
                <div
                  className="expr-prose text-sm leading-relaxed text-gray-600"
                  dangerouslySetInnerHTML={{ __html: sanitize(marked.parse(anno.note) as string) }}
                />
              </div>
            ))
          )}
        </div>
      </aside>

      {categoryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            onClick={() => setCategoryModal(false)}
          />
          <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-6 py-4">
              <h3 className="text-lg font-bold text-gray-800">Manage Categories</h3>
              <button type="button" onClick={() => setCategoryModal(false)} className="text-gray-400 hover:text-gray-600">
                <i className="ph-bold ph-x" />
              </button>
            </div>
            <div className="p-6">
              <div className="mb-6 flex gap-2">
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  placeholder="New Category Name..."
                />
                <button
                  type="button"
                  onClick={addCategory}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
                >
                  Add
                </button>
              </div>
              <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {state.categories.map((cat) => (
                  <div key={cat} className="flex items-center justify-between rounded p-2 hover:bg-gray-50">
                    <span className="text-sm font-medium">{cat}</span>
                    {cat !== "General" && (
                      <button
                        type="button"
                        onClick={() => removeCategory(cat)}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <i className="ph-bold ph-trash" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* syncReady 仅用于提示，不渲染 UI */}
      <span className="hidden" data-sync={syncReady ? "1" : "0"} />
      <SyncConflicts
        app="expressing"
        onRestore={(item: SyncConflictItem) => {
          const local = item.local as unknown as ExpressDoc | null;
          if (!local) return;
          const copy: ExpressDoc = {
            ...local,
            id: generateId(),
            title: (local.title || "Untitled") + " · 恢复",
            updatedAt: Date.now(),
          };
          commit((prev) => ({
            ...prev,
            docs: [...prev.docs, copy],
            activeDocId: copy.id,
            ui: { ...prev.ui, globalMode: false },
          }));
        }}
      />
    </div>
  );
}
