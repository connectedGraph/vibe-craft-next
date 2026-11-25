/**
 * Expressing 的数据层：沿用旧版的 localStorage 结构（bri_fix_pro_v1），
 * 同步适配器读的也是同一份 docs / categories。
 */

export type Annotation = { id: string; text: string; note: string };

export type ExpressDoc = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  chinese: string;
  mistake: string;
  native: string;
  explanation: string;
  annotations: Annotation[];
  updatedAt: number;
};

export type Mode = "view" | "note" | "edit";

export type ExpressState = {
  docs: ExpressDoc[];
  activeDocId: string | null;
  categories: string[];
  ui: {
    mode: Mode;
    globalMode: boolean;
    drawerOpen: boolean;
    sidebarOpen: boolean;
    editingAnnotationId: string | null;
    searchQuery: string;
    searchCategory: string;
    searchTag: string;
  };
  __categoriesUpdatedAt?: number;
};

const STORAGE_KEY = "bri_fix_pro_v1";

export const DEFAULT_CATEGORIES = ["General", "Business", "Daily Life", "Academic"];

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function initialState(): ExpressState {
  return {
    docs: [],
    activeDocId: null,
    categories: [...DEFAULT_CATEGORIES],
    ui: {
      mode: "view",
      globalMode: false,
      drawerOpen: false,
      sidebarOpen: true,
      editingAnnotationId: null,
      searchQuery: "",
      searchCategory: "",
      searchTag: "",
    },
  };
}

export function mockState(): ExpressState {
  const state = initialState();
  const doc: ExpressDoc = {
    id: generateId(),
    title: "Expressing Strong Preference",
    category: "Daily Life",
    tags: ["preference", "basic"],
    chinese: "我非常喜欢这个主意。",
    mistake: "I very like this idea.",
    native: "I really like this idea. / I'm really into this idea.",
    explanation:
      '### Grammar Point\n\nIn English, we rarely use "very" directly before a verb like "like" or "love". \n\n* **Incorrect**: I very like...\n* **Correct**: I really like... / I like ... very much.\n\n"Into" is a more casual way to say you are interested in something.',
    annotations: [
      { id: generateId(), text: "into", note: "Phrasal verb: To be interested in or enthusiastic about something." },
    ],
    updatedAt: Date.now(),
  };
  state.docs = [doc];
  state.activeDocId = doc.id;
  return state;
}

export function loadState(): ExpressState {
  if (typeof window === "undefined") return initialState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = mockState();
    persistState(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as ExpressState;
    const state: ExpressState = {
      ...initialState(),
      ...parsed,
      ui: { ...initialState().ui, ...(parsed.ui || {}) },
    };
    state.docs = (state.docs || []).map((d) => ({ ...d, tags: d.tags || [], annotations: d.annotations || [] }));
    state.ui.mode = "view";
    state.ui.sidebarOpen = true;
    state.ui.drawerOpen = false;
    state.ui.editingAnnotationId = null;
    state.ui.globalMode = false;
    if (state.docs.length && !state.docs.find((d) => d.id === state.activeDocId)) {
      state.activeDocId = state.docs[0].id;
    }
    return state;
  } catch {
    return initialState();
  }
}

export function persistState(state: ExpressState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function newDoc(): ExpressDoc {
  return {
    id: generateId(),
    title: "New Correction",
    category: "General",
    tags: [],
    chinese: "",
    mistake: "",
    native: "",
    explanation: "",
    annotations: [],
    updatedAt: Date.now(),
  };
}

export function filterDocs(state: ExpressState, docs = state.docs) {
  const { searchQuery, searchCategory, searchTag } = state.ui;
  return docs.filter((doc) => {
    if (searchCategory && doc.category !== searchCategory) return false;
    if (searchTag && (!doc.tags || !doc.tags.includes(searchTag))) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      (doc.native || "").toLowerCase().includes(q) ||
      (doc.chinese || "").includes(q)
    );
  });
}

export function allTags(docs: ExpressDoc[]) {
  const set = new Set<string>();
  docs.forEach((doc) => (doc.tags || []).forEach((t) => set.add(t)));
  return Array.from(set).sort();
}

/** 在已渲染的 HTML 上套高亮，保持旧版「不匹配标签内部」的策略 */
export function wrapHighlights(html: string, text: string, annotationId: string) {
  if (!text) return html;
  let pattern = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  pattern = pattern.replace(/\s+/g, "[\\s\\n]+");
  try {
    const regex = new RegExp(`(${pattern})(?![^<]*>)`, "gi");
    return html.replace(
      regex,
      `<span class="bri-highlight" data-anno-id="${annotationId}">$1</span>`,
    );
  } catch {
    return html;
  }
}

export function applyAnnotationHighlights(html: string, annotations: Annotation[]) {
  const sorted = [...annotations].sort((a, b) => b.text.length - a.text.length);
  return sorted.reduce((acc, anno) => wrapHighlights(acc, anno.text, anno.id), html);
}
