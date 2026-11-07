// 视图层：根据路由把数据画成页面（中英双语）。
// 编辑按钮只在编辑器页的编辑状态下出现，点击行为由 editor.js 处理。
import { esc } from './util.js';
import { renderText, plainText } from './markdown.js';
import { ui, tx, lacksEn, txList, lang } from './i18n.js';
import {
  state, findModule, findItem, itemsOf, routeOf, isHidden, resolveLink, search,
} from './store.js';

const md = (t) => renderText(t, { resolveLink });
const T = (obj, key) => esc(tx(obj, key));

// ---------- 小部件 ----------
function btn(act, label, data = {}, cls = '') {
  if (!state.editMode) return '';
  const attrs = Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button class="ebtn ${cls}" data-act="${act}" ${attrs}>${label}</button>`;
}

// 翻译状态提示：编辑时标出缺英文的地方；英文读者看到中文原文时给个小标记
function enTag(obj, key) {
  if (state.editMode) {
    return obj && String(obj[key] || '').trim() && !String(obj[key + '_en'] || '').trim()
      ? '<span class="en-missing" title="这里还没有英文">缺英文</span>' : '';
  }
  return lacksEn(obj, key) ? `<span class="zh-badge" title="${esc(ui('untranslated'))}">中</span>` : '';
}

function progressLabel(i) {
  const p = state.data.site.progress[i];
  return p ? tx(p, 'label') : `#${i}`;
}

function spoilerTag(spoiler) {
  if (!state.editMode || !spoiler) return '';
  return `<span class="spoiler-tag" title="读者需读到「${esc(progressLabel(spoiler))}」才能看到">剧透：${esc(progressLabel(spoiler))}</span>`;
}

function guard(key, spoiler, html) {
  if (!isHidden(spoiler) || state.revealed.has(key)) return html;
  return `<div class="spoiler-block" data-reveal="${esc(key)}">
    <div>${esc(ui('spoilerBlock', progressLabel(spoiler)))}</div>
    <small>${esc(ui('spoilerHint'))}</small></div>`;
}

function breadcrumbs(parts) {
  return `<nav class="crumbs">${parts.map(([href, t]) =>
    href ? `<a href="${href}">${esc(t)}</a>` : `<span>${esc(t)}</span>`).join('<span class="sep">›</span>')}</nav>`;
}

function avatar(item) {
  if (item.image) return `<img src="${esc(item.image)}" alt="" loading="lazy">`;
  const ch = (tx(item, 'title') || '?').trim().charAt(0);
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
        sub = m.groups.map(g => `<a class="nav-sub ${route.g === g.id ? 'on' : ''}" href="#/m/${m.id}/g/${g.id}">${T(g, 'title')}</a>`).join('');
      } else if (m.type === 'wiki') {
        sub = m.pages.filter(p => !isHidden(p.spoiler)).map(p =>
          `<a class="nav-sub ${route.p === p.id ? 'on' : ''}" href="${routeOf(m, p)}">${T(p, 'title')}</a>`).join('');
      } else if (m.type === 'timeline' && m.timelines.length > 1) {
        sub = m.timelines.map(t => `<a class="nav-sub ${route.t === t.id ? 'on' : ''}" href="#/m/${m.id}/t/${t.id}">${T(t, 'title')}</a>`).join('');
      }
    }
    return `<div class="nav-group ${active ? 'open' : ''}">
      <a class="nav-mod ${active && !route.p && !route.g && !route.t ? 'on' : ''}" href="#/m/${m.id}">
        <span class="nav-ico">${esc(m.icon || '•')}</span>${T(m, 'title')}</a>${sub}</div>`;
  }).join('');
  return `<a class="nav-home ${route.view === 'home' ? 'on' : ''}" href="#/">${esc(ui('home'))}</a>${items}
    ${btn('add-module', '＋ 新建模块', {}, 'wide')}`;
}

