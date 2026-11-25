/**
 * Contextly 的纯数据层：localStorage 仍是本地真源，
 * key 保持与旧版一致（glass_memory_v2），老数据直接可读。
 */

export type CardState = "new" | "learning" | "review";

export type Card = {
  id: string;
  term: string;
  sentence: string;
  preContext: string;
  postContext: string;
  definition: string;
  created: number;
  state: CardState;
  due: number;
  stability: number;
  difficulty: number;
  reps: number;
  updatedAt?: number;
  /** 临时标记：自由复习不写回 due */
  _isFreeReview?: boolean;
};

export type Settings = { apiKey?: string };

export type StoreData = { settings: Settings; cards: Card[] };

const KEY = "glass_memory_v2";

export const EMPTY_CARD: Omit<Card, "id" | "created" | "state" | "due" | "stability" | "difficulty" | "reps"> = {
  term: "",
  sentence: "",
  preContext: "",
  postContext: "",
  definition: "",
};

export function loadData(): StoreData {
  if (typeof window === "undefined") return { settings: {}, cards: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { settings: {}, cards: [] };
    const parsed = JSON.parse(raw) as StoreData;
    return {
      settings: parsed.settings || {},
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    };
  } catch {
    return { settings: {}, cards: [] };
  }
}

export function saveData(data: StoreData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(data));
  window.dispatchEvent(new CustomEvent("contextly:change"));
}

export function saveSettings(patch: Settings) {
  const data = loadData();
  data.settings = { ...data.settings, ...patch };
  saveData(data);
}

export function generateId() {
  return "_" + Math.random().toString(36).slice(2, 11);
}

export function addCard(input: Partial<Card>): Card {
  const data = loadData();
  const now = Date.now();
  const card: Card = {
    id: generateId(),
    term: input.term ?? "",
    sentence: input.sentence ?? "",
    preContext: input.preContext ?? "",
    postContext: input.postContext ?? "",
    definition: input.definition ?? "",
    created: now,
    state: "new",
    due: now,
    stability: 0,
    difficulty: 0,
    reps: 0,
    updatedAt: now,
  };
  data.cards.push(card);
  saveData(data);
  return card;
}

export function updateCard(card: Card) {
  const data = loadData();
  const index = data.cards.findIndex((c) => c.id === card.id);
  if (index === -1) return;
  data.cards[index] = { ...card, updatedAt: Date.now() };
  saveData(data);
}

export function deleteCard(id: string) {
  const data = loadData();
  data.cards = data.cards.filter((c) => c.id !== id);
  saveData(data);
}

export function dailyQueue(cards: Card[]) {
  const now = Date.now();
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

/** 复习调度：与旧版 Scheduler.rate 完全一致 */
export function rateCard(card: Card, rating: 1 | 2 | 3 | 4): Card {
  const now = Date.now();
  const next = { ...card };
  let nextInterval = 1;

  if (rating === 1) {
    nextInterval = 1;
    next.state = "learning";
    next.difficulty = Math.min(10, next.difficulty + 2);
  } else if (rating === 2) {
    nextInterval = 10;
    next.difficulty = Math.min(10, next.difficulty + 1);
  } else if (rating === 3) {
    if (next.state === "new" || next.state === "learning") {
      nextInterval = 60 * 24;
      next.state = "review";
    } else {
      nextInterval = 60 * 24 * (next.reps * 2.5 || 2);
    }
    next.reps += 1;
  } else {
    if (next.state === "new") {
      nextInterval = 60 * 24 * 4;
    } else {
      nextInterval = 60 * 24 * (next.reps * 4 || 4);
    }
    next.state = "review";
    next.reps += 1;
    next.difficulty = Math.max(0, next.difficulty - 1);
  }

  if (!next._isFreeReview) {
    next.due = now + nextInterval * 60 * 1000;
  }
  delete next._isFreeReview;
  return next;
}

/** 把句子按目标词切成高亮片段，交给 React 渲染，避免 innerHTML */
export function splitHighlight(fullSentence: string, term: string) {
  if (!term || !fullSentence) return [{ text: fullSentence, hit: false }];
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = fullSentence.split(new RegExp(`(${escaped})`, "gi"));
  return parts
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: part.toLowerCase() === term.toLowerCase() }));
}

/** 云端增量应用：与旧版 applyCardChanges 一致 */
export function applyRemoteChanges(
  changes: { id: string; op?: string; data?: Partial<Card>; updatedAt?: number }[],
) {
  const data = loadData();
  let changed = false;
  for (const ch of changes) {
    const idx = data.cards.findIndex((c) => c.id === ch.id);
    if (ch.op === "delete") {
      if (idx !== -1) {
        data.cards.splice(idx, 1);
        changed = true;
      }
      continue;
    }
    if (!ch.data) continue;
    const incoming = {
      ...(ch.data as Card),
      updatedAt: Math.max(Number(ch.data.updatedAt) || 0, Number(ch.updatedAt) || 0),
    };
    if (idx === -1) {
      data.cards.push(incoming);
      changed = true;
    } else if (
      Number(incoming.updatedAt) > Number(data.cards[idx].updatedAt || data.cards[idx].created || 0)
    ) {
      data.cards[idx] = incoming;
      changed = true;
    }
  }
  if (changed) saveData(data);
  return changed;
}
