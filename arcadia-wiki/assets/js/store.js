// 数据层：读取 data/wiki.json、本地草稿、查找与索引
import { storageGet, storageSet, storageDel, uid } from './util.js';
import { plainText } from './markdown.js';

const DRAFT_KEY = 'arcadia-wiki-draft';
const PROGRESS_KEY = 'arcadia-wiki-progress';
const REVEAL_KEY = 'arcadia-wiki-reveal';

export const state = {
  data: null,          // 当前显示的数据（线上版或草稿）
  remote: null,        // 线上版本
  usingDraft: false,
  editMode: false,
  progress: null,      // 读者选择的阅读进度（数字下标）
  revealed: new Set(storageGet(REVEAL_KEY, [])), // 读者手动点开的剧透块
};

// 三种模块类型
export const MODULE_TYPES = {
  wiki: { label: '百科页面', desc: '像维基百科：多个页面，每页有目录和章节（适合世界观常识）' },
  catalog: { label: '分类图鉴', desc: '有多个子界面（如人类 / 概念 / 特殊），每个条目带设定栏（适合人物）' },
  timeline: { label: '时间线', desc: '每个条目带时间，会自动排进时间线（适合事件）' },
};

export async function loadData() {
  let remote = null;
  try {
    const res = await fetch('data/wiki.json?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) remote = await res.json();
  } catch (e) { console.warn('读取 wiki.json 失败', e); }
  if (!remote) remote = emptyData();
  normalize(remote);
  state.remote = remote;

  const draft = storageGet(DRAFT_KEY);
  // 线上版本比草稿新（例如草稿已经发布过），就丢掉草稿
  if (draft && draft.data && (draft.data.updatedAt || 0) > (remote.updatedAt || 0)) {
    normalize(draft.data);
    state.data = draft.data;
    state.usingDraft = true;
  } else {
    if (draft) storageDel(DRAFT_KEY);
    state.data = remote;
    state.usingDraft = false;
  }

  const saved = storageGet(PROGRESS_KEY);
  const max = state.data.site.progress.length - 1;
  state.progress = saved == null ? (state.data.site.defaultProgress ?? max) : Math.min(saved, max);
  rebuildIndex();
}

export function emptyData() {
  return {
    version: 1,
    updatedAt: 0,
    site: { title: '新百科', subtitle: '', defaultProgress: 0, progress: [{ label: '全部' }] },
    modules: [],
  };
}

// 补全缺失字段，保证旧数据也能用
export function normalize(d) {
  d.site ||= {};
  d.site.title ||= '百科';
  d.site.progress ||= [{ label: '全部' }];
  d.modules ||= [];
  for (const m of d.modules) {
    m.id ||= uid('m');
    m.intro ||= '';
    if (m.type === 'wiki') m.pages ||= [];
    if (m.type === 'catalog') { m.groups ||= []; m.entries ||= []; }
    if (m.type === 'timeline') {
      m.timelines ||= [{ id: 'main', title: '主时间线' }];
      m.eras ||= [];
      m.entries ||= [];
    }
    for (const p of itemsOf(m)) {
      p.id ||= uid('p');
      p.sections ||= [];
      p.spoiler ||= 0;
      if (m.type !== 'wiki') p.infobox ||= [];
      for (const s of p.sections) { s.id ||= uid('s'); s.level ||= 2; s.spoiler ||= 0; }
      if (m.type === 'timeline') p.date ||= { sort: 0, label: '' };
    }
  }
  return d;
}

export function itemsOf(m) {
  return m.type === 'wiki' ? m.pages : m.entries;
}

export function findModule(id) {
  return state.data.modules.find(m => m.id === id);
}

export function findItem(m, id) {
  return itemsOf(m).find(p => p.id === id);
}

export function routeOf(m, item) {
  return `#/m/${encodeURIComponent(m.id)}/p/${encodeURIComponent(item.id)}`;
}

// ---- 草稿 ----
let saveTimer = null;
export function touch() {
  state.data.updatedAt = Date.now();
  state.usingDraft = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    storageSet(DRAFT_KEY, { data: state.data, savedAt: Date.now() });
  }, 300);
  rebuildIndex();
}

export function discardDraft() {
  storageDel(DRAFT_KEY);
  state.data = JSON.parse(JSON.stringify(state.remote));
  state.usingDraft = false;
  rebuildIndex();
}

export function markPublished() {
  state.remote = JSON.parse(JSON.stringify(state.data));
  state.usingDraft = false;
  storageDel(DRAFT_KEY);
}

// ---- 阅读进度（防剧透） ----
export function setProgress(i) {
  state.progress = i;
  storageSet(PROGRESS_KEY, i);
}

export function isHidden(spoiler) {
  return !state.editMode && (spoiler || 0) > state.progress;
}

export function reveal(key) {
  state.revealed.add(key);
  storageSet(REVEAL_KEY, [...state.revealed]);
}

// ---- 索引：站内链接 + 搜索 ----
let titleIndex = new Map();
let searchIndex = [];

export function rebuildIndex() {
  titleIndex = new Map();
  searchIndex = [];
  for (const m of state.data.modules) {
    for (const p of itemsOf(m)) {
      const href = routeOf(m, p);
      const names = [p.title, p.subtitle, ...(p.aliases || [])].filter(Boolean);
      for (const n of names) if (!titleIndex.has(n)) titleIndex.set(n, href);
      const text = [p.summary, ...(p.sections || []).map(s => s.title + ' ' + s.body),
        ...(p.infobox || []).map(r => r.k + ' ' + r.v)].map(plainText).join(' ');
      searchIndex.push({ m, p, href, title: p.title, sub: p.subtitle || '', text, spoiler: p.spoiler || 0 });
    }
  }
}

export function resolveLink(title) {
  return titleIndex.get(title) || null;
}

export function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const res = [];
  for (const it of searchIndex) {
    if (isHidden(it.spoiler)) continue;
    const t = (it.title + ' ' + it.sub).toLowerCase();
    const body = it.text.toLowerCase();
    let score = 0;
    if (t === q) score = 100; else if (t.includes(q)) score = 50; else if (body.includes(q)) score = 10;
    if (score) {
      const i = body.indexOf(q);
      const snip = i >= 0 ? it.text.slice(Math.max(0, i - 30), i + 60) : (it.text.slice(0, 80));
      res.push({ ...it, score, snip });
    }
  }
  return res.sort((a, b) => b.score - a.score).slice(0, 50);
}
