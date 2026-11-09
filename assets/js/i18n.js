// 读者界面的中英文字（编辑器界面只给作者用，保持中文）
import { storageGet, storageSet } from './util.js';

const STR = {
  home: ['首页', 'Home'],
  search: ['搜索人物、概念、事件…', 'Search characters, concepts, events…'],
  searchTitle: ['搜索', 'Search'],
  noResults: ['没有找到。', 'No results.'],
  progress: ['阅读进度', 'Reading progress'],
  progressTip: ['选择你读到哪里，超出的内容会被遮住', 'Pick how far you have read; anything beyond is hidden'],
  spoilerBlock: ['⚠ 这里含有「{0}」之后的剧透', '⚠ Spoilers beyond “{0}”'],
  spoilerHint: ['点击显示（或在顶部调整阅读进度）', 'Click to reveal (or change your reading progress above)'],
  spoiler: ['剧透', 'Spoiler'],
  notPublished: ['这部分内容尚未公开。', 'This content has not been published yet.'],
  hiddenFields: ['⚠ 还有 {0} 项设定含剧透（点击显示）', '⚠ {0} more field(s) hidden for spoilers (click to reveal)'],
  toc: ['目录', 'Contents'],
  aka: ['又称：', 'Also known as: '],
  date: ['时间', 'Date'],
  entries: ['{0} 条', '{0} entries'],
  noPages: ['还没有页面。', 'No pages yet.'],
  noGroups: ['还没有子界面。', 'No categories yet.'],
  noEntries: ['这个子界面还没有条目。', 'Nothing here yet.'],
  noEvents: ['这条时间线还没有事件。', 'No events on this timeline yet.'],
  noModules: ['还没有任何模块。', 'Nothing here yet.'],
  noEra: ['未归入纪元', 'Unassigned'],
  moduleMissing: ['找不到这个模块', 'Section not found'],
  itemMissing: ['找不到这个条目', 'Page not found'],
  backHome: ['回首页', 'Back to home'],
  back: ['返回', 'Back to'],
  untranslated: ['', 'Not yet translated — showing the Chinese original'],
  missingLink: ['还没有这个页面', 'This page does not exist yet'],
  loading: ['载入中…', 'Loading…'],
  menu: ['菜单', 'Menu'],
  type_wiki: ['百科页面', 'Articles'],
  type_catalog: ['分类图鉴', 'Catalog'],
  type_timeline: ['时间线', 'Timeline'],
};

const LANG_KEY = 'arcadia-wiki-lang';
const fromUrl = new URLSearchParams(location.search).get('lang');
export let lang = fromUrl === 'en' || fromUrl === 'zh' ? fromUrl
  : storageGet(LANG_KEY) || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');

export function setLang(l) {
  lang = l;
  storageSet(LANG_KEY, l);
  document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
}

export function ui(key, ...args) {
  const pair = STR[key];
  if (!pair) return key;
  let s = pair[lang === 'en' ? 1 : 0] || pair[0];
  args.forEach((a, i) => { s = s.replace(`{${i}}`, a); });
  return s;
}

// 取内容字段：英文模式下优先用 xxx_en，没有就退回中文
export function tx(obj, key) {
  if (!obj) return '';
  if (lang === 'en') {
    const en = obj[key + '_en'];
    if (en != null && String(en).trim() !== '') return en;
  }
  return obj[key] ?? '';
}

// 英文模式下这个字段是否缺翻译（中文有内容、英文为空）
export function lacksEn(obj, key) {
  return lang === 'en' && obj && String(obj[key] || '').trim() !== '' && !String(obj[key + '_en'] || '').trim();
}

// 别名：两种语言合并
export function txList(obj, key) {
  const zh = obj?.[key] || [];
  const en = obj?.[key + '_en'] || [];
  return lang === 'en' && en.length ? en : zh;
}
