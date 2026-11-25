/**
 * Prompt Capsule 的数据层：localStorage 仍是本地真源，
 * key 保持与旧版一致（bri_app_pro_v2），旧数据与 .bri 备份都能直接读。
 */

export type Annotation = { id: string; text: string; note: string };

export type CapsuleDoc = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  question: string;
  answer: string;
  annotations: Annotation[];
  updatedAt: number;
};

export type CapsuleMode = "view" | "note" | "edit";

export type CapsuleUI = {
  mode: CapsuleMode;
  globalMode: boolean;
  sidebarOpen: boolean;
  searchQuery: string;
  searchCategory: string;
  searchTag: string;
  deepSearch: boolean;
  zenMode: boolean;
};

export type CapsuleState = {
  docs: CapsuleDoc[];
  activeDocId: string | null;
  categories: string[];
  ui: CapsuleUI;
  /** 分类集合最后一次修改时间，同步时作为 settings 记录的 updatedAt */
  __categoriesUpdatedAt?: number;
};

export const STORAGE_KEY = "bri_app_pro_v2";
export const BACKUP_KEY_PREFIX = "bri_app_pro_v2_backup_";
export const DEFAULT_CATEGORIES = ["General", "Vocabulary", "Grammar"];
const GENERAL = "General";

export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function defaultUI(): CapsuleUI {
  return {
    mode: "view",
    globalMode: false,
    sidebarOpen: true,
    searchQuery: "",
    searchCategory: "",
    searchTag: "",
    deepSearch: false,
    zenMode: false,
  };
}

/** 首次使用时的引导文档，与旧版 createMockData 保持一致。 */
export function seedState(): CapsuleState {
  const doc: CapsuleDoc = {
    id: genId(),
    title: "Welcome to Bri.Learn",
    category: "General",
    tags: ["guide", "glassmorphism"],
    question:
      "### How to use this app?\n\nThis is a **concept-first** learning tool. You write a question or paste text on top, and write your analysis below.",
    answer:
      'In the **Note** mode, you can select any text to add **annotations**. \n\nTry selecting the word "annotations" above! \n\n> This new design uses "Glassmorphism" to provide a calm, focused environment for deep learning.',
    annotations: [{ id: genId(), text: "annotations", note: "Notes added to specific words for context." }],
    updatedAt: Date.now(),
  };
  return {
    docs: [doc],
    activeDocId: doc.id,
    categories: [...DEFAULT_CATEGORIES],
    ui: defaultUI(),
    __categoriesUpdatedAt: Date.now(),
  };
}

function normalizeDoc(raw: unknown): CapsuleDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<CapsuleDoc>;
  if (!d.id) return null;
  return {
    id: String(d.id),
    title: String(d.title ?? ""),
    category: String(d.category ?? GENERAL),
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    question: String(d.question ?? ""),
    answer: String(d.answer ?? ""),
    annotations: Array.isArray(d.annotations)
      ? d.annotations
          .filter((a) => a && typeof a === "object")
          .map((a) => ({ id: String(a.id ?? genId()), text: String(a.text ?? ""), note: String(a.note ?? "") }))
      : [],
    updatedAt: Number(d.updatedAt) || 0,
  };
}

/**
 * 读取本地数据。仅在「从来没有存过」时写入引导文档；
 * 用户删空文档后再进来不会反复塞回来（等幂）。
 */
export function loadState(): CapsuleState {
  if (typeof window === "undefined") return seedState();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return seedState();
  }
  if (!raw) {
    const seeded = seedState();
    saveState(seeded);
    return seeded;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CapsuleState>;
    const docs = Array.isArray(parsed.docs) ? parsed.docs.map(normalizeDoc).filter(Boolean) as CapsuleDoc[] : [];
    let categories = Array.isArray(parsed.categories) ? parsed.categories.map(String) : [];
    if (!categories.length) {
      const set = new Set(docs.map((d) => d.category || GENERAL));
      set.add(GENERAL);
      categories = [...set];
    }
    const activeDocId =
      parsed.activeDocId && docs.some((d) => d.id === parsed.activeDocId) ? parsed.activeDocId : docs[0]?.id ?? null;
    return {
      docs,
      categories,
      activeDocId,
      ui: { ...defaultUI(), ...(parsed.ui || {}), mode: "view", globalMode: false, zenMode: false },
      __categoriesUpdatedAt: Number(parsed.__categoriesUpdatedAt) || 0,
    };
  } catch {
    return seedState();
  }
}

