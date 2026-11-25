'use client';

import { useState } from 'react';
import Icon from './Icon';

type Props = {
  open: boolean;
  categories: string[];
  error: string;
  onAdd: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
};

export default function CategoryModal({ open, categories, error, onAdd, onRename, onDelete, onClose }: Props) {
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');

  if (!open) return null;

  const close = () => {
    setNewName('');
    setEditing(null);
    onClose();
  };

  const commitRename = () => {
    if (editing) onRename(editing, editingValue);
    setEditing(null);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/25 backdrop-blur-sm" onClick={close} />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-white bg-white/95 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-white/60 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-800">Manage Categories</h3>
          <button onClick={close} className="text-slate-400 hover:text-slate-600" aria-label="关闭"><Icon name="x" className="h-4 w-4" /></button>
        </div>
        <div className="p-5">
          <div className="mb-5 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(newName); setNewName(''); } }}
              placeholder="New Category Name..."
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            />
            <button
              onClick={() => { onAdd(newName); setNewName(''); }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            >
              Add
            </button>
          </div>
          {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {categories.map((cat) => (
              <div key={cat} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 transition hover:border-indigo-200">
                <div className="min-w-0 flex-1">
                  {editing === cat ? (
                    <input
                      autoFocus
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); }}
                      className="w-full rounded border border-indigo-300 bg-white px-2 py-1 text-sm font-medium text-slate-700 outline-none"
                    />
                  ) : (
                    <div className="truncate text-sm font-medium text-slate-700">{cat}</div>
                  )}
                </div>
                <div className="ml-2 flex gap-1">
                  <button
                    onClick={() => { setEditing(cat); setEditingValue(cat); }}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-indigo-600"
                    title="重命名"
                  >
                    <Icon name="pencil" className="h-3.5 w-3.5" />
                  </button>
                  {cat !== 'General' && (
                    <button
                      onClick={() => onDelete(cat)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-red-500"
                      title="删除"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-center text-xs text-slate-400">
          删除分类会把其中的文档移到 General
        </div>
      </div>
    </div>
  );
}
