/**
 * Desktop Lite（Aura PKM）数据层。
 * localStorage key 与旧版一致（aura_pkm_data_v2 / aura_lang），旧数据直接可读。
 */

export type Clipboard = { id: number; title: string; content: string; color: string; updatedAt?: number };
export type InboxItem = {
  id: number;
  title: string;
  link: string;
  note: string;
  priority: "high" | "normal" | "low";
  done: boolean;
  updatedAt?: number;
};
export type Milestone = { label: string; done: boolean };
export type Pit = { id: number; name: string; milestones: Milestone[]; updatedAt?: number };
export type TimelineSlot = { hour: string; task: string; active: boolean };
export type LogEntry = { topic: string; text: string; time: string };
export type DailyLog = { focus: number; energy: number; mood: number; entries: LogEntry[]; updatedAt?: number };

export type Lang = "cn" | "en";

export type AuraState = {
  clipboards: Clipboard[];
  dailyLogs: Record<string, DailyLog>;
  logTopics: string[];
  currentLogTopic: string;
  plannerSlots: Record<number, string>;
  timeline: TimelineSlot[];
  inboxItems: InboxItem[];
  pits: Pit[];
  pomodoro: { duration: number; remaining: number; isRunning: boolean; state: string; streak: number };
  __settingsUpdatedAt?: number;
};

const STORAGE_KEY = "aura_pkm_data_v2";
const LANG_KEY = "aura_lang";

export const BOARD_COLORS = [
  "bg-amber-50/60 border-amber-100",
  "bg-indigo-50/60 border-indigo-100",
  "bg-rose-50/60 border-rose-100",
  "bg-emerald-50/60 border-emerald-100",
  "bg-sky-50/60 border-sky-100",
];

