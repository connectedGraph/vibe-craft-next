/**
 * 数据层纯函数单测。
 * Node 24 直接 import .ts（类型擦除），不引入任何测试依赖。
 * 依赖 DOM 的函数（playSound / confettiBurst）不覆盖，原因见 tests/README.md。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const contextly = await import('../src/lib/tools/contextly.ts');
const expressing = await import('../src/lib/tools/expressing.ts');
const desktopLite = await import('../src/lib/tools/desktopLite.ts');

/* ───────────── localStorage / window 桩 ───────────── */

function makeWindow() {
  const store = new Map();
  return {
    localStorage: {
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
      clear() { store.clear(); },
    },
    dispatchEvent() { return true; },
  };
}

function withWindow(t) {
  const win = makeWindow();
  globalThis.window = win;
  t.after(() => { delete globalThis.window; });
  return win;
}

function seed(win, key, value) {
  win.localStorage.setItem(key, JSON.stringify(value));
}

function stored(win, key) {
  const raw = win.localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

const near = (actual, expected, tolerance = 5000) => Math.abs(actual - expected) <= tolerance;
const countOf = (haystack, needle) => haystack.split(needle).length - 1;

/* ───────────── contextly ───────────── */

function baseCard(over = {}) {
  return {
    id: 'c1', term: 't', sentence: '', preContext: '', postContext: '', definition: '',
    created: 1000, state: 'new', due: 0, stability: 0, difficulty: 0, reps: 0,
    ...over,
  };
}

test('contextly.dailyQueue 只取到期卡片并按 due 升序', () => {
  const now = Date.now();
  const cards = [
    baseCard({ id: 'future', due: now + 60_000 }),
    baseCard({ id: 'late', due: now - 5_000 }),
    baseCard({ id: 'mid', due: now - 1_000 }),
    baseCard({ id: 'now', due: now }),
  ];
  const queue = contextly.dailyQueue(cards);
  assert.deepEqual(queue.map((c) => c.id), ['late', 'mid', 'now']);
  assert.equal(contextly.dailyQueue([]).length, 0);
});

test('contextly.rateCard：评级 1/2 的间隔、难度与状态', () => {
  const before = Date.now();
  const again = contextly.rateCard(baseCard({ difficulty: 3 }), 1);
  const after = Date.now();
  assert.equal(again.state, 'learning');
  assert.equal(again.difficulty, 5);
  assert.equal(again.reps, 0);
  assert.ok(again.due >= before + 60_000 && again.due <= after + 60_000, '评级 1 应 1 分钟后到期');

  const hard = contextly.rateCard(baseCard({ difficulty: 3, state: 'review' }), 2);
  assert.equal(hard.state, 'review', '评级 2 不改变状态');
  assert.equal(hard.difficulty, 4);
  assert.ok(near(hard.due, Date.now() + 10 * 60_000), '评级 2 应 10 分钟后到期');

  // 难度封顶
  assert.equal(contextly.rateCard(baseCard({ difficulty: 9 }), 1).difficulty, 10);
  assert.equal(contextly.rateCard(baseCard({ difficulty: 10 }), 2).difficulty, 10);
});

test('contextly.rateCard：评级 3/4 的复习间隔与下次复习时间', () => {
  const before3 = Date.now();
  const newToReview = contextly.rateCard(baseCard({ state: 'new' }), 3);
  assert.equal(newToReview.state, 'review');
  assert.equal(newToReview.reps, 1);
  assert.ok(near(newToReview.due, before3 + 60 * 24 * 60_000), '新卡评级 3 应 1 天后到期');

  const reviewReps2 = contextly.rateCard(baseCard({ state: 'review', reps: 2 }), 3);
  assert.equal(reviewReps2.reps, 3);
  assert.ok(near(reviewReps2.due, Date.now() + 60 * 24 * 2.5 * 2 * 60_000), '复习卡评级 3 间隔按 reps*2.5 天');

  // reps 为 0 时走 `|| 2` 兜底
  const reviewReps0 = contextly.rateCard(baseCard({ state: 'review', reps: 0 }), 3);
  assert.ok(near(reviewReps0.due, Date.now() + 60 * 24 * 2 * 60_000));

  const easyNew = contextly.rateCard(baseCard({ state: 'new', difficulty: 0 }), 4);
  assert.equal(easyNew.state, 'review');
  assert.equal(easyNew.reps, 1);
  assert.equal(easyNew.difficulty, 0, '难度不会低于 0');
  assert.ok(near(easyNew.due, Date.now() + 60 * 24 * 4 * 60_000), '新卡评级 4 应 4 天后到期');

  const easyReview = contextly.rateCard(baseCard({ state: 'review', reps: 3, difficulty: 2 }), 4);
  assert.equal(easyReview.reps, 4);
  assert.equal(easyReview.difficulty, 1);
  assert.ok(near(easyReview.due, Date.now() + 60 * 24 * 3 * 4 * 60_000));
});

test('contextly.rateCard：自由复习不写回 due，且不改原对象', () => {
  const original = baseCard({ due: 12345, _isFreeReview: true });
  const snapshot = JSON.stringify(original);
  const free = contextly.rateCard(original, 3);
  assert.equal(free.due, 12345, '自由复习保持原 due');
  assert.equal('_isFreeReview' in free, false, '临时标记应被清理');
  assert.equal(JSON.stringify(original), snapshot, '不得原地修改入参');
});

test('contextly.applyRemoteChanges：合并、删除、忽略较旧写入', (t) => {
  const win = withWindow(t);
  seed(win, 'glass_memory_v2', {
    settings: { apiKey: 'k' },
    cards: [
      { id: 'a', term: 'A', created: 500, updatedAt: 1000 },
      { id: 'b', term: 'B', created: 600, updatedAt: 900 },
    ],
  });

  // 新记录追加
  const added = contextly.applyRemoteChanges([
    { id: 'c', op: 'upsert', data: { id: 'c', term: 'C', updatedAt: 1000 }, updatedAt: 1000 },
  ]);
  assert.equal(added, true);
  assert.deepEqual(contextly.loadData().cards.map((c) => c.id), ['a', 'b', 'c']);

  // 较新写入覆盖
  const updated = contextly.applyRemoteChanges([
    { id: 'a', data: { id: 'a', term: 'A2', updatedAt: 2000 } },
  ]);
  assert.equal(updated, true);
  assert.equal(contextly.loadData().cards.find((c) => c.id === 'a').term, 'A2');

  // 较旧写入被忽略（返回 false，内容不变）
  const stale = contextly.applyRemoteChanges([
    { id: 'a', data: { id: 'a', term: 'old', updatedAt: 500 } },
  ]);
  assert.equal(stale, false);
  assert.equal(contextly.loadData().cards.find((c) => c.id === 'a').term, 'A2');

  // data 内没有 updatedAt 时用外层 changed.updatedAt
  const topLevelTs = contextly.applyRemoteChanges([
    { id: 'b', data: { id: 'b', term: 'B2' }, updatedAt: 1500 },
  ]);
  assert.equal(topLevelTs, true);
  assert.equal(contextly.loadData().cards.find((c) => c.id === 'b').term, 'B2');

  // 无 data 的 upsert 忽略
  assert.equal(contextly.applyRemoteChanges([{ id: 'a', op: 'upsert' }]), false);

  // 删除
  assert.equal(contextly.applyRemoteChanges([{ id: 'b', op: 'delete' }]), true);
  assert.deepEqual(contextly.loadData().cards.map((c) => c.id), ['a', 'c']);
  assert.equal(contextly.applyRemoteChanges([{ id: 'missing', op: 'delete' }]), false);

  // 结果已落盘
  assert.deepEqual(stored(win, 'glass_memory_v2').cards.map((c) => c.id), ['a', 'c']);
  assert.equal(stored(win, 'glass_memory_v2').settings.apiKey, 'k');
});

test('contextly.loadData：无 window / 空存储时返回空结构', (t) => {
  // 无 window 分支
  assert.deepEqual(contextly.loadData(), { settings: {}, cards: [] });

  const win = withWindow(t);
  assert.deepEqual(contextly.loadData(), { settings: {}, cards: [] });
  win.localStorage.setItem('glass_memory_v2', '{坏 JSON');
  assert.deepEqual(contextly.loadData(), { settings: {}, cards: [] });
});

/* ───────────── expressing ───────────── */

function expressDoc(over = {}) {
  return {
    id: 'd', title: 'Title', category: 'General', tags: [], chinese: '', mistake: '',
    native: '', explanation: '', annotations: [], updatedAt: 1, ...over,
  };
}

function expressState(docs, ui = {}) {
  const base = expressing.initialState();
  return { ...base, docs, ui: { ...base.ui, ...ui } };
}

test('expressing.newDoc：默认字段与时间戳', () => {
  const before = Date.now();
  const doc = expressing.newDoc();
  const after = Date.now();
  assert.equal(typeof doc.id, 'string');
  assert.ok(doc.id.length > 0);
  assert.equal(doc.title, 'New Correction');
  assert.equal(doc.category, 'General');
  assert.deepEqual(doc.tags, []);
  assert.deepEqual(doc.annotations, []);
  assert.equal(doc.chinese, '');
  assert.equal(doc.mistake, '');
  assert.equal(doc.native, '');
  assert.equal(doc.explanation, '');
  assert.ok(doc.updatedAt >= before && doc.updatedAt <= after);
});

test('expressing.filterDocs：标题/译文/中文、分类、标签', () => {
  const docs = [
    expressDoc({ id: '1', title: 'Business Email', category: 'Business', tags: ['email', 'work'], native: 'I am writing to you', chinese: '我在写邮件' }),
    expressDoc({ id: '2', title: 'Daily Chat', category: 'Daily Life', tags: ['chat'], native: 'How is it going', chinese: '最近怎么样' }),
  ];

  const ids = (state, list) => expressing.filterDocs(state, list ?? state.docs).map((d) => d.id);

  assert.deepEqual(ids(expressState(docs)), ['1', '2']);
  assert.deepEqual(ids(expressState(docs, { searchQuery: 'email' })), ['1']);
  assert.deepEqual(ids(expressState(docs, { searchQuery: 'HOW IS' })), ['2']);
  assert.deepEqual(ids(expressState(docs, { searchQuery: '邮件' })), ['1']);
  assert.deepEqual(ids(expressState(docs, { searchQuery: 'nope' })), []);
  assert.deepEqual(ids(expressState(docs, { searchCategory: 'Business' })), ['1']);
  assert.deepEqual(ids(expressState(docs, { searchTag: 'chat' })), ['2']);
  assert.deepEqual(ids(expressState(docs, { searchTag: 'missing' })), []);
  // docs 覆盖参数
  assert.deepEqual(ids(expressState(docs), [docs[1]]), ['2']);
  // 无标签文档不炸
  assert.deepEqual(ids(expressState([expressDoc({ id: '3', tags: undefined })], { searchTag: 'x' })), []);
});

test('expressing.allTags：去重并排序', () => {
  const docs = [
    expressDoc({ id: '1', tags: ['b', 'a'] }),
    expressDoc({ id: '2', tags: ['a', 'c'] }),
    expressDoc({ id: '3', tags: undefined }),
  ];
  assert.deepEqual(expressing.allTags(docs), ['a', 'b', 'c']);
  assert.deepEqual(expressing.allTags([]), []);
});

test('expressing.wrapHighlights：基本包裹、特殊字符转义、跨空白、避开标签', () => {
  const basic = expressing.wrapHighlights('<p>Hello world</p>', 'world', 'a1');
  assert.equal(countOf(basic, '<span class="bri-highlight"'), 1);
  assert.ok(basic.includes('data-anno-id="a1"'));
  assert.ok(basic.includes('>world</span>'));

  // 大小写不敏感
  assert.equal(countOf(expressing.wrapHighlights('<p>Hello World</p>', 'world', 'a1'), '<span'), 1);

  // 未命中 / 空文本
  assert.equal(expressing.wrapHighlights('<p>Hello</p>', 'absent', 'a1'), '<p>Hello</p>');
  assert.equal(expressing.wrapHighlights('<p>Hello</p>', '', 'a1'), '<p>Hello</p>');

  // 正则特殊字符按字面量匹配：a.b 不应命中 axb
  const special = expressing.wrapHighlights('<p>a.b axb</p>', 'a.b', 's1');
  assert.equal(countOf(special, '<span'), 1);
  assert.ok(special.includes('>a.b</span>'));
  assert.ok(special.includes('axb'));

  const plus = expressing.wrapHighlights('<p>C++ and C</p>', 'C++', 's2');
  assert.equal(countOf(plus, '<span'), 1);
  assert.ok(plus.includes('>C++</span>'));

  // 标注文本里的空白匹配换行
  const multiline = expressing.wrapHighlights('<p>hello\nworld</p>', 'hello world', 'w1');
  assert.equal(countOf(multiline, '<span'), 1);
  assert.ok(multiline.includes('>hello\nworld</span>'));

  // 不包裹标签属性
  const attr = expressing.wrapHighlights('<p title="hello">hello</p>', 'hello', 'h1');
  assert.equal(countOf(attr, '<span'), 1);
  assert.ok(attr.startsWith('<p title="hello">'));
  assert.ok(attr.indexOf('<span') > attr.indexOf('>'));
});

test('expressing.applyAnnotationHighlights：最长优先、不重叠标注各包一层、转义', () => {
  const disjoint = expressing.applyAnnotationHighlights('<p>alpha beta</p>', [
    { id: 'x', text: 'alpha', note: '' },
    { id: 'y', text: 'beta', note: '' },
  ]);
  assert.equal(countOf(disjoint, '<span class="bri-highlight"'), 2);
  assert.ok(disjoint.includes('data-anno-id="x"'));
  assert.ok(disjoint.includes('data-anno-id="y"'));

  // 最长文本先套，保证短语整体优先
  const ordered = expressing.applyAnnotationHighlights('<p>hello world</p>', [
    { id: 'short', text: 'hello', note: '' },
    { id: 'long', text: 'hello world', note: '' },
  ]);
  const firstId = ordered.match(/data-anno-id="([^"]+)"/)?.[1];
  assert.equal(firstId, 'long');

  // 特殊字符
  const escaped = expressing.applyAnnotationHighlights('<p>a+b aab</p>', [
    { id: 'p', text: 'a+b', note: '' },
  ]);
  assert.equal(countOf(escaped, '<span'), 1);
  assert.ok(escaped.includes('>a+b</span>'));

  assert.equal(expressing.applyAnnotationHighlights('<p>same</p>', []), '<p>same</p>');
});

