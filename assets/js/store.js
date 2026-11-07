// 数据层：读取数据、草稿（仅编辑器）、查找与索引
import { storageGet, storageSet, storageDel, uid } from './util.js';
import { plainText } from './markdown.js';

const DRAFT_KEY = 'arcadia-wiki-draft';
const PROGRESS_KEY = 'arcadia-wiki-progress';
const REVEAL_KEY = 'arcadia-wiki-reveal';
try { localStorage.removeItem(REVEAL_KEY); } catch { /* 清掉旧版本永久保存的记录 */ }
function sessionGet() { try { return JSON.parse(sessionStorage.getItem(REVEAL_KEY) || '[]'); } catch { return []; } }
function sessionSet(v) { try { sessionStorage.setItem(REVEAL_KEY, JSON.stringify(v)); } catch { /* ignore */ } }

export const state = {
  mode: 'read',        // 'read' 读者页 / 'edit' 编辑器页
  data: null,          // 当前显示的数据
  remote: null,        // 网站上的版本
  usingDraft: false,
  editMode: false,     // 编辑器页里：true=编辑，false=以读者视角预览
  progress: 0,
  revealed: new Set(sessionGet()),   // 读者手动点开的剧透：只在本次浏览有效
};

export const MODULE_TYPES = {
  wiki: { label: '百科页面', desc: '像维基百科：多个页面，每页有目录和章节（适合世界观常识）' },
  catalog: { label: '分类图鉴', desc: '有多个子界面（如人类 / 概念 / 特殊），每个条目带设定栏（适合人物）' },
  timeline: { label: '时间线', desc: '每个条目带时间，会自动排进时间线（适合事件）' },
};