export const i18n = {
  cn: {
    navTabs: ["工作台", "日志", "指引", "开坑"],
    subTabs: [
      ["专注", "剪贴板"],
      ["身心指标", "记录"],
      ["全局战略", "本周聚焦", "时间流"],
      ["信息暂存", "知识坑"],
    ],
    sidebarSubtitle: "极简主义知识系统",
    saveOk: "已本地同步",
    saving: "保存中...",
    hintSwitch: "切换标签",
    hintSidebar: "收起侧栏",
    hintLog: "跳转日志",
    hintSubmit: "提交记录",
    langBtn: "EN",
    greeting: "你好，记录者",
    greetingSub: "这里是你最随心的灵感剪切板与精简番茄专注力中心。",
    focusLabel: "专注",
    streakLabel: "连续",
    streakUnit: "阶段",
    startFocus: "开始专注",
    resumeFocus: "恢复专注",
    pause: "暂停",
    preset25: "25m 专注",
    preset5: "5m 短休",
    preset15: "15m 长休",
    clipTitle: "剪贴板空间",
    clipSub: "多路灵感临时收集板",
    addBoard: "新增板面",
    boardPlaceholder: "点击这里，随心输入...",
    logTitle: "每日轻量日志",
    logSub: "记录今天的经历与思考",
    prevDay: "前一天",
    nextDay: "后一天",
    pulseTitle: "今日身心指标",
    focusMetric: "专注度",
    energyMetric: "精力状态",
    moodMetric: "情绪指数",
    logInputPlaceholder: "输入记录内容...",
    logTopicLabel: "话题:",
    addTopicPlaceholder: "新话题",
    noLogs: "暂无记录",
    plannerTitle: "规划指引",
    plannerSub: "全局战略、本周统筹、今日时间流",
    globalGuide: "全局战略",
    weeklyFocus: "本周聚焦",
    dailyFlow: "今日时间流",
    edit: "编辑",
    preview: "预览",
    clearTimeline: "重置",
    addSlot: "新增时段",
    inboxTitle: "信息暂存",
    inboxSub: "刷到好文章、视频、链接，及时收录",
    inboxTitleInput: "信息标题...",
    inboxLinkInput: "链接 URL (非必填)...",
    inboxNoteInput: "简单评注...",
    priorityHigh: "高优先级",
    priorityNormal: "中优先级",
    priorityLow: "低优先级",
    addToInbox: "收纳至收集箱",
    emptyInbox: "收集箱为空",
    pitsTitle: "知识坑",
    pitsSub: "系统掌握的主题，逐步完善进度",
    newPit: "新开大坑",
    pitNamePlaceholder: "课题主题名称...",
    pitMilestonePlaceholder: "子任务 (逗号隔开, 可选)",
    pitCancel: "取消",
    pitCreate: "启程开挖",
    pitAddStep: "追加步骤",
    pitStepPlaceholder: "添加细分路径...",
    noPits: "暂未开启任何课题",
    achieved: "达成",
    defaultTopics: ["工作", "生活", "学习", "反思"],
  },
  en: {
    navTabs: ["Workspace", "Logbook", "Planner", "Pits"],
    subTabs: [
      ["Focus", "Clipboard"],
      ["Daily Pulse", "Entries"],
      ["Global Strategy", "Weekly Focus", "Timeline"],
      ["Inbox", "Knowledge Pits"],
    ],
    sidebarSubtitle: "Minimalist Knowledge System",
    saveOk: "Saved locally",
    saving: "Saving...",
    hintSwitch: "switch tabs",
    hintSidebar: "toggle sidebar",
    hintLog: "jump to log",
    hintSubmit: "submit entry",
    langBtn: "中文",
    greeting: "Hello, Creator",
    greetingSub: "Your clipboard space and focused pomodoro center.",
    focusLabel: "Focus",
    streakLabel: "Streak",
    streakUnit: "sessions",
    startFocus: "Start Focus",
    resumeFocus: "Resume",
    pause: "Pause",
    preset25: "25m Focus",
    preset5: "5m Break",
    preset15: "15m Long",
    clipTitle: "Clipboard Space",
    clipSub: "Multi-board scratch collector",
    addBoard: "Add Board",
    boardPlaceholder: "Type your thoughts here...",
    logTitle: "Daily Logbook",
    logSub: "Record experiences and reflections",
    prevDay: "Prev",
    nextDay: "Next",
    pulseTitle: "Daily Pulse",
    focusMetric: "Focus",
    energyMetric: "Energy",
    moodMetric: "Mood",
    logInputPlaceholder: "Type your log entry...",
    logTopicLabel: "Topic:",
    addTopicPlaceholder: "New topic",
    noLogs: "No entries yet",
    plannerTitle: "Planner",
    plannerSub: "Global strategy, weekly plan, daily timeline",
    globalGuide: "Global Strategy",
    weeklyFocus: "Weekly Focus",
    dailyFlow: "Daily Timeline",
    edit: "Edit",
    preview: "Preview",
    clearTimeline: "Clear",
    addSlot: "Add Slot",
    inboxTitle: "Inbox",
    inboxSub: "Capture articles, videos, links on the fly",
    inboxTitleInput: "Title...",
    inboxLinkInput: "URL (optional)...",
    inboxNoteInput: "Quick note...",
    priorityHigh: "High",
    priorityNormal: "Normal",
    priorityLow: "Low",
    addToInbox: "Add to Inbox",
    emptyInbox: "Inbox is empty",
    pitsTitle: "Knowledge Pits",
    pitsSub: "Deep learning topics with milestone tracking",
    newPit: "New Pit",
    pitNamePlaceholder: "Topic name...",
    pitMilestonePlaceholder: "Milestones (comma separated, optional)",
    pitCancel: "Cancel",
    pitCreate: "Create",
    pitAddStep: "Add Step",
    pitStepPlaceholder: "Add milestone...",
    noPits: "No pits created yet",
    achieved: "done",
    defaultTopics: ["Work", "Life", "Study", "Reflection"],
  },
} as const;

export type Dict = (typeof i18n)["cn"];

export function dict(lang: Lang): Dict {
  return i18n[lang] as unknown as Dict;
}

