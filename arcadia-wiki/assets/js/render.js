// 视图层：根据路由把数据画成页面。编辑按钮只在编辑模式下出现，
// 点击行为由 editor.js 通过 data-act 统一处理。
import { esc } from './util.js';
import { renderText, plainText } from './markdown.js';
import {
  state, MODULE_TYPES, findModule, findItem, itemsOf, routeOf,
  isHidden, resolveLink, search,
} from './store.js';

const md = (t) => renderText(t, { resolveLink });

// ---------- 小部件 ----------
function btn(act, label, data = {}, cls = '') {
  if (!state.editMode) return '';
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button class="ebtn ${cls}" data-act="${act}" ${attrs}>${label}</button>`;
}

function progressLabel(i) {
  return state.data.site.progress[i]?.label ?? `进度 ${i}`;
}

function spoilerTag(spoiler) {
  if (!state.editMode || !spoiler) return '';
  return `<span class="spoiler-tag" title="读者需读到「${esc(progressLabel(spoiler))}」才能看到">剧透：${esc(progressLabel(spoiler))}</span>`;
}

// 剧透遮挡：内容超出读者进度时，显示一个可点开的占位
function guard(key, spoiler, html) {
  if (!isHidden(spoiler) || state.revealed.has(key)) return html;
  return `<div class="spoiler-block" data-act="reveal" data-key="${esc(key)}">
    <div>⚠ 这里含有「${esc(progressLabel(spoiler))}」之后的剧透</div>
    <small>点击显示（或在顶部调整阅读进度）</small></div>`;
}

function breadcrumbs(parts) {
  return `<nav class="crumbs">${parts.map(([href, t]) =>
    href ? `<a href="${href}">${esc(t)}</a>` : `<span>${esc(t)}</span>`).join('<span class="sep">›</span>')}</nav>`;
}

function avatar(item) {
  if (item.image) return `<img src="${esc(item.image)}" alt="" loading="lazy">`;
  const ch = (item.title || '?').trim().charAt(0);
  return `<span class="avatar-letter">${esc(ch)}</span>`;
}

// ---------- 侧边导航 ----------
export function renderNav(route) {
  const d = state.data;
  const items = d.modules.map(m => {
    const active = route.m === m.id;
    let sub = '';
    if (active) {
      if (m.type === 'catalog') {
        sub = m.groups.map(g => `<a class="nav-sub ${route.g === g.id ? 'on' : ''}" href="#/m/${m.id}/g/${g.id}">${esc(g.title)}</a>`).join('');
      } else if (m.type === 'wiki') {
        sub = m.pages.filter(p => !isHidden(p.spoiler)).map(p =>
          `<a class="nav-sub ${route.p === p.id ? 'on' : ''}" href="${routeOf(m, p)}">${esc(p.title)}</a>`).join('');
      } else if (m.type === 'timeline' && m.timelines.length > 1) {
        sub = m.timelines.map(t => `<a class="nav-sub ${route.t === t.id ? 'on' : ''}" href="#/m/${m.id}/t/${t.id}">${esc(t.title)}</a>`).join('');
      }
    }
    return `<div class="nav-group ${active ? 'open' : ''}">
      <a class="nav-mod ${active && !route.p && !route.g && !route.t ? 'on' : ''}" href="#/m/${m.id}">
        <span class="nav-ico">${esc(m.icon || '•')}</span>${esc(m.title)}</a>${sub}</div>`;
  }).join('');
  return `<a class="nav-home ${route.view === 'home' ? 'on' : ''}" href="#/">首页</a>${items}
    ${btn('add-module', '＋ 新建模块', {}, 'wide')}`;
}

// ---------- 首页 ----------
function viewHome() {
  const d = state.data;
  const cards = d.modules.map((m, i) => {
    const n = itemsOf(m).filter(p => !isHidden(p.spoiler)).length;
    return `<div class="mod-card">
      <a href="#/m/${m.id}" class="mod-link">
        <div class="mod-ico">${esc(m.icon || '•')}</div>
        <div><h3>${esc(m.title)}</h3><p>${esc(plainText(m.intro).slice(0, 60))}</p>
        <small>${MODULE_TYPES[m.type]?.label || m.type} · ${n} 条</small></div></a>
      <div class="ebar">${btn('edit-module', '编辑', { m: m.id })}${btn('move-module', '↑', { m: m.id, d: -1 })}${btn('move-module', '↓', { m: m.id, d: 1 })}${btn('del-module', '删除', { m: m.id }, 'danger')}</div>
    </div>`;
  }).join('');
  return `<section class="home">
    <header class="hero"><h1>${esc(d.site.title)}</h1><p>${esc(d.site.subtitle || '')}</p>
      <div class="ebar">${btn('edit-site', '编辑站点信息与阅读进度')}</div></header>
    ${d.site.intro ? `<div class="prose">${md(d.site.intro)}</div>` : ''}
    <div class="mod-grid">${cards}</div>
    ${d.modules.length === 0 ? `<p class="empty">还没有任何模块。${state.editMode ? '点左边“新建模块”开始。' : '打开编辑模式来创建。'}</p>` : ''}
  </section>`;
}

// ---------- 模块首页 ----------
function moduleHeader(m, extra = '') {
  return `${breadcrumbs([['#/', '首页'], [null, m.title]])}
    <h1 class="title">${esc(m.icon || '')} ${esc(m.title)}</h1>
    <div class="ebar">${btn('edit-module', '编辑模块', { m: m.id })}${extra}</div>
    ${m.intro ? `<div class="prose lead">${md(m.intro)}</div>` : ''}`;
}

function viewWikiIndex(m) {
  const list = m.pages.map(p => guard(`${p.id}:`, p.spoiler, `
    <a class="row-link" href="${routeOf(m, p)}"><strong>${esc(p.title)}</strong>
      <span>${esc(plainText(p.summary).slice(0, 80))}</span>${spoilerTag(p.spoiler)}</a>`)).join('');
  return `${moduleHeader(m, btn('add-page', '＋ 新建页面', { m: m.id }))}
    <div class="row-list">${list || '<p class="empty">还没有页面。</p>'}</div>`;
}

function viewCatalog(m, gid) {
  const g = m.groups.find(x => x.id === gid) || m.groups[0];
  const tabs = m.groups.map(x => `<a class="tab ${g && x.id === g.id ? 'on' : ''}" href="#/m/${m.id}/g/${x.id}">${esc(x.title)}
      <small>${m.entries.filter(e => e.group === x.id && !isHidden(e.spoiler)).length}</small></a>`).join('');
  let body = '<p class="empty">还没有子界面。</p>';
  if (g) {
    const cards = m.entries.filter(e => e.group === g.id).map(e => guard(`${e.id}:`, e.spoiler, `
      <a class="card" href="${routeOf(m, e)}">
        <div class="card-img">${avatar(e)}</div>
        <div class="card-txt"><strong>${esc(e.title)}</strong><small>${esc(e.subtitle || '')}</small>
        <span>${esc(plainText(e.summary).slice(0, 40))}</span>${spoilerTag(e.spoiler)}</div></a>`)).join('');
    body = `<div class="group-head">
        ${g.intro ? `<div class="prose">${md(g.intro)}</div>` : ''}
        <div class="ebar">${btn('add-entry', '＋ 新建条目', { m: m.id, g: g.id })}${btn('edit-group', '编辑这个子界面', { m: m.id, g: g.id })}${btn('move-group', '←', { m: m.id, g: g.id, d: -1 })}${btn('move-group', '→', { m: m.id, g: g.id, d: 1 })}${btn('del-group', '删除子界面', { m: m.id, g: g.id }, 'danger')}</div>
      </div>
      <div class="card-grid">${cards || '<p class="empty">这个子界面还没有条目。</p>'}</div>`;
  }
  return `${moduleHeader(m)}
    <div class="tabs">${tabs}${btn('add-group', '＋ 子界面', { m: m.id })}</div>${body}`;
}

function eraOf(m, sort) {
  return m.eras.find(e => sort >= Number(e.from ?? -Infinity) && sort < Number(e.to ?? Infinity));
}

function viewTimeline(m, tid) {
  const t = m.timelines.find(x => x.id === tid) || m.timelines[0];
  const tabs = m.timelines.length > 1 || state.editMode
    ? `<div class="tabs">${m.timelines.map(x => `<a class="tab ${t && x.id === t.id ? 'on' : ''}" href="#/m/${m.id}/t/${x.id}">${esc(x.title)}</a>`).join('')}${btn('add-timeline', '＋ 时间线', { m: m.id })}</div>` : '';
  const events = m.entries
    .filter(e => (e.date?.timeline || m.timelines[0]?.id) === t?.id)
    .sort((a, b) => Number(a.date?.sort || 0) - Number(b.date?.sort || 0));
  let html = '', lastEra;
  for (const e of events) {
    const era = eraOf(m, Number(e.date?.sort || 0));
    if (era !== lastEra) {
      html += `<div class="tl-era" style="--era:${esc(era?.color || '#888')}">${esc(era?.title || '未归入纪元')}</div>`;
      lastEra = era;
    }
    html += guard(`${e.id}:`, e.spoiler, `
      <a class="tl-item" href="${routeOf(m, e)}" style="--era:${esc(era?.color || '#888')}">
        <span class="tl-dot"></span>
        <span class="tl-date">${esc(e.date?.label || e.date?.sort || '')}</span>
        <span class="tl-body"><strong>${esc(e.title)}</strong><small>${esc(plainText(e.summary).slice(0, 70))}</small>${spoilerTag(e.spoiler)}</span>
      </a>`);
  }
  const ebar = t ? `${btn('add-event', '＋ 新建事件', { m: m.id, t: t.id })}${btn('edit-eras', '编辑纪元', { m: m.id })}${btn('edit-timeline', '编辑这条时间线', { m: m.id, t: t.id })}${m.timelines.length > 1 ? btn('del-timeline', '删除时间线', { m: m.id, t: t.id }, 'danger') : ''}` : '';
  return `${moduleHeader(m)}${tabs}<div class="ebar">${ebar}</div>
    <div class="timeline">${html || '<p class="empty">这条时间线还没有事件。</p>'}</div>`;
}

// ---------- 条目页（三种模块共用） ----------
function numberSections(sections) {
  let a = 0, b = 0;
  return sections.map(s => {
    if (s.level === 3) { b++; return `${a || 1}.${b}`; }
    a++; b = 0; return `${a}`;
  });
}

function viewItem(m, item) {
  const ids = { m: m.id, p: item.id };
  const crumbs = [['#/', '首页'], [`#/m/${m.id}`, m.title]];
  if (m.type === 'catalog') {
    const g = m.groups.find(x => x.id === item.group);
    if (g) crumbs.push([`#/m/${m.id}/g/${g.id}`, g.title]);
  }
  crumbs.push([null, item.title]);

  if (isHidden(item.spoiler) && !state.revealed.has(`${item.id}:`)) {
    return `${breadcrumbs(crumbs)}<h1 class="title">${esc(item.title)}</h1>${guard(`${item.id}:`, item.spoiler, '')}`;
  }

  const nums = numberSections(item.sections);
  const toc = item.sections.map((s, i) => isHidden(s.spoiler) && !state.revealed.has(`${item.id}:${s.id}`) ? '' :
    `<a class="toc-l${s.level}" data-goto="sec-${esc(s.id)}"><span>${nums[i]}</span>${esc(s.title)}</a>`).join('');

  let info = '';
  if (m.type !== 'wiki') {
    const rows = (item.infobox || []).map((r, i) => isHidden(r.spoiler) && !state.revealed.has(`${item.id}:ib${i}`)
      ? `<tr><th>${esc(r.k)}</th><td><span class="spoiler-inline" data-act="reveal" data-key="${item.id}:ib${i}">剧透</span></td></tr>`
      : `<tr><th>${esc(r.k)}</th><td>${renderText(r.v, { resolveLink }).replace(/^<p>|<\/p>$/g, '')}${spoilerTag(r.spoiler)}</td></tr>`).join('');
    const dateRow = m.type === 'timeline'
      ? `<tr><th>时间</th><td>${esc(item.date?.label || '')}${state.editMode ? ` <small class="muted">(排序值 ${esc(item.date?.sort ?? 0)})</small>` : ''}</td></tr>` : '';
    info = `<aside class="infobox">
      <div class="ib-title">${esc(item.title)}</div>
      ${item.image ? `<div class="ib-img"><img src="${esc(item.image)}" alt=""></div>` : ''}
      ${item.subtitle ? `<div class="ib-sub">${esc(item.subtitle)}</div>` : ''}
      <table>${dateRow}${rows}</table>
      ${btn('edit-infobox', m.type === 'catalog' ? '✎ 编辑角色设定栏' : '✎ 编辑信息栏', ids, 'wide')}
    </aside>`;
  }

  const sections = item.sections.map((s, i) => {
    const tag = s.level === 3 ? 'h3' : 'h2';
    const ctrl = `<span class="ebar inline">${btn('edit-section', '编辑', { ...ids, s: s.id })}${btn('move-section', '↑', { ...ids, s: s.id, d: -1 })}${btn('move-section', '↓', { ...ids, s: s.id, d: 1 })}${btn('add-section', '＋下方插入', { ...ids, s: s.id })}${btn('del-section', '删除', { ...ids, s: s.id }, 'danger')}</span>`;
    return `<section class="sec" id="sec-${esc(s.id)}">
      <${tag}><span class="secnum">${nums[i]}</span>${esc(s.title)}${spoilerTag(s.spoiler)}${ctrl}</${tag}>
      ${guard(`${item.id}:${s.id}`, s.spoiler, `<div class="prose">${md(s.body)}</div>`)}
    </section>`;
  }).join('');

  const aliases = item.aliases?.length ? `<div class="aliases">又称：${item.aliases.map(esc).join('、')}</div>` : '';
  const html = `${breadcrumbs(crumbs)}
    <h1 class="title">${esc(item.title)}${item.subtitle && m.type === 'wiki' ? `<small>${esc(item.subtitle)}</small>` : ''}${spoilerTag(item.spoiler)}</h1>
    <div class="ebar">${btn('edit-item', '编辑基本信息', ids)}${btn('add-section', '＋ 添加章节', ids)}${btn('del-item', '删除此条目', ids, 'danger')}</div>
    ${aliases}
    <div class="article">${info}
      ${item.summary ? `<div class="prose lead">${md(item.summary)}</div>` : ''}
      ${toc ? `<div class="toc-inline"><div class="toc-h">目录</div>${toc}</div>` : ''}
      ${sections || (state.editMode ? '<p class="empty">还没有章节，点“添加章节”。</p>' : '')}
    </div>`;
  return { html, toc };
}

