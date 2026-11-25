'use client';

import type { CapsuleDoc } from '@/lib/tools/capsule';

type Props = {
  doc: CapsuleDoc;
  categories: string[];
  onChange: (patch: Partial<CapsuleDoc>) => void;
  onManageCategories: () => void;
};

export default function EditorPane({ doc, categories, onChange, onManageCategories }: Props) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-5 px-4 pb-32 pt-5 sm:px-8">
        <div className="glass-card grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Category</label>
            <div className="relative">
              <select
                value={doc.category}
                onChange={(e) => onChange({ category: e.target.value })}
                className="w-full appearance-none rounded-lg border border-white bg-white/60 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-1 focus:ring-indigo-200"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">▾</span>
            </div>
            <button type="button" onClick={onManageCategories} className="block w-full text-right text-[10px] text-slate-400 hover:text-indigo-600">
              + Manage Categories
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>Tags</span>
              <span className="text-[10px] font-normal normal-case">Comma separated</span>
            </label>
            <input
              value={(doc.tags || []).join(', ')}
              onChange={(e) =>
                onChange({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
              }
              placeholder="Add tags..."
              className="w-full rounded-lg border border-white bg-white/60 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-1 focus:ring-indigo-200"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="ml-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <span className="text-indigo-500">?</span> Question / Context (Markdown)
          </label>
          <textarea
            value={doc.question}
            onChange={(e) => onChange({ question: e.target.value })}
            placeholder="# Enter your English text or question here..."
            className="h-40 w-full resize-none rounded-xl border border-white/60 bg-white/60 p-5 font-mono text-[13px] leading-relaxed shadow-sm outline-none backdrop-blur transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
          />
        </div>

        <div className="space-y-2">
          <label className="ml-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <span className="text-emerald-600">✦</span> Answer / Analysis (Markdown)
          </label>
          <textarea
            value={doc.answer}
            onChange={(e) => onChange({ answer: e.target.value })}
            placeholder="Enter the detailed analysis, AI explanation, or answer here..."
            className="h-[420px] w-full resize-none rounded-xl border border-white/60 bg-white/60 p-5 font-mono text-[13px] leading-relaxed shadow-sm outline-none backdrop-blur transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100 sm:h-[600px]"
          />
        </div>
      </div>
    </div>
  );
}
