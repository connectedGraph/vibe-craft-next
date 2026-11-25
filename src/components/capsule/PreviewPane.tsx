'use client';

import { useCallback, useMemo, useRef } from 'react';
import { marked } from 'marked';
import { wrapAnnotations, type CapsuleDoc } from '@/lib/tools/capsule';

declare global {
  interface Window {
    katex?: {
      renderToString(tex: string, opts?: Record<string, unknown>): string;
    };
  }
}

export type SelectionInfo = { text: string; top: number; left: number } | null;

type Props = {
  doc: CapsuleDoc;
  mode: 'view' | 'note';
  sanitize: (html: string) => string;
  katexReady: boolean;
  onSelect: (sel: SelectionInfo) => void;
  onHighlight: (id: string) => void;
};

function renderMath(html: string): string {
  const katex = typeof window !== 'undefined' ? window.katex : undefined;
  if (!katex) return html;
  let out = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula: string) => {
    try {
      return katex.renderToString(String(formula).trim(), { displayMode: true, throwOnError: false });
    } catch {
      return `<span class="text-red-500">${match}</span>`;
    }
  });
  out = out.replace(/\$([^$]*?)\$/g, (match, formula: string) => {
    if (match.includes('class="katex"')) return match;
    try {
      return katex.renderToString(String(formula).trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<span class="text-red-500">${match}</span>`;
    }
  });
  return out;
}

function renderMarkdown(md: string, sanitize: (h: string) => string, katexReady: boolean): string {
  if (!md) return '';
  const raw = marked.parse(md, { breaks: true, gfm: true }) as string;
  const safe = sanitize(raw);
  return katexReady ? renderMath(safe) : safe;
}

export default function PreviewPane({ doc, mode, sanitize, katexReady, onSelect, onHighlight }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const questionHtml = useMemo(
    () => wrapAnnotations(renderMarkdown(doc.question || '', sanitize, katexReady), doc.annotations || []),
    [doc.question, doc.annotations, sanitize, katexReady],
  );
  const answerHtml = useMemo(
    () => wrapAnnotations(renderMarkdown(doc.answer || '', sanitize, katexReady), doc.annotations || []),
    [doc.answer, doc.annotations, sanitize, katexReady],
  );

  const handleSelection = useCallback(() => {
    if (mode !== 'note') return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!sel || sel.isCollapsed || !text || !containerRef.current) {
      onSelect(null);
      return;
    }
    if (!containerRef.current.contains(sel.anchorNode)) {
      onSelect(null);
      return;
    }
    if (text.length > 200) {
      onSelect(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    onSelect({ text, top: rect.top, left: rect.left + rect.width / 2 });
  }, [mode, onSelect]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = (e.target as HTMLElement).closest('[data-anno]');
      if (!el) return;
      const id = el.getAttribute('data-anno');
      if (id) onHighlight(id);
    },
    [onHighlight],
  );

  return (
    <div className="flex-1 overflow-y-auto" onMouseUp={handleSelection} onKeyUp={handleSelection}>
      {mode === 'note' && (
        <div className="sticky top-3 z-10 mx-auto flex w-fit items-center gap-2 rounded-full border border-amber-200 bg-amber-100/90 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-amber-800 shadow-lg backdrop-blur">
          标注模式 · 选中文字添加笔记
        </div>
      )}
      <div ref={containerRef} className="mx-auto w-full max-w-3xl px-4 pb-32 pt-6 sm:px-8 sm:pt-10">
        <section className="glass-card relative p-5 sm:p-8">
          <div className="absolute -left-3 bottom-8 top-8 w-1.5 rounded-full bg-gradient-to-b from-indigo-400 to-purple-400 opacity-60" />
          <div className="mb-4 flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-sm text-indigo-600">?</span>
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Context / Question</h2>
          </div>
          {questionHtml ? (
            <div
              className="prose-capsule max-w-none select-text"
              onClick={handleClick}
              dangerouslySetInnerHTML={{ __html: questionHtml }}
            />
          ) : (
            <p className="italic text-slate-400">No context provided.</p>
          )}
        </section>

        <section className="glass-card mt-6 border-t-4 border-t-emerald-400/30 p-5 sm:p-8">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-sm text-emerald-600">!</span>
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Analysis / Answer</h2>
          </div>
          {answerHtml ? (
            <div
              className="prose-capsule max-w-none select-text"
              onClick={handleClick}
              dangerouslySetInnerHTML={{ __html: answerHtml }}
            />
          ) : (
            <p className="italic text-slate-400">No analysis provided.</p>
          )}
        </section>

        <p className="mt-16 border-t border-slate-200/50 pt-8 text-center text-sm text-slate-400">
          Generated by Bri.Learn
        </p>
      </div>
    </div>
  );
}