// 读者页：直接读网站上的 data/wiki.json，不使用任何草稿
export async function loadPublic() {
  let data = null;
  try {
    const res = await fetch('data/wiki.json?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch (e) { console.warn('读取 wiki.json 失败', e); }
  setData(normalize(data || emptyData()), false);
}

// 编辑器页：remote 是从 GitHub 读到的最新版本；本机若有更新的草稿就接着用草稿
export function loadForEditor(remote) {
  normalize(remote);
  state.remote = remote;
  const draft = storageGet(DRAFT_KEY);
  if (draft?.data && (draft.data.updatedAt || 0) > (remote.updatedAt || 0)) {
    setData(normalize(draft.data), true);
  } else {
    if (draft) storageDel(DRAFT_KEY);
    setData(JSON.parse(JSON.stringify(remote)), false);
  }
}

function setData(d, usingDraft) {
  state.data = d;
  if (!state.remote) state.remote = d;
  state.usingDraft = usingDraft;
  const saved = storageGet(PROGRESS_KEY);
  const max = d.site.progress.length - 1;
  state.progress = saved == null ? Math.min(d.site.defaultProgress ?? max, max) : Math.min(saved, max);
  rebuildIndex();
}

export function emptyData() {
  return {
    version: 2, updatedAt: 0,
    site: { title: '新百科', title_en: 'New Wiki', subtitle: '', defaultProgress: 0, progress: [{ label: '全部', label_en: 'All' }] },
    modules: [],
  };
}

export function normalize(d) {
  d.site ||= {};
  d.site.title ||= '百科';
  d.site.progress ||= [{ label: '全部', label_en: 'All' }];
  d.modules ||= [];
  for (const m of d.modules) {
    m.id ||= uid('m');
    m.intro ||= '';
    m.spoiler ||= 0;
    if (m.type === 'wiki') m.pages ||= [];
    if (m.type === 'catalog') { m.groups ||= []; m.entries ||= []; for (const g of m.groups) { g.fields ||= []; g.spoiler ||= 0; } }
    if (m.type === 'timeline') {
      m.timelines ||= [{ id: 'main', title: '主时间线', title_en: 'Main timeline' }];
      m.eras ||= [];
      m.entries ||= [];
      for (const t of m.timelines) t.spoiler ||= 0;
      for (const e of m.eras) { e.id ||= uid('e'); e.spoiler ||= 0; }
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

// ---- 草稿（只在编辑器页） ----
let saveTimer = null;
export function touch() {
  state.data.updatedAt = Date.now();
  state.usingDraft = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storageSet(DRAFT_KEY, { data: state.data, savedAt: Date.now() }), 300);
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

// ---- 阅读进度 ----
export function setProgress(i) {
  state.progress = i;
  storageSet(PROGRESS_KEY, i);
  resetReveals(); // 换了阅读进度，之前点开的剧透全部重新遮住
}
export function resetReveals() {
  state.revealed.clear();
  sessionSet([]);
}
export function isHidden(spoiler) {
  return !state.editMode && (spoiler || 0) > state.progress;
}
export function reveal(key) {
  state.revealed.add(key);
  sessionSet([...state.revealed]);
}

// 条目实际的剧透等级：取条目、所在子界面/时间线、所在模块中最高的那个
export function effSpoiler(m, item) {
  let s = Math.max(m.spoiler || 0, item.spoiler || 0);
  if (m.type === 'catalog') s = Math.max(s, m.groups.find(g => g.id === item.group)?.spoiler || 0);
  if (m.type === 'timeline') {
    const tid = item.date?.timeline || m.timelines[0]?.id;
    s = Math.max(s, m.timelines.find(t => t.id === tid)?.spoiler || 0);
  }
  return s;
}

// ---- 索引：站内链接（中英文标题都认）+ 搜索 ----
let titleIndex = new Map();
let searchIndex = [];

export function rebuildIndex() {
  titleIndex = new Map();
  searchIndex = [];
  const later = [];    // 第二优先：时间线、纪元、子界面、模块
  const sections = []; // 最后：章节标题
  const add = (names, href) => { for (const n of names) if (n && !titleIndex.has(n)) titleIndex.set(n, href); };
  for (const m of state.data.modules) {
    const mh = `#/m/${encodeURIComponent(m.id)}`;
    if (m.type === 'timeline') {
      for (const t of m.timelines) later.push([[t.title, t.title_en], `${mh}/t/${t.id}`]);
      for (const e of m.eras) {
        const inEra = m.entries.find(x => Number(x.date?.sort || 0) >= (e.from ?? -Infinity) && Number(x.date?.sort || 0) < (e.to ?? Infinity));
        const tid = inEra?.date?.timeline || m.timelines[0]?.id;
        later.push([[e.title, e.title_en], `${mh}/t/${tid}/e/${e.id}`]);
      }
    }
    if (m.type === 'catalog') for (const g of m.groups) later.push([[g.title, g.title_en], `${mh}/g/${g.id}`]);
    later.push([[m.title, m.title_en], mh]);
    for (const p of itemsOf(m)) for (const s of p.sections || []) sections.push([[s.title, s.title_en], `${routeOf(m, p)}/s/${s.id}`]);
    for (const p of itemsOf(m)) {
      const href = routeOf(m, p);
      const names = [p.title, p.title_en, p.subtitle, p.subtitle_en, ...(p.aliases || []), ...(p.aliases_en || [])].filter(Boolean);
      for (const n of names) if (!titleIndex.has(n)) titleIndex.set(n, href);
      // 每段文字都记下剧透等级，搜索时只用读者能看的部分
      const parts = [];
      for (const suf of ['', '_en']) {
        parts.push([p['summary' + suf], 0]);
        for (const s of p.sections || []) parts.push([s['title' + suf], s.spoiler], [s['body' + suf], s.spoiler]);
        for (const r of p.infobox || []) parts.push([r['k' + suf], r.spoiler], [r['v' + suf], r.spoiler]);
      }
      searchIndex.push({ m, p, href, names: names.join(' '), parts: parts.filter(x => x[0]).map(([t, sp]) => [plainText(t), sp || 0]), spoiler: effSpoiler(m, p) });
    }
  }
  for (const [names, href] of [...later, ...sections]) add(names, href);
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
    const t = it.names.toLowerCase();
    const text = it.parts.filter(([, sp]) => !isHidden(sp)).map(([t]) => t).join(' ');
    const body = text.toLowerCase();
    let score = 0;
    if (t.split(' ').includes(q)) score = 100; else if (t.includes(q)) score = 50; else if (body.includes(q)) score = 10;
    if (score) {
      const i = body.indexOf(q);
      const snip = i >= 0 ? text.slice(Math.max(0, i - 30), i + 70) : text.slice(0, 90);
      res.push({ ...it, score, snip });
    }
  }
  return res.sort((a, b) => b.score - a.score).slice(0, 50);
}