// ---------- 搜索 ----------
function viewSearch(q) {
  const res = search(q);
  return `${breadcrumbs([['#/', '首页'], [null, '搜索']])}
    <h1 class="title">搜索：${esc(q)}</h1>
    <div class="row-list">${res.map(r => `<a class="row-link" href="${r.href}"><strong>${esc(r.title)}</strong>
      <small>${esc(r.m.title)}${r.sub ? ' · ' + esc(r.sub) : ''}</small><span>${esc(r.snip)}</span></a>`).join('') || '<p class="empty">没有找到。</p>'}</div>`;
}

// ---------- 路由入口 ----------
export function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const r = { view: 'home' };
  if (seg[0] === 'search') { r.view = 'search'; r.q = new URLSearchParams(query || '').get('q') || ''; return r; }
  if (seg[0] === 'm') {
    r.view = 'module'; r.m = seg[1];
    for (let i = 2; i < seg.length; i += 2) r[seg[i]] = seg[i + 1];
    if (r.p) r.view = 'item';
  }
  return r;
}

export function renderMain(route) {
  if (route.view === 'search') return { html: viewSearch(route.q), toc: '' };
  if (route.view === 'home') return { html: viewHome(), toc: '' };
  const m = findModule(route.m);
  if (!m) return { html: `<h1 class="title">找不到这个模块</h1><p><a href="#/">回首页</a></p>`, toc: '' };
  if (route.view === 'item') {
    const item = findItem(m, route.p);
    if (!item) return { html: `<h1 class="title">找不到这个条目</h1><p><a href="#/m/${m.id}">返回 ${esc(m.title)}</a></p>`, toc: '' };
    return viewItem(m, item);
  }
  if (m.type === 'wiki') return { html: viewWikiIndex(m), toc: '' };
  if (m.type === 'catalog') return { html: viewCatalog(m, route.g), toc: '' };
  if (m.type === 'timeline') return { html: viewTimeline(m, route.t), toc: '' };
  return { html: '未知模块类型', toc: '' };
}