export function saveState(state: CapsuleState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 存储已满或被禁用时忽略 */
  }
}

export function allTags(docs: CapsuleDoc[]): string[] {
  const set = new Set<string>();
  for (const d of docs) for (const t of d.tags || []) set.add(t);
  return [...set].sort();
}

export function filterDocs(
  docs: CapsuleDoc[],
  filter: { query?: string; category?: string; tag?: string; deep?: boolean },
): CapsuleDoc[] {
  const q = (filter.query || "").trim().toLowerCase();
  return docs.filter((doc) => {
    if (filter.category && doc.category !== filter.category) return false;
    if (filter.tag && !(doc.tags || []).includes(filter.tag)) return false;
    if (!q) return true;
    if ((doc.title || "").toLowerCase().includes(q)) return true;
    if (filter.deep) {
      return (doc.question || "").toLowerCase().includes(q) || (doc.answer || "").toLowerCase().includes(q);
    }
    return false;
  });
}

/** 导入 .bri：按 id 合并，同 id 取 updatedAt 更新的一版；分类取并集。 */
export function mergeImport(
  state: CapsuleState,
  loaded: { docs?: unknown; categories?: unknown },
): { state: CapsuleState; added: number; updated: number; skipped: number } {
  const incoming = Array.isArray(loaded.docs) ? loaded.docs.map(normalizeDoc).filter(Boolean) as CapsuleDoc[] : [];
  const docs = [...state.docs];
  const byId = new Map(docs.map((d) => [d.id, d]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const doc of incoming) {
    const cur = byId.get(doc.id);
    if (!cur) {
      docs.push(doc);
      byId.set(doc.id, doc);
      added += 1;
    } else if (Number(doc.updatedAt) > Number(cur.updatedAt || 0)) {
      Object.assign(cur, doc);
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  let categories = state.categories;
  if (Array.isArray(loaded.categories)) {
    categories = [...new Set([...categories, ...loaded.categories.map(String)])].sort();
  }
  const activeDocId = state.activeDocId && docs.some((d) => d.id === state.activeDocId) ? state.activeDocId : docs[0]?.id ?? null;
  return {
    state: { ...state, docs, categories, activeDocId },
    added,
    updated,
    skipped,
  };
}

/** 应用云端变更（doc 级 upsert / delete），返回新 state 与是否有变化。 */
export function applyRemoteState(
  state: CapsuleState,
  changes: { id: string; op?: string; data?: Partial<CapsuleDoc> | null; updatedAt?: number }[],
): { state: CapsuleState; changed: boolean } {
  const docs = [...state.docs];
  let changed = false;
  for (const ch of changes) {
    const idx = docs.findIndex((d) => d.id === ch.id);
    if (ch.op === "delete") {
      if (idx !== -1) {
        docs.splice(idx, 1);
        changed = true;
      }
      continue;
    }
    const normalized = normalizeDoc(ch.data);
    if (!normalized) continue;
    const incoming: CapsuleDoc = {
      ...normalized,
      updatedAt: Math.max(Number(normalized.updatedAt) || 0, Number(ch.updatedAt) || 0),
    };
    if (idx === -1) {
      docs.push(incoming);
      changed = true;
    } else if (Number(incoming.updatedAt) > Number(docs[idx].updatedAt || 0)) {
      docs[idx] = incoming;
      changed = true;
    }
  }
  if (!changed) return { state, changed: false };
  const activeDocId =
    state.activeDocId && docs.some((d) => d.id === state.activeDocId) ? state.activeDocId : docs[0]?.id ?? null;
  return { state: { ...state, docs, activeDocId }, changed: true };
}

export function addCategory(state: CapsuleState, name: string): { state: CapsuleState; error?: string } {
  const next = name.trim();
  if (!next) return { state, error: "分类名不能为空" };
  if (state.categories.includes(next)) return { state, error: "分类已存在" };
  const categories = [...state.categories, next].sort();
  return { state: { ...state, categories, __categoriesUpdatedAt: Date.now() } };
}

export function renameCategory(
  state: CapsuleState,
  from: string,
  to: string,
): { state: CapsuleState; error?: string } {
  const next = to.trim();
  if (!next || next === from) return { state };
  if (state.categories.includes(next)) return { state, error: "分类名已存在" };
  const categories = state.categories.map((c) => (c === from ? next : c)).sort();
  const docs = state.docs.map((d) => (d.category === from ? { ...d, category: next } : d));
  return { state: { ...state, categories, docs, __categoriesUpdatedAt: Date.now() } };
}

export function deleteCategory(state: CapsuleState, name: string): CapsuleState {
  if (name === GENERAL) return state;
  const docs = state.docs.map((d) => (d.category === name ? { ...d, category: GENERAL } : d));
  const categories = state.categories.filter((c) => c !== name);
  const ui = state.ui.searchCategory === name ? { ...state.ui, searchCategory: "" } : state.ui;
  return { ...state, docs, categories, ui, __categoriesUpdatedAt: Date.now() };
}

export function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/**
 * 在已渲染的 HTML 里把标注词包成高亮 span（跳过 HTML 标签内部）。
 * 与旧版一致：长文本优先；替换内容做转义，避免标注词里的尖括号破坏结构。
 */
export function wrapAnnotations(html: string, annotations: Annotation[]): string {
  const sorted = [...annotations].filter((a) => a && a.text).sort((a, b) => b.text.length - a.text.length);
  if (!sorted.length) return html;
  const byText = new Map(sorted.map((a) => [a.text, a]));
  const pattern = new RegExp(`(${sorted.map((a) => escapeReg(a.text)).join("|")})`, "g");
  // 一次扫过所有文本节点：命中即包 span，已包裹的片段不会被二次匹配（不产生嵌套）。
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith("<") && part.endsWith(">")) return part;
      const pieces = part.split(pattern);
      if (pieces.length === 1) return part;
      return pieces
        .map((piece, index) => {
          if (index % 2 === 1) {
            const anno = byText.get(piece);
            if (anno) {
              return `<span class="bri-highlight" data-anno="${escapeHtml(anno.id)}">${escapeHtml(piece)}</span>`;
            }
          }
          return piece;
        })
        .join("");
    })
    .join("");
}

