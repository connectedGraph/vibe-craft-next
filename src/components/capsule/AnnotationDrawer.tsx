'use client';

import { useEffect, useRef } from 'react';
import { marked } from 'marked';
import type { Annotation } from '@/lib/tools/capsule';
import Icon from './Icon';

type Props = {
  open: boolean;
  annotations: Annotation[];
  mode: 'view' | 'note';
  editingId: string | null;
  selectedText: string;
  draft: string;
  focusId: string | null;
  sanitize: (html: string) => string;
  onChangeDraft: (v: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export default function AnnotationDrawer(props: Props) {
  const {
    open, annotations, mode, editingId, selectedText, draft, focusId, sanitize,
    onChangeDraft, onSave, onCancelEdit, onEdit, onDelete, onClose,
  } = props;
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !focusId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-note-id="${focusId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo-400', 'bg-indigo-50');
    const timer = setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-400', 'bg-indigo-50'), 1500);
    return () => clearTimeout(timer);
  }, [open, focusId]);

  const renderNote = (note: string) => sanitize(marked.parse(note || '', { breaks: true, gfm: true }) as string);

  return (
    <aside
      className={`fixed bottom-4 right-0 top-4 z-50 flex w-full max-w-[420px] flex-col rounded-l-2xl border border-white/70 bg-white/85 shadow-2xl backdrop-blur-xl transition-transform duration-300 sm:right-4 sm:rounded-2xl ${
        open ? 'translate-x-0' : 'translate-x-[110%]'
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-14 items-center justify-between rounded-t-2xl border-b border-white/60 bg-white/50 px-4">
        <h2 className="flex items-center gap-2 font-bold text-slate-800">
          <Icon name="notebook" className="h-4 w-4 text-indigo-500" /> Contextual Notes
        </h2>
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-white/70 hover:text-slate-700" aria-label="关闭标注面板">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      {mode === 'note' && (
        <div className={`border-b border-white/60 bg-indigo-50/60 p-4 backdrop-blur ${editingId || selectedText ? '' : 'hidden'}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">
              {editingId ? 'Editing Note' : 'Adding Note'}
            </span>
          </div>
          <div className="mb-2 rounded-lg border border-indigo-100 border-l-4 border-l-indigo-500 bg-white/90 p-3 text-sm font-medium italic text-slate-800">
            {selectedText}
          </div>
          <textarea
            value={draft}
            onChange={(e) => onChangeDraft(e.target.value)}
            rows={6}
            placeholder="Context-based explanation (Markdown supported)..."
            className="mb-2 w-full resize-none rounded-lg border border-white/70 bg-white/90 p-3 font-mono text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="flex justify-end gap-2">
            <button onClick={onCancelEdit} className="rounded-md border border-transparent px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-200 hover:bg-white">
              Cancel
            </button>
            <button onClick={onSave} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700">
              {editingId ? 'Update' : 'Save Note'}
            </button>
          </div>
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {annotations.length === 0 && (
          <div className="mt-10 text-center text-sm text-slate-400">
            {mode === 'note' ? 'Select text to add notes.' : 'No notes found.'}
          </div>
        )}
        {annotations.map((anno) => (
          <div
            key={anno.id}
            data-note-id={anno.id}
            className="group rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="max-w-[200px] truncate rounded border border-amber-200 bg-amber-100/80 px-2 py-0.5 text-xs font-bold text-amber-800">
                {anno.text}
              </span>
              {mode === 'note' && (
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => onEdit(anno.id)} className="rounded p-1 text-slate-400 hover:text-indigo-600" title="编辑标注">
                    <Icon name="pencil" className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => onDelete(anno.id)} className="rounded p-1 text-slate-400 hover:text-red-500" title="删除标注">
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="prose-capsule text-[13px]" dangerouslySetInnerHTML={{ __html: renderNote(anno.note) }} />
          </div>
        ))}
      </div>
    </aside>
  );
}
