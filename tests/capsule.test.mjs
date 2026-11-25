/**
 * Prompt Capsule 数据层单测（Node 24 直接 import .ts）。
 * 覆盖：引导数据、首次读写与等幂、导入合并、云端变更应用、分类操作、标注包裹、Markdown 导出。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const capsule = await import('../src/lib/tools/capsule.ts');
const contextly = await import('../src/lib/tools/contextly.ts');
const expressing = await import('../src/lib/tools/expressing.ts');

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

const readKey = (win, key) => {
  const raw = win.localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
};

/* ───────────── 引导数据 ───────────── */

test('capsule.seedState：新版首次进入拿到与旧版一致的引导文档', () => {
  const state = capsule.seedState();
  assert.equal(state.docs.length, 1);
  assert.equal(state.docs[0].title, 'Welcome to Bri.Learn');
  assert.deepEqual(state.docs[0].tags, ['guide', 'glassmorphism']);
  assert.equal(state.docs[0].annotations.length, 1);
  assert.equal(state.docs[0].annotations[0].text, 'annotations');
  assert.deepEqual(state.categories, ['General', 'Vocabulary', 'Grammar']);
  assert.equal(state.activeDocId, state.docs[0].id);
});

test('capsule.loadState：没有存储时写入引导数据，二次读取不重复', (t) => {
  const win = withWindow(t);
  const first = capsule.loadState();
  const second = capsule.loadState();
  assert.equal(second.docs.length, 1);
  assert.equal(second.docs[0].id, first.docs[0].id);
  assert.equal(readKey(win, capsule.STORAGE_KEY).docs.length, 1);
});

test('capsule.loadState：用户把文档删光后不会重新塞引导（等幂）', (t) => {
  const win = withWindow(t);
  capsule.loadState();
  const empty = { docs: [], categories: ['General'], activeDocId: null, ui: capsule.defaultUI() };
  win.localStorage.setItem(capsule.STORAGE_KEY, JSON.stringify(empty));
  const again = capsule.loadState();
  assert.equal(again.docs.length, 0);
  assert.equal(again.activeDocId, null);
});

test('capsule.loadState：旧数据缺字段时补齐，坏 JSON 不炸', (t) => {
  const win = withWindow(t);
  win.localStorage.setItem(capsule.STORAGE_KEY, JSON.stringify({ docs: [{ id: 'x', title: 'T' }] }));
  const state = capsule.loadState();
  assert.deepEqual(state.docs[0].tags, []);
  assert.deepEqual(state.docs[0].annotations, []);
  assert.equal(state.docs[0].category, 'General');
  assert.equal(state.activeDocId, 'x');

  win.localStorage.setItem(capsule.STORAGE_KEY, '{bad json');
  const fallback = capsule.loadState();
  assert.equal(fallback.docs.length, 1);
});

/* ───────────── 搜索 ───────────── */

test('capsule.filterDocs：分类/标签/标题与深度搜索', () => {
  const docs = [
    { id: '1', title: 'Alpha', category: 'A', tags: ['x'], question: 'hidden', answer: '', annotations: [], updatedAt: 1 },
    { id: '2', title: 'Beta', category: 'B', tags: ['y'], question: 'contains needle', answer: '', annotations: [], updatedAt: 2 },
  ];
  assert.deepEqual(capsule.filterDocs(docs, { query: 'alp' }).map((d) => d.id), ['1']);
  assert.deepEqual(capsule.filterDocs(docs, { query: 'needle' }).map((d) => d.id), []);
  assert.deepEqual(capsule.filterDocs(docs, { query: 'needle', deep: true }).map((d) => d.id), ['2']);
  assert.deepEqual(capsule.filterDocs(docs, { category: 'B' }).map((d) => d.id), ['2']);
  assert.deepEqual(capsule.filterDocs(docs, { tag: 'x' }).map((d) => d.id), ['1']);
});

/* ───────────── 导入合并 ───────────── */

test('capsule.mergeImport：新增/更新/跳过与分类并集', () => {
  const state = {
    docs: [
      { id: 'a', title: 'old', category: 'General', tags: [], question: '', answer: '', annotations: [], updatedAt: 10 },
    ],
    categories: ['General'],
    activeDocId: 'a',
    ui: capsule.defaultUI(),
  };
  const res = capsule.mergeImport(state, {
    docs: [
      { id: 'a', title: 'newer', category: 'General', tags: [], question: '', answer: '', annotations: [], updatedAt: 20 },
      { id: 'b', title: 'added', category: 'Reading', tags: [], question: '', answer: '', annotations: [], updatedAt: 5 },
      { id: 'a', title: 'older', category: 'General', tags: [], question: '', answer: '', annotations: [], updatedAt: 5 },
    ],
    categories: ['Reading', 'AI Agent'],
  });
  assert.equal(res.added, 1);
  assert.equal(res.updated, 1);
  assert.equal(res.skipped, 1);
  assert.equal(res.state.docs.find((d) => d.id === 'a').title, 'newer');
  assert.deepEqual([...res.state.categories].sort(), ['AI Agent', 'General', 'Reading']);
});

/* ───────────── 云端变更 ───────────── */