/** 导出带术语表双向链接的 Markdown（旧版 exportMarkdown）。 */
export function exportMarkdownText(doc: CapsuleDoc, now = new Date()): string {
  let qText = doc.question || "";
  let aText = doc.answer || "";
  const notes = doc.annotations || [];
  notes.forEach((anno, index) => {
    const anchorId = `glossary-${index}`;
    const textId = `text-${index}`;
    const replacement = `<a id="${textId}" href="#${anchorId}" style="text-decoration:none; border-bottom:1px dashed #666; background-color: #fffbeb;">${anno.text}</a>`;
    const regex = new RegExp(escapeReg(anno.text), "i");
    qText = qText.replace(regex, replacement);
    aText = aText.replace(regex, replacement);
  });
  let md = `# ${doc.title}\n\n> Generated by Bri.Learn on ${now.toLocaleDateString()}\n\n`;
  md += `## Question / Context\n\n${qText}\n\n---\n\n## Answer / Analysis\n\n${aText}\n\n`;
  if (notes.length > 0) {
    md += "---\n\n## 📝 Contextual Glossary\n\n";
    notes.forEach((anno, index) => {
      md += `<div id="glossary-${index}" style="margin-bottom: 10px; padding: 10px; border: 1px solid #eee; border-radius: 6px;">\n  <strong>${anno.text}</strong>: ${anno.note} <a href="#text-${index}">↩ Back</a>\n</div>\n\n`;
    });
  }
  return md;
}

export function backupKeyNow(): string {
  return BACKUP_KEY_PREFIX + Date.now();
}
