// 通知：右上角小铃铛 + 未读数 + 通知面板
// 未读记录保存在读者自己的浏览器里；点开铃铛 = 全部已读
import { $, esc, h, storageGet, storageSet } from './util.js';
import { ui, tx, lang } from './i18n.js';
import { renderText } from './markdown.js';
import { state, resolveLink } from './store.js';

const SEEN_KEY = 'arcadia-wiki-seen-notices';
let open = false;

const seen = () => new Set(storageGet(SEEN_KEY, []));
const sorted = () => [...(state.data.notices || [])].sort((a, b) => (b.time || 0) - (a.time || 0));

export function initBell() {
  if ($('#bell')) return;
  const bell = h(`<button id="bell" class="bell" aria-label="Notifications"><span class="bell-ico">🔔</span><span id="bell-count" class="bell-count" hidden></span></button>`);
  const tools = $('.top-tools');
  tools.insertBefore(bell, tools.querySelector('.lang-switch'));
  document.body.appendChild(h('<div id="notice-panel" class="notice-panel" hidden></div>'));
  bell.addEventListener('click', (e) => { e.stopPropagation(); open ? close() : show(); });
  document.addEventListener('click', (e) => {
    if (open && !e.target.closest('#notice-panel') && !e.target.closest('.modal-back')) close();
  });
}

export function renderBell() {
  const btn = $('#bell');
  if (!btn) return;
  btn.title = ui('notices');
  const s = seen();
  const unread = sorted().filter(n => !s.has(n.id)).length;
  const badge = $('#bell-count');
  badge.hidden = unread === 0;
  badge.textContent = unread > 99 ? '99+' : String(unread);
  if (open) fillPanel();
}

function fillPanel() {
  const list = sorted();
  const edit = state.editMode;
  const btn = (act, label, id = '', cls = '') => edit ? `<button class="ebtn ${cls}" data-act="${act}" data-n="${esc(id)}">${label}</button>` : '';
  $('#notice-panel').innerHTML = `
    <div class="np-h">${esc(ui('notices'))}${btn('add-notice', '＋ 新建通知')}</div>
    <div class="np-list">${list.map(n => `
      <div class="np-item">
        <div class="np-title">${esc(tx(n, 'title'))}</div>
        <div class="np-time">${n.time ? new Date(n.time).toLocaleDateString(lang === 'en' ? 'en-GB' : 'zh-CN') : ''}</div>
        ${tx(n, 'body') ? `<div class="np-body prose">${renderText(tx(n, 'body'), { resolveLink, plainMissing: !edit })}</div>` : ''}
        ${edit ? `<div class="ebar">${btn('edit-notice', '编辑', n.id)}${btn('del-notice', '删除', n.id, 'danger')}</div>` : ''}
      </div>`).join('') || `<p class="empty">${esc(ui('noNotices'))}</p>`}</div>`;
}

function show() {
  open = true;
  $('#notice-panel').hidden = false;
  fillPanel();
  // 点开即全部已读
  storageSet(SEEN_KEY, sorted().map(n => n.id));
  renderBell();
}

function close() {
  open = false;
  $('#notice-panel').hidden = true;
}