test('capsule.applyRemoteState：新增、较新覆盖、较旧忽略、删除', () => {
  const state = {
    docs: [
      { id: 'a', title: 'local', category: 'General', tags: [], question: '', answer: '', annotations: [], updatedAt: 10 },
    ],
    categories: ['General'],
    activeDocId: 'a',
    ui: capsule.defaultUI(),
  };
  const newer = capsule.applyRemoteState(state, [
    { id: 'a', data: { id: 'a', title: 'remote', updatedAt: 20 } },
    { id: 'b', data: { id: 'b', title: 'added', updatedAt: 20 } },
  ]);
  assert.equal(newer.changed, true);
  assert.equal(newer.state.docs.find((d) => d.id === 'a').title, 'remote');
  assert.equal(newer.state.docs.find((d) => d.id === 'b').title, 'added');

  const older = capsule.applyRemoteState(newer.state, [
    { id: 'a', data: { id: 'a', title: 'stale', updatedAt: 5 } },
  ]);
  assert.equal(older.changed, false);
  assert.equal(older.state.docs.find((d) => d.id === 'a').title, 'remote');

  const deleted = capsule.applyRemoteState(newer.state, [{ id: 'b', op: 'delete' }]);
  assert.equal(deleted.changed, true);
  assert.equal(deleted.state.docs.some((d) => d.id === 'b'), false);
});

/* ───────────── 分类 ───────────── */

test('capsule 分类：新增、重命名、删除后文档回 General', () => {
  const state = {
    docs: [
      { id: 'a', title: 'x', category: 'Old', tags: [], question: '', answer: '', annotations: [], updatedAt: 1 },
    ],
    categories: ['General', 'Old'],
    activeDocId: 'a',
    ui: capsule.defaultUI(),
  };
  const added = capsule.addCategory(state, 'New');
  assert.ok(added.state.categories.includes('New'));
  assert.equal(capsule.addCategory(added.state, 'New').error, '分类已存在');

  const renamed = capsule.renameCategory(added.state, 'Old', 'Renamed');
  assert.ok(renamed.state.categories.includes('Renamed'));
  assert.equal(renamed.state.docs[0].category, 'Renamed');

  const deleted = capsule.deleteCategory(renamed.state, 'Renamed');
  assert.equal(deleted.categories.includes('Renamed'), false);
  assert.equal(deleted.docs[0].category, 'General');
  assert.equal(capsule.deleteCategory(deleted, 'General'), deleted);
});

/* ───────────── 标注包裹 ───────────── */

test('capsule.wrapAnnotations：长词优先、跳过标签、转义文本', () => {
  const html = '<p>Use annotations and annotation here.</p>';
  const out = capsule.wrapAnnotations(html, [
    { id: '1', text: 'annotation', note: '' },
    { id: '2', text: 'annotations', note: '' },
  ]);
  assert.equal(out.includes('data-anno="2"'), true);
  assert.equal(out.includes('data-anno="1"'), true);
  assert.equal(out.split('<span').length - 1, 2);
  assert.equal(out.includes('<p<span'), false);

  const escaped = capsule.wrapAnnotations('<p>hit</p>', [{ id: '"><img src=x>', text: 'hit', note: '' }]);
  assert.equal(escaped.includes('data-anno="&quot;&gt;&lt;img src=x&gt;"'), true);
  assert.equal(escaped.includes('<img'), false);
});

/* ───────────── Markdown 导出 ───────────── */

test('capsule.exportMarkdownText：包含正文、术语锚点和返回链接', () => {
  const doc = {
    id: 'd', title: 'Title', category: 'General', tags: [], question: 'see word', answer: 'word here',
    annotations: [{ id: 'a', text: 'word', note: 'meaning' }], updatedAt: 1,
  };
  const md = capsule.exportMarkdownText(doc, new Date('2026-01-02T00:00:00Z'));
  assert.equal(md.includes('# Title'), true);
  assert.equal(md.includes('id="text-0"'), true);
  assert.equal(md.includes('href="#glossary-0"'), true);
  assert.equal(md.includes('## 📝 Contextual Glossary'), true);
  assert.equal(md.includes('<strong>word</strong>: meaning'), true);
});

/* ───────────── 其他工具的引导数据 ───────────── */

test('contextly.ensureSeedCard：首次写入 epiphany，之后幂等', (t) => {
  const win = withWindow(t);
  assert.equal(contextly.ensureSeedCard(), true);
  const data = readKey(win, 'glass_memory_v2');
  assert.equal(data.cards.length, 1);
  assert.equal(data.cards[0].term, 'epiphany');
  assert.equal(contextly.ensureSeedCard(), false);
  assert.equal(readKey(win, 'glass_memory_v2').cards.length, 1);

  // 用户删光卡片后不再自动补
  contextly.saveData({ settings: {}, cards: [] });
  assert.equal(contextly.ensureSeedCard(), false);
  assert.equal(contextly.loadData().cards.length, 0);
});

test('expressing.loadState：首次引导一张示例，删光后不重复引导', (t) => {
  const win = withWindow(t);
  const first = expressing.loadState();
  assert.equal(first.docs.length, 1);
  assert.equal(first.docs[0].title, 'Expressing Strong Preference');
  assert.equal(first.docs[0].annotations.length, 1);
  expressing.persistState({ ...first, docs: [], activeDocId: null });
  const again = expressing.loadState();
  assert.equal(again.docs.length, 0);
  assert.ok(readKey(win, 'bri_fix_pro_v1'));
});