/* ───────────── desktopLite ───────────── */

test('desktopLite.defaultState / todayString', () => {
  const state = desktopLite.defaultState();
  assert.equal(state.clipboards.length, 2);
  assert.deepEqual(state.clipboards.map((c) => c.id), [1, 2]);
  assert.deepEqual(state.logTopics, ['工作', '生活', '学习', '反思']);
  assert.equal(state.currentLogTopic, '工作');
  assert.equal(state.timeline.length, 5);
  assert.equal(state.timeline[0].active, true);
  assert.equal(state.inboxItems.length, 2);
  assert.equal(state.pits.length, 1);
  assert.equal(state.pits[0].milestones.length, 3);
  assert.deepEqual(state.pomodoro, { duration: 25, remaining: 25 * 60, isRunning: false, state: 'Focus', streak: 0 });
  assert.deepEqual(state.dailyLogs, {});

  assert.equal(desktopLite.todayString(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(desktopLite.todayString(new Date(2026, 11, 31)), '2026-12-31');
});

test('desktopLite.loadState：空存储取默认值并补今日日志', (t) => {
  const win = withWindow(t);
  const state = desktopLite.loadState();
  const today = desktopLite.todayString();
  assert.equal(state.clipboards.length, 2);
  assert.deepEqual(state.logTopics, ['工作', '生活', '学习', '反思']);
  assert.equal(state.currentLogTopic, '工作');
  assert.deepEqual(state.dailyLogs[today], { focus: 5, energy: 5, mood: 5, entries: [] });
  assert.equal(state.pomodoro.isRunning, false);
  assert.equal(win.localStorage.getItem('aura_pkm_data_v2'), null, '读取默认值不应写盘');

  // 语言默认 cn
  assert.equal(desktopLite.loadLang(), 'cn');
  win.localStorage.setItem('aura_lang', 'en');
  assert.equal(desktopLite.loadLang(), 'en');
});

test('desktopLite.loadState：合并已存数据，清空日志主题与计时运行态', (t) => {
  const win = withWindow(t);
  seed(win, 'aura_pkm_data_v2', {
    clipboards: [{ id: 9, title: '自定义', content: '', color: 'c' }],
    logTopics: [],
    currentLogTopic: '',
    dailyLogs: {},
    pomodoro: { duration: 5, remaining: 1, isRunning: true, state: 'Break', streak: 3 },
  });

  const state = desktopLite.loadState();
  const today = desktopLite.todayString();
  assert.equal(state.clipboards.length, 1);
  assert.equal(state.clipboards[0].id, 9);
  assert.deepEqual(state.logTopics, ['工作', '生活', '学习', '反思'], '空主题回退默认');
  assert.equal(state.currentLogTopic, '工作', '空当前主题回退第一个');
  assert.equal(state.dailyLogs[today].focus, 5, '今日日志缺失时补默认');
  assert.equal(state.pomodoro.isRunning, false, '加载时强制停止计时');
  assert.equal(state.pomodoro.duration, 5);
  assert.equal(state.pomodoro.streak, 3);
  // 未覆盖的字段保留默认
  assert.equal(state.timeline.length, 5);
});

test('desktopLite.applyListChanges：增删改、tombstone、较旧写入、排序稳定', () => {
  const makeList = () => [
    { id: 1, title: 'one', updatedAt: 10 },
    { id: 2, title: 'two', updatedAt: 20 },
  ];

  // 更新：原地替换，顺序不变
  const list = makeList();
  assert.equal(desktopLite.applyListChanges(list, [
    { id: '1', data: { id: 1, title: 'one!', updatedAt: 30 } },
  ]), true);
  assert.deepEqual(list.map((x) => x.id), [1, 2]);
  assert.equal(list[0].title, 'one!');

  // 新增：追加到末尾
  assert.equal(desktopLite.applyListChanges(list, [
    { id: '3', data: { id: 3, title: 'three', updatedAt: 40 } },
  ]), true);
  assert.deepEqual(list.map((x) => x.id), [1, 2, 3]);

  // 较旧 / 相同 updatedAt 的写入被忽略
  assert.equal(desktopLite.applyListChanges(list, [
    { id: '2', data: { id: 2, title: 'stale', updatedAt: 5 } },
  ]), false);
  assert.equal(list[1].title, 'two');
  assert.equal(desktopLite.applyListChanges(list, [
    { id: '2', data: { id: 2, title: 'equal', updatedAt: 20 } },
  ]), false);
  assert.equal(list[1].title, 'two');

  // data 无 updatedAt 时使用外层
  assert.equal(desktopLite.applyListChanges(list, [
    { id: '2', data: { id: 2, title: 'two2' }, updatedAt: 50 },
  ]), true);
  assert.equal(list[1].title, 'two2');

  // 无 data 的 upsert 忽略
  assert.equal(desktopLite.applyListChanges(list, [{ id: '2', op: 'upsert' }]), false);

  // tombstone：delete 直接移除
  assert.equal(desktopLite.applyListChanges(list, [{ id: '1', op: 'delete' }]), true);
  assert.deepEqual(list.map((x) => x.id), [2, 3]);
  assert.equal(desktopLite.applyListChanges(list, [{ id: '404', op: 'delete' }]), false);

  // 空变更
  assert.equal(desktopLite.applyListChanges(list, []), false);

  // 字符串 id 也能按 String() 对齐
  const strList = [{ id: 'a', title: 'A', updatedAt: 1 }];
  assert.equal(desktopLite.applyListChanges(strList, [
    { id: 'a', data: { id: 'a', title: 'A2', updatedAt: 2 } },
  ]), true);
  assert.equal(strList[0].title, 'A2');
});