// ---------- 首页 ----------
function viewHome() {
  const d = state.data;
  const cards = d.modules.map(m => {
    const n = itemsOf(m).filter(p => !isHidden(p.spoiler)).length;
    return `<div class="mod-card">
      <a href="#/m/${m.id}" class="mod-link">
        <div class="mod-ico">${esc(m.icon || '•')}</div>
        <div><h3>${T(m, 'title')}${enTag(m, 'title')}</h3><p>${esc(plainText(tx(m, 'intro')).slice(0, 70))}</p>
        <small>${esc(ui('type_' + m.type))} · ${esc(ui('entries', n))}</small></div></a>
      <div class="ebar">${btn('edit-module', '编辑', { m: m.id })}${btn('move-module', '↑', { m: m.id, d: -1 })}${btn('move-module', '↓', { m: m.id, d: 1 })}${btn('del-module', '删除', { m: m.id }, 'danger')}</div>
    </div>`;
  }).join('');
  return `<section class="home">
    <header class="hero"><h1>${T(d.site, 'title')}</h1><p>${T(d.site, 'subtitle')}</p>
      <div class="ebar">${btn('edit-site', '编辑站点信息与阅读进度')}</div></header>
    ${tx(d.site, 'intro') ? `<div class="prose">${md(tx(d.site, 'intro'))}${enTag(d.site, 'intro')}</div>` : ''}
    <div class="mod-grid">${cards}</div>
    ${d.modules.length === 0 ? `<p class="empty">${esc(ui('noModules'))}</p>` : ''}
  </section>`;
}

// ---------- 模块首页 ----------
function moduleHeader(m, extra = '') {
  return `${breadcrumbs([['#/', ui('home')], [null, tx(m, 'title')]])}
    <h1 class="title">${esc(m.icon || '')} ${T(m, 'title')}${enTag(m, 'title')}</h1>
    <div class="ebar">${btn('edit-module', '编辑模块', { m: m.id })}${extra}</div>
    ${tx(m, 'intro') ? `<div class="prose lead">${md(tx(m, 'intro'))}</div>` : ''}`;
}

function viewWikiIndex(m) {
  const list = m.pages.map(p => guard(`${p.id}:`, p.spoiler, `
    <a class="row-link" href="${routeOf(m, p)}"><strong>${T(p, 'title')}${enTag(p, 'title')}</strong>
      <span>${esc(plainText(tx(p, 'summary')).slice(0, 90))}</span>${spoilerTag(p.spoiler)}</a>`)).join('');
  return `${moduleHeader(m, btn('add-page', '＋ 新建页面', { m: m.id }))}
    <div class="row-list">${list || `<p class="empty">${esc(ui('noPages'))}</p>`}</div>`;
}

function viewCatalog(m, gid) {
  const g = m.groups.find(x => x.id === gid) || m.groups[0];
  const tabs = m.groups.map(x => `<a class="tab ${g && x.id === g.id ? 'on' : ''}" href="#/m/${m.id}/g/${x.id}">${T(x, 'title')}
      <small>${m.entries.filter(e => e.group === x.id && !isHidden(e.spoiler)).length}</small></a>`).join('');
  let body = `<p class="empty">${esc(ui('noGroups'))}</p>`;
  if (g) {
    const cards = m.entries.filter(e => e.group === g.id).map(e => guard(`${e.id}:`, e.spoiler, `
      <a class="card" href="${routeOf(m, e)}">
        <div class="card-img">${avatar(e)}</div>
        <div class="card-txt"><strong>${T(e, 'title')}${enTag(e, 'title')}</strong><small>${T(e, 'subtitle')}</small>
        <span>${esc(plainText(tx(e, 'summary')).slice(0, 44))}</span>${spoilerTag(e.spoiler)}</div></a>`)).join('');
    body = `<div class="group-head">
        ${tx(g, 'intro') ? `<div class="prose">${md(tx(g, 'intro'))}</div>` : ''}
        <div class="ebar">${btn('add-entry', '＋ 新建条目', { m: m.id, g: g.id })}${btn('edit-group', '编辑这个子界面', { m: m.id, g: g.id })}${btn('move-group', '←', { m: m.id, g: g.id, d: -1 })}${btn('move-group', '→', { m: m.id, g: g.id, d: 1 })}${btn('del-group', '删除子界面', { m: m.id, g: g.id }, 'danger')}</div>
      </div>
      <div class="card-grid">${cards || `<p class="empty">${esc(ui('noEntries'))}</p>`}</div>`;
  }
  return `${moduleHeader(m)}
    <div class="tabs">${tabs}${btn('add-group', '＋ 子界面', { m: m.id })}</div>${body}`;
}

function eraOf(m, sort) {
  return m.eras.find(e => sort >= (e.from ?? -Infinity) && sort < (e.to ?? Infinity));
}