export function todayString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function defaultState(): AuraState {
  return {
    clipboards: [
      {
        id: 1,
        title: "随心收件箱",
        content: "在这里放一些随手的想法。\n直接点击下方可以编辑内容！",
        color: "bg-amber-50/60 border-amber-100",
      },
      {
        id: 2,
        title: "临时代码库",
        content: 'console.log("Hello Aura!");\n\n简洁优雅不仅是美学。',
        color: "bg-indigo-50/60 border-indigo-100",
      },
    ],
    dailyLogs: {},
    logTopics: ["工作", "生活", "学习", "反思"],
    currentLogTopic: "工作",
    plannerSlots: {
      1: "# 全局极简指南\n\n> 简单的系统让决策更容易。\n\n## 年度核心\n- 深度工作：每日完成2个核心番茄周期。\n- 持续沉淀：收集优质信息。\n- 敏捷交付：小步快跑。",
      2: "# 本周关键战役\n\n- [x] 重构 Aura PKM 系统设计\n- [ ] 精读 2 篇核心深度报告\n- [ ] 完成学习计划中的主要任务",
    },
    timeline: [
      { hour: "08:00 - 10:00", task: "晨间深度工作", active: true },
      { hour: "10:00 - 12:00", task: "界面打磨与优化", active: false },
      { hour: "14:00 - 16:00", task: "算法攻坚/开坑学习", active: false },
      { hour: "16:00 - 18:00", task: "整理收件箱/复盘", active: false },
      { hour: "20:00 - 21:30", task: "健身与生活", active: false },
    ],
    inboxItems: [
      { id: 1, title: "如何建立自己的高维知识晶体", link: "https://zhihu.com", note: "网状结构如何提纯为晶体", priority: "high", done: false },
      { id: 2, title: "现代极简数字美学探源", link: "https://bilibili.com", note: "纯白微阴影设计", priority: "normal", done: false },
    ],
    pits: [
      {
        id: 1,
        name: "Three.js 深度视觉渲染",
        milestones: [
          { label: "熟悉基础 Scene/Camera 节点配置", done: true },
          { label: "掌握物理材质与光影调整", done: false },
          { label: "运用 Canvas 绘制交互控制按钮", done: false },
        ],
      },
    ],
    pomodoro: { duration: 25, remaining: 25 * 60, isRunning: false, state: "Focus", streak: 0 },
  };
}

export function loadLang(): Lang {
  if (typeof window === "undefined") return "cn";
  return (window.localStorage.getItem(LANG_KEY) as Lang) || "cn";
}

export function saveLang(lang: Lang) {
  window.localStorage.setItem(LANG_KEY, lang);
}

export function loadState(): AuraState {
  if (typeof window === "undefined") return defaultState();
  let state = defaultState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      state = { ...state, ...(JSON.parse(raw) as Partial<AuraState>) };
    } catch {
      /* 保持默认 */
    }
  }
  if (!state.logTopics || state.logTopics.length === 0) state.logTopics = ["工作", "生活", "学习", "反思"];
  if (!state.currentLogTopic) state.currentLogTopic = state.logTopics[0];
  const today = todayString();
  if (!state.dailyLogs[today]) state.dailyLogs[today] = { focus: 5, energy: 5, mood: 5, entries: [] };
  state.pomodoro = { ...state.pomodoro, isRunning: false };
  return state;
}

export function persist(state: AuraState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ===== 音效（与旧版一致的 WebAudio 提示音） =====
type SoundType = "click" | "success" | "tick" | "complete";

export function playSound(type: SoundType = "click") {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "click") {
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "success") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
      osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } else if (type === "tick") {
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      gain.gain.setValueAtTime(0.02, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.02);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch {
    /* 静默失败，与旧版一致 */
  }
}

export function confettiBurst(options: { particleCount?: number; spread?: number; origin?: { y: number } }) {
  const fn = (window as unknown as { confetti?: (o: unknown) => void }).confetti;
  if (fn) fn(options);
}

/** 云端增量应用：按传入集合合并 */
export function applyListChanges<T extends { id: number | string; updatedAt?: number }>(
  list: T[],
  changes: { id: string; op?: string; data?: Partial<T>; updatedAt?: number }[],
) {
  let changed = false;
  for (const ch of changes) {
    const idx = list.findIndex((x) => String(x.id) === String(ch.id));
    if (ch.op === "delete") {
      if (idx !== -1) {
        list.splice(idx, 1);
        changed = true;
      }
      continue;
    }
    if (!ch.data) continue;
    const incoming = {
      ...(ch.data as T),
      updatedAt: Math.max(Number(ch.data.updatedAt) || 0, Number(ch.updatedAt) || 0),
    };
    if (idx === -1) {
      list.push(incoming);
      changed = true;
    } else if (Number(incoming.updatedAt) > Number(list[idx].updatedAt || 0)) {
      list[idx] = incoming;
      changed = true;
    }
  }
  return changed;
}
