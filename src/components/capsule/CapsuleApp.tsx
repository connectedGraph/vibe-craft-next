'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { useCapsuleSync, type Annotation, type CapsuleDoc } from './useSync';

const STORAGE_KEY = 'bri_app_pro_v2';
const DEFAULT_CATEGORIES = ['General', 'Vocabulary', 'Grammar', 'Reading', 'AI Agent'];

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function demoDoc(): CapsuleDoc {
  return {
    id: genId(),
    title: 'Welcome to Vibe Craft',
    category: 'General',
    tags: ['guide'],
    question: '### How to use Prompt Capsule?\n\nWrite a question or paste a conversation on top, and put the analysis below.',
    answer:
      'In **Note** mode you can select any text to add an annotation.\n\nTry selecting the word "annotation" in this sentence.\n\n> Data stays in your browser; the account is only used to sync between devices.',
    annotations: [],
    updatedAt: Date.now(),
  };
}

type Props = { username: string };

export default function CapsuleApp({ username }: Props) {
  const [docs, setDocs] = useState<CapsuleDoc[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [selection, setSelection] = useState('');
  const [sanitize, setSanitize] = useState<(html: string) => string>(() => (h: string) => h);
  const renderRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* ── 载入本地数据 ── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const list: CapsuleDoc[] = Array.isArray(parsed.docs) ? parsed.docs : [];
        setDocs(list);
        setCategories(Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : DEFAULT_CATEGORIES);
        setActiveId(parsed.activeDocId || list[0]?.id || null);
      } else {
        const d = demoDoc();
        setDocs([d]);
        setActiveId(d.id);
      }
    } catch {
      const d = demoDoc();
      setDocs([d]);
      setActiveId(d.id);
    }
    setLoaded(true);
  }, []);

  /* ── 持久化 ── */
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ docs, categories, activeDocId: activeId, ui: { mode: 'view' } }));
    } catch { /* 忽略 */ }
  }, [docs, categories, activeId, loaded]);

  useEffect(() => {
    import('dompurify').then(m => setSanitize(() => (h: string) => m.default.sanitize(h))).catch(() => {});
  }, []);

  const active = useMemo(() => docs.find(d => d.id === activeId) || null, [docs, activeId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs
      .filter(d => !categoryFilter || d.category === categoryFilter)
      .filter(d => !tagFilter || (d.tags || []).includes(tagFilter))
      .filter(d => !q || d.title.toLowerCase().includes(q) || d.question.toLowerCase().includes(q) || d.answer.toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [docs, search, categoryFilter, tagFilter]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) for (const t of d.tags || []) set.add(t);
    return [...set].sort();
  }, [docs]);

  const patchDoc = useCallback((id: string, patch: Partial<CapsuleDoc>) => {
    setDocs(prev => prev.map(d => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d)));
  }, []);

  const applyRemote = useCallback(({ upserts, deletes, categories: remoteCats }: {
    upserts: CapsuleDoc[];
    deletes: string[];
    categories: string[] | null;
  }) => {
    setDocs(prev => {
      let next = [...prev];
      for (const incoming of upserts) {
        const i = next.findIndex(d => d.id === incoming.id);
        if (i === -1) next.push(incoming);
        else if (Number(incoming.updatedAt || 0) >= Number(next[i].updatedAt || 0)) next[i] = incoming;
      }
      if (deletes.length) next = next.filter(d => !deletes.includes(d.id));
      return next;
    });
    if (remoteCats) setCategories(remoteCats);
  }, []);

  const onConflict = useCallback((local: CapsuleDoc) => {
    const copy: CapsuleDoc = {
      ...local,
      id: 'conflict-' + genId(),
      title: (local.title || 'Untitled') + ' · 冲突副本',
      updatedAt: Date.now(),
    };
    setDocs(prev => [...prev, copy]);
  }, []);

  const sync = useCapsuleSync({ docs, categories, applyRemote, onConflict, enabled: loaded });

  /* ── 渲染 Markdown + 标注 ── */
  const renderHtml = useCallback((md: string, annotations: Annotation[]) => {
    let html = marked.parse(md || '', { breaks: true, gfm: true }) as string;
    html = sanitize(html);
    const sorted = [...annotations].sort((a, b) => b.text.length - a.text.length);
    for (const anno of sorted) {
      if (!anno.text) continue;
      const parts = html.split(/(<[^>]+>)/g);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].startsWith('<') && parts[i].endsWith('>')) continue;
        if (parts[i].includes(anno.text)) {
          parts[i] = parts[i].replace(
            new RegExp(escapeReg(anno.text), 'g'),
            `<span class="bri-highlight" data-anno="${anno.id}">${anno.text}</span>`,
          );
        }
      }
      html = parts.join('');
    }
    return html;
  }, [sanitize]);

  const onMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !renderRef.current) { setSelection(''); return; }
    const text = sel.toString().trim();
    if (!text || text.length > 200) { setSelection(''); return; }
    const node = sel.anchorNode;
    if (node && renderRef.current.contains(node)) setSelection(text);
    else setSelection('');
  }, []);

  const addAnnotation = useCallback(() => {
    if (!active || !selection) return;
    const note = window.prompt(`为「${selection}」写一条笔记：`);
    if (!note) return;
    const annotation: Annotation = { id: genId(), text: selection, note };
    patchDoc(active.id, { annotations: [...(active.annotations || []), annotation] });
    setSelection('');
    window.getSelection()?.removeAllRanges();
  }, [active, selection, patchDoc]);

  const clickHighlight = useCallback((e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-anno]');
    if (!el || !active) return;
    const anno = (active.annotations || []).find(a => a.id === el.getAttribute('data-anno'));
    if (anno) window.alert(anno.note);
  }, [active]);

  const createDoc = useCallback(() => {
    const doc: CapsuleDoc = {
      id: genId(),
      title: '未命名文档',
      category: categories[0] || 'General',
      tags: [],
      question: '',
      answer: '',
      annotations: [],
      updatedAt: Date.now(),
    };
    setDocs(prev => [doc, ...prev]);
    setActiveId(doc.id);
    setMode('edit');
    setMobileSidebar(false);
  }, [categories]);

  const deleteDoc = useCallback(() => {
    if (!active) return;
    if (!window.confirm(`删除「${active.title || '未命名文档'}」？`)) return;
    setDocs(prev => prev.filter(d => d.id !== active.id));
    setActiveId(null);
    setMode('view');
  }, [active]);

  const exportFile = useCallback(() => {
    const blob = new Blob([JSON.stringify({ docs, categories, activeDocId: activeId, ui: { mode: 'view' } }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vibe-craft-${new Date().toISOString().slice(0, 10)}.bri`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [docs, categories, activeId]);

  const importFile = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming: CapsuleDoc[] = Array.isArray(parsed.docs) ? parsed.docs : [];
      let added = 0;
      let updated = 0;
      let skipped = 0;
      setDocs(prev => {
        const byId = new Map(prev.map(d => [d.id, d]));
        const next = [...prev];
        for (const doc of incoming) {
          if (!doc || !doc.id) { skipped++; continue; }
          const cur = byId.get(doc.id);
          if (!cur) { next.push(doc); byId.set(doc.id, doc); added++; }
          else if (Number(doc.updatedAt || 0) > Number(cur.updatedAt || 0)) {
            Object.assign(cur, doc);
            updated++;
          } else skipped++;
        }
        return next;
      });
      if (Array.isArray(parsed.categories)) {
        setCategories(prev => [...new Set([...prev, ...parsed.categories])].sort());
      }
      window.alert(`合并完成：新增 ${added}，更新 ${updated}，跳过 ${skipped}`);
    } catch {
      window.alert('文件格式不正确');
    }
  }, []);

  const statusText: Record<string, string> = {
    off: '同步未启用',
    idle: '已同步',
    syncing: '同步中…',
    error: '同步失败',
    'login-required': '需要登录',
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#eef1ff] text-slate-900">
      <style>{`
        /* 窄屏：侧栏改为覆盖式抽屉，桌面（≥1024px）保持原布局 */
        @media (max-width: 1023.98px) {
          #capsule-sidebar {
            position: fixed; top: 0; bottom: 0; left: 0; z-index: 60;
            width: 18rem !important; transform: translateX(-100%);
            transition: transform .3s ease; box-shadow: 0 24px 60px -20px rgba(15,23,42,.4);
          }
          #capsule-sidebar.mobile-open { transform: translateX(0); }
        }
      `}</style>
      {/* 侧栏 */}
      <aside id="capsule-sidebar" className={`${sidebarOpen ? 'w-72' : 'w-0'} ${mobileSidebar ? 'mobile-open' : ''} shrink-0 overflow-hidden border-r border-white/60 bg-white/45 backdrop-blur-xl transition-all duration-300`}>
        <div className="flex h-16 items-center justify-between border-b border-white/60 px-4">
          <div className="flex items-center gap-2.5 font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-sm text-white shadow-lg shadow-indigo-500/30">✦</span>
            Prompt Capsule
          </div>
          <button onClick={createDoc} className="grid h-8 w-8 place-items-center rounded-lg border border-white/70 bg-white/60 text-indigo-600 hover:bg-white" title="新建文档">＋</button>
        </div>

        <div className="space-y-2.5 border-b border-white/60 p-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索标题或内容…"
            className="w-full rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="flex gap-2">
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/70 bg-white/60 px-2 py-2 text-sm outline-none"
            >
              <option value="">全部分类</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/70 bg-white/60 px-2 py-2 text-sm outline-none"
            >
              <option value="">全部标签</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="h-[calc(100vh-16rem)] space-y-2 overflow-y-auto p-3">
          {filtered.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">没有匹配的文档</p>}
          {filtered.map(d => (
            <button
              key={d.id}
              onClick={() => { setActiveId(d.id); setMode('view'); setMobileSidebar(false); }}
              className={`w-full rounded-xl border p-3 text-left transition ${d.id === activeId ? 'border-indigo-200 bg-white shadow-sm' : 'border-transparent bg-white/40 hover:bg-white/70'}`}
            >
              <div className="truncate text-sm font-semibold text-slate-800">{d.title || '未命名文档'}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{d.category}</span>
                <span>{(d.annotations || []).length} 条标注</span>
              </div>
            </button>
          ))}
        </div>

        <div className="border-t border-white/60 p-3">
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="flex-1 rounded-lg border border-white/70 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white">导入</button>
            <button onClick={exportFile} className="flex-1 rounded-lg border border-white/70 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-white">导出</button>
          </div>
          <input ref={fileRef} type="file" accept=".bri,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
        </div>
      </aside>

      {mobileSidebar && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileSidebar(false)}
        />
      )}

      {/* 主区 */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-white/60 bg-white/40 px-3 py-2 backdrop-blur-xl lg:h-16 lg:flex-nowrap lg:gap-3 lg:px-4 lg:py-0">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              onClick={() => {
                setMobileSidebar((v) => !v);
                setSidebarOpen((v) => !v);
              }}
              aria-label="切换侧栏"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white/60 lg:h-8 lg:w-8"
              title="切换侧栏"
            >
              ☰
            </button>
            <h1 className="min-w-0 truncate text-lg font-bold">{active?.title || 'Prompt Capsule'}</h1>
            {active && <span className="hidden rounded bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600 sm:inline">{active.category}</span>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-slate-500 sm:flex">
              <span className={`h-2 w-2 rounded-full ${sync.status === 'idle' ? 'bg-emerald-400' : sync.status === 'syncing' ? 'animate-pulse bg-indigo-400' : sync.status === 'error' ? 'bg-red-400' : sync.status === 'login-required' ? 'bg-amber-400' : 'bg-slate-300'}`} />
              {statusText[sync.status]}
            </span>
            <button onClick={sync.syncNow} className="min-h-10 rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 lg:min-h-0">同步</button>
            <div className="flex rounded-xl border border-slate-200 bg-white/70 p-0.5">
              <button onClick={() => setMode('view')} className={`min-h-9 rounded-lg px-2.5 py-1 text-xs font-semibold lg:min-h-0 ${mode === 'view' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>查看</button>
              <button onClick={() => setMode('edit')} className={`min-h-9 rounded-lg px-2.5 py-1 text-xs font-semibold lg:min-h-0 ${mode === 'edit' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>编辑</button>
            </div>
            <button onClick={deleteDoc} className="min-h-10 rounded-lg px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 lg:min-h-0">删除</button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          {!active && (
            <div className="mx-auto mt-24 max-w-md text-center text-slate-400">
              <div className="mb-3 text-4xl">✦</div>
              <p className="text-sm">左侧还没有文档，点 + 新建一篇。</p>
            </div>
          )}

          {active && mode === 'view' && (
            <div className="mx-auto max-w-3xl space-y-6" ref={renderRef} onMouseUp={onMouseUp}>
              {selection && (
                <div className="sticky top-0 z-10 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
                  <span className="min-w-0 truncate text-slate-600">已选中：{selection}</span>
                  <button onClick={addAnnotation} className="ml-3 shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 font-semibold text-white">添加标注</button>
                </div>
              )}

              <section className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm">
                <div className="mb-3 text-[11px] font-bold uppercase tracking-widest text-indigo-400">Context / Question</div>
                <div className="prose-capsule" onClick={clickHighlight} dangerouslySetInnerHTML={{ __html: renderHtml(active.question, active.annotations) }} />
              </section>

              <section className="rounded-2xl border border-white/80 bg-white/75 p-6 shadow-sm">
                <div className="mb-3 text-[11px] font-bold uppercase tracking-widest text-emerald-500">Analysis / Answer</div>
                <div className="prose-capsule" onClick={clickHighlight} dangerouslySetInnerHTML={{ __html: renderHtml(active.answer, active.annotations) }} />
              </section>

              {(active.annotations || []).length > 0 && (
                <section className="rounded-2xl border border-white/80 bg-white/60 p-5">
                  <div className="mb-3 text-xs font-bold text-slate-600">标注（{(active.annotations || []).length}）</div>
                  <ul className="space-y-2">
                    {(active.annotations || []).map(a => (
                      <li key={a.id} className="break-words rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-base sm:text-sm">
                        <span className="font-semibold text-amber-700">{a.text}</span>
                        <span className="text-slate-600"> — {a.note}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {active && mode === 'edit' && (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">标题</span>
                  <input
                    value={active.title}
                    onChange={e => patchDoc(active.id, { title: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm outline-none focus:border-indigo-300"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">分类</span>
                  <select
                    value={active.category}
                    onChange={e => patchDoc(active.id, { category: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm outline-none"
                  >
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">标签（逗号分隔）</span>
                <input
                  value={(active.tags || []).join(', ')}
                  onChange={e => patchDoc(active.id, { tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) })}
                  className="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm outline-none focus:border-indigo-300"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Question / Context（Markdown）</span>
                <textarea
                  value={active.question}
                  onChange={e => patchDoc(active.id, { question: e.target.value })}
                  rows={8}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-indigo-300"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Answer / Analysis（Markdown）</span>
                <textarea
                  value={active.answer}
                  onChange={e => patchDoc(active.id, { answer: e.target.value })}
                  rows={14}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-indigo-300"
                />
              </label>
              <button onClick={() => setMode('view')} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25">
                完成
              </button>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-white/60 bg-white/40 px-4 py-2 text-[11px] text-slate-400">
          <span>{username} · 本地存储 + 云端同步</span>
          <span>{sync.error ? sync.error : sync.lastSyncAt ? `上次同步 ${new Date(sync.lastSyncAt).toLocaleTimeString()}` : ''}</span>
        </footer>
      </main>
    </div>
  );
}