function viewTimeline(m, tid) {
  const t = m.timelines.find(x => x.id === tid) || m.timelines[0];
  const tabs = m.timelines.length > 1 || state.editMode
    ? `<div class="tabs">${m.timelines.map(x => `<a class="tab ${t && x.id === t.id ? 'on' : ''}" href="#/m/${m.id}/t/${x.id}">${T(x, 'title')}</a>`).join('')}${btn('add-timeline', '＋ 时间线', { m: m.id })}</div>` : '';
  const events = m.entries
    .filter(e => (e.date?.timeline || m.timelines[0]?.id) === t?.id)
    .sort((a, b) => Number(a.date?.sort || 0) - Number(b.date?.sort || 0));
  let html = '', lastEra = 0;
  for (const e of events) {
    const era = eraOf(m, Number(e.date?.sort || 0));
    if (era !== lastEra) {
      html += `<div class="tl-era" style="--era:${esc(era?.color || '#888')}">${esc(era ? tx(era, 'title') : ui('noEra'))}</div>`;
      lastEra = era;
    }
    html += guard(`${e.id}:`, e.spoiler, `
      <a class="tl-item" href="${routeOf(m, e)}" style="--era:${esc(era?.color || '#888')}">
        <span class="tl-dot"></span>
        <span class="tl-date">${esc(tx(e.date, 'label') || e.date?.sort || '')}</span>
        <span class="tl-body"><strong>${T(e, 'title')}${enTag(e, 'title')}</strong><small>${esc(plainText(tx(e, 'summary')).slice(0, 80))}</small>${spoilerTag(e.spoiler)}</span>
      </a>`);
  }
  const ebar = t ? `${btn('add-event', '＋ 新建事件', { m: m.id, t: t.id })}${btn('edit-eras', '编辑纪元', { m: m.id })}${btn('edit-timeline', '编辑这条时间线', { m: m.id, t: t.id })}${m.timelines.length > 1 ? btn('del-timeline', '删除时间线', { m: m.id, t: t.id }, 'danger') : ''}` : '';
  return `${moduleHeader(m)}${tabs}<div class="ebar">${ebar}</div>
    <div class="timeline">${html || `<p class="empty">${esc(ui('noEvents'))}</p>`}</div>`;
}

// ---------- 条目页 ----------
function numberSections(sections) {
  let a = 0, b = 0;
  return sections.map(s => {
    if (s.level === 3) { b++; return `${a || 1}.${b}`; }
    a++; b = 0; return `${a}`;
  });
}

