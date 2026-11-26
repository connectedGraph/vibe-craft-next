'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import {
  addCategory as addCategoryTo,
  allTags,
  applyRemoteState,
  backupKeyNow,
  deleteCategory as deleteCategoryFrom,
  exportMarkdownText,
  filterDocs,
  genId,
  loadState,
  mergeImport,
  renameCategory as renameCategoryIn,
  saveState,
  type CapsuleDoc,
  type CapsuleMode,
  type CapsuleState,
} from '@/lib/tools/capsule';
import { useCapsuleSync } from './useSync';
import PreviewPane, { type SelectionInfo } from './PreviewPane';
import EditorPane from './EditorPane';
import LibraryGrid from './LibraryGrid';
import AnnotationDrawer from './AnnotationDrawer';
import CategoryModal from './CategoryModal';
import SyncModal from './SyncModal';
import HistoryModal from './HistoryModal';
import Icon, { type IconName } from './Icon';

type Props = { username: string };

const STATUS_TEXT: Record<string, string> = {
  off: 'Cloud Sync Off',
  idle: 'Synced',
  syncing: 'Syncing…',
  error: 'Sync Error',
  'login-required': 'Sign in to Sync',
};

export default function CapsuleApp({ username }: Props) {
  const [state, setState] = useState<CapsuleState>(() => ({
    docs: [],
    activeDocId: null,
    categories: [],
    ui: {
      mode: 'view',
      globalMode: false,
      sidebarOpen: true,
      searchQuery: '',
      searchCategory: '',
      searchTag: '',
      deepSearch: false,
      zenMode: false,
    },
    __categoriesUpdatedAt: 0,
  }));
  const [loaded, setLoaded] = useState(false);
  const [sanitize, setSanitize] = useState<(html: string) => string>(() => (h: string) => h);
  const [katexReady, setKatexReady] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [selection, setSelection] = useState<SelectionInfo>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [editingText, setEditingText] = useState('');
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState('');

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── 初始化：读本地数据 / 窄屏收起侧栏（只在挂载时跑一次） ── */
  useEffect(() => {
    const next = loadState();
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      next.ui = { ...next.ui, sidebarOpen: false };
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 一次性本地数据水合，没有外部订阅可挂
    setState(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    import('dompurify')
      .then((m) => setSanitize(() => (h: string) => m.default.sanitize(h)))
      .catch(() => {});
    fetch('/api/v1/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setIsAdmin(d?.user?.role === 'admin'))
      .catch(() => {});
  }, []);

  /* ── 持久化（400ms 防抖，避免每次按键都写盘） ── */
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const snapshot = stateRef.current;
    saveTimer.current = setTimeout(() => saveState(snapshot), 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, loaded]);

  /* ── 跨标签页同步本地数据，保留当前 ui ── */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'bri_app_pro_v2') return;
      const next = loadState();
      next.ui = stateRef.current.ui;
      setState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const active = useMemo(
    () => state.docs.find((d) => d.id === state.activeDocId) || null,
    [state.docs, state.activeDocId],
  );

  const filtered = useMemo(
    () =>
      filterDocs(state.docs, {
        query: state.ui.searchQuery,
        category: state.ui.searchCategory,
        tag: state.ui.searchTag,
        deep: state.ui.deepSearch,
      }),
    [state.docs, state.ui.searchQuery, state.ui.searchCategory, state.ui.searchTag, state.ui.deepSearch],
  );

  const tags = useMemo(() => allTags(state.docs), [state.docs]);


  const patchUI = useCallback((ui: Partial<CapsuleState['ui']>) => {
    setState((prev) => ({ ...prev, ui: { ...prev.ui, ...ui } }));
  }, []);

  const patchDoc = useCallback((id: string, changes: Partial<CapsuleDoc>) => {
    setState((prev) => ({
      ...prev,
      docs: prev.docs.map((d) =>
        d.id === id ? { ...d, ...changes, updatedAt: changes.updatedAt ?? Date.now() } : d,
      ),
    }));
  }, []);

  /* ── 云同步 ── */
  const applyRemote = useCallback(
    ({ upserts, deletes, categories }: { upserts: CapsuleDoc[]; deletes: string[]; categories: string[] | null }) => {
      setState((prev) => {
        const changes = [
          ...upserts.map((data) => ({ id: data.id, data })),
          ...deletes.map((id) => ({ id, op: 'delete' })),
        ];
        const next = applyRemoteState(prev, changes).state;
        return categories ? { ...next, categories, __categoriesUpdatedAt: Date.now() } : next;
      });
    },
    [],
  );

  const onConflict = useCallback((local: CapsuleDoc) => {
    const copy: CapsuleDoc = {
      ...local,
      id: 'conflict-' + genId(),
      title: (local.title || 'Untitled') + ' · 冲突副本',
      updatedAt: Date.now(),
    };
    setState((prev) => ({ ...prev, docs: [...prev.docs, copy] }));
  }, []);

  const sync = useCapsuleSync({
    docs: state.docs,
    categories: state.categories,
    applyRemote,
    onConflict,
    enabled: loaded,
  });

  /* ── 文档操作 ── */
  const createDoc = useCallback(() => {
    const doc: CapsuleDoc = {
      id: genId(),
      title: 'New Note',
      category: state.categories.includes('General') ? 'General' : state.categories[0] || 'General',
      tags: [],
      question: '',
      answer: '',
      annotations: [],
      updatedAt: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      docs: [doc, ...prev.docs],
      activeDocId: doc.id,
      ui: { ...prev.ui, mode: 'edit', globalMode: false },
    }));
    setMobileSidebar(false);
  }, [state.categories]);

  const openDoc = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      activeDocId: id,
      docs: prev.docs.map((d) =>
        d.id === id && !prev.categories.includes(d.category) ? { ...d, category: 'General' } : d,
      ),
      ui: { ...prev.ui, globalMode: false },
    }));
    setMobileSidebar(false);
    setSelection(null);
    setDrawerOpen(false);
  }, []);

  const deleteDoc = useCallback(() => {
    const doc = stateRef.current.docs.find((d) => d.id === stateRef.current.activeDocId);
    if (!doc) return;
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    setState((prev) => {
      const docs = prev.docs.filter((d) => d.id !== prev.activeDocId);
      if (docs.length === 0) {
        // 与旧版一致：删掉最后一篇时自动新建一篇，避免停在空编辑区
        const fresh: CapsuleDoc = {
          id: genId(),
          title: 'New Note',
          category: 'General',
          tags: [],
          question: '',
          answer: '',
          annotations: [],
          updatedAt: Date.now(),
        };
        return { ...prev, docs: [fresh], activeDocId: fresh.id, ui: { ...prev.ui, mode: 'edit', globalMode: false } };
      }
      return { ...prev, docs, activeDocId: docs[0]?.id ?? null };
    });
    setSelection(null);
    setDrawerOpen(false);
  }, []);

  const setMode = useCallback((mode: CapsuleMode) => {
    setState((prev) => ({ ...prev, ui: { ...prev.ui, mode, globalMode: false } }));
    setSelection(null);
    setEditingAnnotationId(null);
    setAnnotationDraft('');
    setDrawerOpen(false);
  }, []);

  /* ── 标注 ── */
  const startAnnotation = useCallback(() => {
    if (!selection) return;
    setEditingAnnotationId(null);
    setEditingText(selection.text);
    setAnnotationDraft('');
    setDrawerOpen(true);
    setSelection(null);
  }, [selection]);

  const editAnnotation = useCallback(
    (id: string) => {
      const anno = (active?.annotations || []).find((a) => a.id === id);
      if (!anno) return;
      setEditingAnnotationId(id);
      setEditingText(anno.text);
      setAnnotationDraft(anno.note);
      setDrawerOpen(true);
    },
    [active],
  );

  const saveAnnotation = useCallback(() => {
    if (!active || !annotationDraft.trim()) return;
    setState((prev) => ({
      ...prev,
      docs: prev.docs.map((d) => {
        if (d.id !== active.id) return d;
        const annotations = editingAnnotationId
          ? (d.annotations || []).map((a) => (a.id === editingAnnotationId ? { ...a, note: annotationDraft } : a))
          : [...(d.annotations || []), { id: genId(), text: editingText, note: annotationDraft }];
        return { ...d, annotations, updatedAt: Date.now() };
      }),
    }));
    setEditingAnnotationId(null);
    setAnnotationDraft('');
    setEditingText('');
  }, [active, annotationDraft, editingAnnotationId, editingText]);

  const deleteAnnotation = useCallback(
    (id: string) => {
      if (!active) return;
      setState((prev) => ({
        ...prev,
        docs: prev.docs.map((d) =>
          d.id === active.id
            ? { ...d, annotations: (d.annotations || []).filter((a) => a.id !== id), updatedAt: Date.now() }
            : d,
        ),
      }));
      if (editingAnnotationId === id) {
        setEditingAnnotationId(null);
        setAnnotationDraft('');
      }
    },
    [active, editingAnnotationId],
  );

  const handleHighlight = useCallback(
    (id: string) => {
      if (stateRef.current.ui.mode === 'note') {
        editAnnotation(id);
      } else {
        setDrawerOpen(true);
        setFocusNoteId(null);
        requestAnimationFrame(() => setFocusNoteId(id));
      }
    },
    [editAnnotation],
  );

  /* ── 分类 ── */
  const handleAddCategory = useCallback((name: string) => {
    const res = addCategoryTo(stateRef.current, name);
    setCategoryError(res.error || '');
    if (!res.error) setState(res.state);
  }, []);

  const handleRenameCategory = useCallback((from: string, to: string) => {
    const res = renameCategoryIn(stateRef.current, from, to);
    setCategoryError(res.error || '');
    if (!res.error && res.state !== stateRef.current) setState(res.state);
  }, []);

  const handleDeleteCategory = useCallback((name: string) => {
    if (!window.confirm(`Delete category "${name}"? \n\nFiles in this category will be moved to "General".`)) return;
    setState((prev) => deleteCategoryFrom(prev, name));
  }, []);

  /* ── 导入 / 导出 ── */
  const exportBri = useCallback(() => {
    const data = JSON.stringify(stateRef.current, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bri-library-v2-${new Date().toISOString().slice(0, 10)}.bri`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }, []);

  const importBri = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.docs)) throw new Error('no docs');
      const backupKey = backupKeyNow();
      try {
        window.localStorage.setItem(backupKey, JSON.stringify(stateRef.current));
      } catch {
        /* 存储满时仍然允许导入，只是不留备份 */
      }
      const res = mergeImport(stateRef.current, parsed);
      setState(res.state);
      window.alert(
        `合并完成：新增 ${res.added} 篇，更新 ${res.updated} 篇，跳过 ${res.skipped} 篇。\n导入前的数据已备份到 localStorage（${backupKey}）。`,
      );
    } catch {
      window.alert('Invalid file.');
    }
  }, []);

  const exportMarkdown = useCallback(() => {
    const doc = stateRef.current.docs.find((d) => d.id === stateRef.current.activeDocId);
    if (!doc) return;
    const md = exportMarkdownText(doc);
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.title || 'untitled').replace(/\s+/g, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }, []);

  const restoreConflict = useCallback((local: CapsuleDoc) => {
    const copy: CapsuleDoc = {
      ...local,
      id: 'restored-' + genId(),
      title: (local.title || 'Untitled') + ' · 恢复',
      updatedAt: Date.now(),
    };
    setState((prev) => ({ ...prev, docs: [...prev.docs, copy] }));
    sync.clearConflicts();
    void sync.syncNow();
  }, [sync]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 2500);
  }, []);

  /* ── 渲染 ── */
  const mode = state.ui.mode;
  const globalMode = state.ui.globalMode;
  const zenMode = state.ui.zenMode;
  const sidebarVisible = state.ui.sidebarOpen;

  return (
    <div className={`capsule-root relative flex h-screen overflow-hidden text-slate-800 ${zenMode ? 'is-zen' : ''}`}>
      <Script
        src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"
        strategy="afterInteractive"
        onLoad={() => setKatexReady(true)}
      />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />

      <div className="ambient-light" aria-hidden>
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      {/* 侧栏 */}
      <aside
        id="capsule-sidebar"
        className={`${sidebarVisible ? 'lg:w-80' : 'lg:w-0'} ${mobileSidebar ? 'mobile-open' : ''} z-30 flex w-80 shrink-0 flex-col overflow-hidden border-r border-white/60 bg-white/75 backdrop-blur-xl transition-all duration-300 ${zenMode ? 'lg:w-0' : ''}`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/50 px-5">
          <div className="flex select-none items-center gap-3 text-lg font-bold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/30">
              <Icon name="logo" className="h-5 w-5" />
            </span>
            Prompt Capsule
          </div>
          <button
            onClick={createDoc}
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/60 bg-white/50 text-indigo-600 shadow-sm transition hover:bg-white"
            title="New Document"
          >
            <Icon name="plus" className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 space-y-2.5 border-b border-white/50 p-4">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={state.ui.searchQuery}
              onChange={(e) => patchUI({ searchQuery: e.target.value })}
              placeholder="Search topics..."
              className="w-full rounded-xl border border-white/60 bg-white/40 py-2.5 pl-9 pr-3 text-sm outline-none backdrop-blur transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <select
                value={state.ui.searchCategory}
                onChange={(e) => patchUI({ searchCategory: e.target.value })}
                className="w-full appearance-none rounded-xl border border-white/60 bg-white/40 py-2 pl-3 pr-8 text-sm text-slate-600 outline-none backdrop-blur focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">All Categories</option>
                {state.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
            </div>
            <button
              onClick={() => { setCategoryModalOpen(true); setCategoryError(''); }}
              className="rounded-xl border border-white/60 bg-white/40 px-2.5 py-1.5 text-slate-500 shadow-sm backdrop-blur transition hover:bg-white hover:text-indigo-600"
              title="Manage Categories"
            >
              <Icon name="gear" className="h-4 w-4" />
            </button>
          </div>
          <div className="relative">
            <select
              value={state.ui.searchTag}
              onChange={(e) => patchUI({ searchTag: e.target.value })}
              className="w-full appearance-none rounded-xl border border-white/60 bg-white/40 py-2 pl-8 pr-8 text-sm text-slate-600 outline-none backdrop-blur focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">All Tags</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <Icon name="tag" className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
            <Icon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          </div>
          <label className="flex select-none items-center gap-2 pl-1 text-[11px] text-slate-500">
            <input
              type="checkbox"
              checked={state.ui.deepSearch}
              onChange={(e) => patchUI({ deepSearch: e.target.checked })}
              className="rounded border-slate-300"
            />
            同时搜索正文
          </label>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {filtered.length === 0 && <div className="py-4 text-center text-xs text-slate-400">No results found.</div>}
          {filtered.map((doc) => {
            const isActive = doc.id === state.activeDocId && !globalMode;
            return (
              <button
                key={doc.id}
                onClick={() => openDoc(doc.id)}
                className={`group w-full rounded-xl border p-3 text-left transition-all ${
                  isActive
                    ? 'border-white bg-white shadow-sm ring-1 ring-indigo-100'
                    : 'border-transparent bg-transparent hover:border-white/40 hover:bg-white/40'
                }`}
              >
                <div className={`mb-1 flex items-start justify-between ${isActive ? 'text-indigo-600' : 'text-slate-700'}`}>
                  <span className="flex-1 truncate pr-2 text-sm font-medium">{doc.title || 'Untitled'}</span>
                </div>
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      isActive ? 'border border-indigo-100 bg-indigo-50 text-indigo-600' : 'bg-slate-100/60 text-slate-500'
                    }`}
                  >
                    {doc.category}
                  </span>
                  <span className="ml-auto text-[10px] text-slate-400">
                    {new Date(doc.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </div>
                {(doc.tags || []).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(doc.tags || []).map((t) => (
                      <span key={t} className="rounded-md border border-white/50 bg-white/60 px-1.5 py-0.5 text-[9px] text-slate-500">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="shrink-0 border-t border-white/50 bg-white/30 p-4 backdrop-blur">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-lg border border-white/60 bg-white/50 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white hover:shadow-sm"
            >
              <Icon name="upload" className="h-3.5 w-3.5" /> Import
            </button>
            <button
              onClick={exportBri}
              className="flex items-center justify-center gap-2 rounded-lg border border-white/60 bg-white/50 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white hover:shadow-sm"
            >
              <Icon name="download" className="h-3.5 w-3.5" /> Save
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".bri,.json,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBri(f);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => setSyncModalOpen(true)}
            title={
              sync.user
                ? `账号：${sync.user}${sync.lastSyncAt ? ` · 上次同步 ${new Date(sync.lastSyncAt).toLocaleTimeString()}` : ''}`
                : sync.error || (sync.lastSyncAt ? `上次同步 ${new Date(sync.lastSyncAt).toLocaleTimeString()}` : '')
            }
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/60 bg-white/50 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white hover:shadow-sm"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                sync.status === 'idle'
                  ? 'bg-emerald-400'
                  : sync.status === 'syncing'
                    ? 'animate-pulse bg-indigo-400'
                    : sync.status === 'error'
                      ? 'bg-red-400'
                      : sync.status === 'login-required'
                        ? 'bg-amber-400'
                        : 'bg-slate-300'
              }`}
            />
            {STATUS_TEXT[sync.status] || sync.status}
          </button>
          {username ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-white/60 bg-white/40 px-3 py-1.5 text-[11px] text-slate-500">
              <span className="min-w-0 truncate">
                账号 <b className="font-semibold text-slate-700">{username}</b>
                {isAdmin ? ' · 管理员' : ''}
              </span>
              <button
                onClick={() => void sync.logout()}
                className="shrink-0 font-semibold text-slate-500 transition hover:text-red-500"
              >
                退出登录
              </button>
            </div>
          ) : (
            <a
              href="/login?next=/prompt-capsule"
              className="mt-2 flex items-center justify-center rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-1.5 text-[11px] font-semibold text-indigo-600 transition hover:bg-indigo-50"
            >
              登录后同步
            </a>
          )}
        </div>
      </aside>

      {mobileSidebar && (
        <div className="fixed inset-0 z-20 bg-slate-900/40 backdrop-blur-[1px] lg:hidden" onClick={() => setMobileSidebar(false)} />
      )}

      {/* 主区 */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header
          className={`glass-header z-20 flex shrink-0 flex-col transition-all duration-500 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-0 ${zenMode ? 'pointer-events-none -translate-y-full opacity-0' : ''}`}
        >
          <div className="flex min-w-0 items-center gap-1.5 px-2 pt-2 sm:gap-2 lg:flex-1 lg:px-0 lg:pt-0">
            <button
              onClick={() => {
                if (window.innerWidth < 1024) setMobileSidebar((v) => !v);
                else patchUI({ sidebarOpen: !sidebarVisible });
              }}
              aria-label="切换侧栏"
              className="-ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-indigo-50/60 hover:text-indigo-600 lg:h-9 lg:w-9"
              title="Toggle Sidebar"
            >
              <Icon name="menu" className="h-5 w-5" />
            </button>

            {globalMode && (
              <button
                onClick={() => patchUI({ globalMode: false })}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-white/60 hover:text-slate-800 lg:h-9 lg:w-9"
                title="Back to Editor"
              >
                <Icon name="arrowLeft" className="h-5 w-5" />
              </button>
            )}

            {globalMode ? (
              <div className="flex min-w-0 items-center gap-2 text-base font-bold text-slate-700 lg:gap-3 lg:text-lg">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-indigo-100 text-indigo-600">
                  <Icon name="grid" className="h-4 w-4" />
                </span>
                <span className="truncate">Library Explorer</span>
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                <input
                  value={active?.title || ''}
                  onChange={(e) => active && patchDoc(active.id, { title: e.target.value })}
                  placeholder="Untitled Document"
                  className="w-full truncate border-none bg-transparent text-base font-bold tracking-tight text-slate-800 outline-none placeholder:text-slate-300 lg:text-xl"
                />
                {active && (
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-slate-400">
                    <span className="shrink-0 rounded border border-slate-200/50 bg-slate-100/60 px-2 py-0.5 text-slate-600">{active.category}</span>
                    <span className="hidden shrink-0 items-center gap-1 md:flex">
                      {(active.tags || []).map((t) => (
                        <span key={t} className="rounded-md border border-white bg-white/50 px-1.5 py-0.5 text-[10px] text-slate-500">
                          #{t}
                        </span>
                      ))}
                    </span>
                    <span className="hidden h-1 w-1 shrink-0 rounded-full bg-slate-300 md:block" />
                    <span className="truncate">Last edited {new Date(active.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 overflow-x-auto px-2 pb-2 pt-1.5 lg:shrink-0 lg:gap-3 lg:overflow-visible lg:px-0 lg:pb-0 lg:pt-0">
            {!globalMode && (
              <div className="flex shrink-0 rounded-xl border border-white/60 bg-slate-100/50 p-1 backdrop-blur">
                {([
                  ['view', 'View', 'book'],
                  ['note', 'Note', 'highlighter'],
                  ['edit', 'Edit', 'pencil'],
                ] as const).map(([key, label, icon]) => (
                  <button
                    key={key}
                    onClick={() => setMode(key)}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all sm:px-2.5 sm:text-sm ${
                      mode === key ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:bg-white/40 hover:text-slate-900'
                    }`}
                  >
                    <Icon name={icon as IconName} className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="hidden h-6 w-px shrink-0 bg-slate-200/60 lg:block" />

            {!globalMode && (
              <button
                onClick={() => { patchUI({ globalMode: true }); setDrawerOpen(false); }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-white/50 hover:text-indigo-600"
                title="Library View"
              >
                <Icon name="grid" className="h-5 w-5" />
              </button>
            )}

            {!globalMode && (
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => patchUI({ zenMode: true })}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/50 hover:text-indigo-600"
                  title="Zen Mode (Focus)"
                >
                  <Icon name="expand" className="h-5 w-5" />
                </button>
                <button
                  onClick={exportMarkdown}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/50 hover:text-slate-700"
                  title="Export Hyperlinked Markdown"
                >
                  <Icon name="fileText" className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setHistoryOpen(true)}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/50 hover:text-indigo-600"
                  title="Version History"
                >
                  <Icon name="clock" className="h-5 w-5" />
                </button>
                <button
                  onClick={deleteDoc}
                  className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50/50 hover:text-red-600"
                  title="Delete Document"
                >
                  <Icon name="trash" className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </header>

        {globalMode ? (
          <LibraryGrid docs={filtered} onOpen={openDoc} onCreate={createDoc} />
        ) : !active ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
            <div className="mb-3 text-4xl">✦</div>
            <p className="mb-4 text-sm">还没有文档。</p>
            <button onClick={createDoc} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-200">
              新建文档
            </button>
          </div>
        ) : mode === 'edit' ? (
          <EditorPane
            doc={active}
            categories={state.categories}
            onChange={(changes) => patchDoc(active.id, changes)}
            onManageCategories={() => { setCategoryModalOpen(true); setCategoryError(''); }}
          />
        ) : (
          <PreviewPane
            doc={active}
            mode={mode}
            sanitize={sanitize}
            katexReady={katexReady}
            onSelect={setSelection}
            onHighlight={handleHighlight}
          />
        )}

        {/* 选中文字后的浮动按钮 */}
        {mode === 'note' && selection && !zenMode && (
          <button
            onClick={startAnnotation}
            style={{ top: Math.max(12, selection.top - 56), left: selection.left }}
            className="fixed z-[60] -translate-x-1/2 rounded-full border border-white/10 bg-slate-800/90 px-4 py-2 text-sm font-semibold text-white shadow-xl backdrop-blur transition hover:bg-slate-900"
          >
            <Icon name="highlighter" className="mr-1.5 h-4 w-4 text-yellow-400" /> Annotate Text
          </button>
        )}

        {zenMode && (
          <button
            onClick={() => patchUI({ zenMode: false })}
            className="fixed bottom-8 right-8 z-40 flex items-center gap-2 rounded-full border border-white bg-white/85 px-4 py-2 text-sm font-bold text-slate-600 shadow-lg backdrop-blur transition hover:text-indigo-600"
          >
            <Icon name="cornersIn" className="h-4 w-4" /> Exit Focus
          </button>
        )}
      </main>

      <AnnotationDrawer
        open={drawerOpen && !!active}
        annotations={active?.annotations || []}
        mode={mode === 'note' ? 'note' : 'view'}
        editingId={editingAnnotationId}
        selectedText={editingText}
        draft={annotationDraft}
        focusId={focusNoteId}
        sanitize={sanitize}
        onChangeDraft={setAnnotationDraft}
        onSave={saveAnnotation}
        onCancelEdit={() => { setEditingAnnotationId(null); setAnnotationDraft(''); setEditingText(''); }}
        onEdit={editAnnotation}
        onDelete={deleteAnnotation}
        onClose={() => { setDrawerOpen(false); setEditingAnnotationId(null); setAnnotationDraft(''); }}
      />

      <CategoryModal
        open={categoryModalOpen}
        categories={state.categories}
        error={categoryError}
        onAdd={handleAddCategory}
        onRename={handleRenameCategory}
        onDelete={handleDeleteCategory}
        onClose={() => { setCategoryModalOpen(false); setCategoryError(''); }}
      />

      <SyncModal
        key={syncModalOpen ? 'sync-open' : 'sync-closed'}
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        status={sync.status}
        user={sync.user || (username ? username : null)}
        isAdmin={isAdmin}
        errorText={sync.error}
        lastSyncAt={sync.lastSyncAt}
        conflicts={sync.conflicts}
        config={sync.config}
        accountMode={sync.accountMode}
        onSaveConfig={sync.saveConfig}
        onLogout={() => void sync.logout()}
        onClearConflicts={sync.clearConflicts}
        onRestoreConflict={restoreConflict}
        onSyncNow={async () => { await sync.syncNow(); }}
        onTest={sync.testConnection}
        onPullAll={async () => { await sync.pullAll(); }}
      />

      <HistoryModal
        open={historyOpen}
        doc={active}
        onClose={() => setHistoryOpen(false)}
        onRestored={async () => { await sync.pullAll(); showToast('已从云端恢复'); }}
      />

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-full bg-slate-800/90 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
