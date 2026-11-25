'use client';

import type { CapsuleDoc } from '@/lib/tools/capsule';
import Icon from './Icon';

type Props = {
  docs: CapsuleDoc[];
  onOpen: (id: string) => void;
  onCreate: () => void;
};

function snippet(text: string): string {
  const plain = (text || '').replace(/[#*`]/g, '').trim();
  return plain.length > 100 ? `${plain.slice(0, 100)}...` : plain;
}

export default function LibraryGrid({ docs, onOpen, onCreate }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-end justify-between border-b border-white/30 pb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">Library</h2>
            <p className="mt-1 text-sm text-slate-500">
              Showing {docs.length} result{docs.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 grid h-16 w-16 place-items-center rounded-full border border-white bg-white/60 text-3xl text-slate-400 shadow-sm">
              <Icon name="search" className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-medium text-slate-900">No documents found</h3>
            <button
              onClick={onCreate}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700"
            >
              Start New Topic
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 pb-20 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {docs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => onOpen(doc.id)}
                className="glass-card group relative flex h-64 flex-col overflow-hidden p-6 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
              >
                <span className="absolute left-0 top-0 h-full w-1 bg-indigo-500 opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="mb-2 flex items-start justify-between">
                  <span className="rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-600 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-600">
                    {doc.category}
                  </span>
                </div>
                {(doc.tags || []).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1">
                    {(doc.tags || []).slice(0, 3).map((t) => (
                      <span key={t} className="rounded border border-slate-100 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
                <h3 className="mb-2 line-clamp-2 text-lg font-bold leading-tight text-slate-800 transition-colors group-hover:text-indigo-600">
                  {doc.title || "Untitled"}
                </h3>
                <p className="flex-1 overflow-hidden text-sm leading-relaxed text-slate-500">
                  {snippet(doc.question) || <span className="italic text-slate-300">Empty content</span>}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-400">
                  <span className={(doc.annotations || []).length > 0 ? "flex items-center gap-1 font-medium text-indigo-500" : "flex items-center gap-1"}>
                    <Icon name="notebook" className="h-3.5 w-3.5" /> {(doc.annotations || []).length} Notes
                  </span>
                  <span className="font-semibold text-indigo-500 opacity-0 transition-opacity group-hover:opacity-100">Open →</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