function viewItem(m, item) {
  const ids = { m: m.id, p: item.id };
  const crumbs = [['#/', ui('home')], [`#/m/${m.id}`, tx(m, 'title')]];
  if (m.type === 'catalog') {
    const g = m.groups.find(x => x.id === item.group);
    if (g) crumbs.push([`#/m/${m.id}/g/${g.id}`, tx(g, 'title')]);
  }
  crumbs.push([null, tx(item, 'title')]);

  if (isHidden(item.spoiler) && !state.revealed.has(`${item.id}:`)) {
    return { html: `${breadcrumbs(crumbs)}<h1 class="title">${T(item, 'title')}</h1>${guard(`${item.id}:`, item.spoiler, '')}`, toc: '' };
  }

  const nums = numberSections(item.sections);
  const toc = item.sections.map((s, i) => isHidden(s.spoiler) && !state.revealed.has(`${item.id}:${s.id}`) ? '' :
    `<a class="toc-l${s.level}" data-goto="sec-${esc(s.id)}"><span>${nums[i]}</span>${T(s, 'title')}</a>`).join('');

  let info = '';
  if (m.type !== 'wiki') {
    // 超出阅读进度的字段：连字段名一起隐藏，最后只显示一行“还有 N 项”
    const ibKey = `${item.id}:ib`;
    const showAll = state.revealed.has(ibKey);
    const all = item.infobox || [];
    const hiddenCount = showAll ? 0 : all.filter(r => isHidden(r.spoiler)).length;
    const rows = all.filter(r => showAll || !isHidden(r.spoiler)).map(r =>
      `<tr><th>${T(r, 'k')}</th><td>${renderText(tx(r, 'v'), { resolveLink }).replace(/^<p>|<\/p>$/g, '')}${enTag(r, 'v')}${spoilerTag(r.spoiler)}</td></tr>`).join('')
      + (hiddenCount ? `<tr><td colspan="2" class="ib-hidden" data-reveal="${ibKey}">${esc(ui('hiddenFields', hiddenCount))}</td></tr>` : '');
    const dateRow = m.type === 'timeline'
      ? `<tr><th>${esc(ui('date'))}</th><td>${esc(tx(item.date, 'label'))}${state.editMode ? ` <small class="muted">(排序值 ${esc(item.date?.sort ?? 0)})</small>` : ''}</td></tr>` : '';
    info = `<aside class="infobox">
      <div class="ib-title">${T(item, 'title')}</div>
      ${item.image ? `<div class="ib-img"><img src="${esc(item.image)}" alt=""></div>` : ''}
      ${tx(item, 'subtitle') ? `<div class="ib-sub">${T(item, 'subtitle')}</div>` : ''}
      <table>${dateRow}${rows}</table>
      ${btn('edit-infobox', m.type === 'catalog' ? '✎ 编辑角色设定栏' : '✎ 编辑信息栏', ids, 'wide')}
    </aside>`;
  }

  const sections = item.sections.map((s, i) => {
    // 含剧透的章节：标题也一起隐藏
    if (isHidden(s.spoiler) && !state.revealed.has(`${item.id}:${s.id}`)) {
      return `<section class="sec" id="sec-${esc(s.id)}">${guard(`${item.id}:${s.id}`, s.spoiler, '')}</section>`;
    }
    const tag = s.level === 3 ? 'h3' : 'h2';
    const ctrl = `<span class="ebar inline">${btn('edit-section', '编辑', { ...ids, s: s.id })}${btn('move-section', '↑', { ...ids, s: s.id, d: -1 })}${btn('move-section', '↓', { ...ids, s: s.id, d: 1 })}${btn('add-section', '＋下方插入', { ...ids, s: s.id })}${btn('del-section', '删除', { ...ids, s: s.id }, 'danger')}</span>`;
    return `<section class="sec" id="sec-${esc(s.id)}">
      <${tag}><span class="secnum">${nums[i]}</span>${T(s, 'title')}${spoilerTag(s.spoiler)}${enTag(s, 'body')}${ctrl}</${tag}>
      ${guard(`${item.id}:${s.id}`, s.spoiler, `<div class="prose">${md(tx(s, 'body'))}</div>`)}
    </section>`;
  }).join('');

  const aliases = txList(item, 'aliases');
  const html = `${breadcrumbs(crumbs)}
    <h1 class="title">${T(item, 'title')}${tx(item, 'subtitle') && m.type === 'wiki' ? `<small>${T(item, 'subtitle')}</small>` : ''}${spoilerTag(item.spoiler)}${enTag(item, 'title')}</h1>
    <div class="ebar">${btn('edit-item', '编辑基本信息', ids)}${btn('add-section', '＋ 添加章节', ids)}${btn('del-item', '删除此条目', ids, 'danger')}</div>
    ${aliases.length ? `<div class="aliases">${esc(ui('aka'))}${aliases.map(esc).join(lang === 'en' ? ', ' : '、')}</div>` : ''}
    <div class="article">${info}
      ${tx(item, 'summary') ? `<div class="prose lead">${md(tx(item, 'summary'))}${enTag(item, 'summary')}</div>` : ''}
      ${toc ? `<div class="toc-inline"><div class="toc-h">${esc(ui('toc'))}</div>${toc}</div>` : ''}
      ${sections || (state.editMode ? '<p class="empty">还没有章节，点“添加章节”。</p>' : '')}
    </div>`;
  return { html, toc };
}

// ---------- 搜索 ----------
function viewSearch(q) {
  const res = search(q);
  return `${breadcrumbs([['#/', ui('home')], [null, ui('searchTitle')]])}
    <h1 class="title">${esc(ui('searchTitle'))}: ${esc(q)}</h1>
    <div class="row-list">${res.map(r => `<a class="row-link" href="${r.href}"><strong>${T(r.p, 'title')}</strong>
      <small>${T(r.m, 'title')}${tx(r.p, 'subtitle') ? ' · ' + T(r.p, 'subtitle') : ''}</small><span>${esc(r.snip)}</span></a>`).join('') || `<p class="empty">${esc(ui('noResults'))}</p>`}</div>`;
}

// ---------- 路由 ----------
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
  if (!m) return { html: `<h1 class="title">${esc(ui('moduleMissing'))}</h1><p><a href="#/">${esc(ui('backHome'))}</a></p>`, toc: '' };
  if (route.view === 'item') {
    const item = findItem(m, route.p);
    if (!item) return { html: `<h1 class="title">${esc(ui('itemMissing'))}</h1><p><a href="#/m/${m.id}">${esc(ui('back'))} ${T(m, 'title')}</a></p>`, toc: '' };
    return viewItem(m, item);
  }
  if (m.type === 'wiki') return { html: viewWikiIndex(m), toc: '' };
  if (m.type === 'catalog') return { html: viewCatalog(m, route.g), toc: '' };
  if (m.type === 'timeline') return { html: viewTimeline(m, route.t), toc: '' };
  return { html: '?', toc: '' };
}
