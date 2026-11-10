// 入口：读者页（index.html）和编辑器页（editor.html）共用。
// 读者页完全不加载编辑器代码。
import { $, esc, toast } from './util.js';
import { lang, setLang, ui, tx } from './i18n.js';
import { state, loadPublic, loadForEditor, setProgress, reveal, emptyData, normalize, publishedMax, readerProgress } from './store.js';
import { renderNav, renderMain, parseRoute } from './render.js';
import { initBell, renderBell } from './notices.js';

const MODE = document.body.dataset.mode === 'edit' ? 'edit' : 'read';
state.mode = MODE;
let editor = null; // 编辑器模块（只在编辑器页加载）

function renderHeader() {
  const s = state.data.site;
  $('#site-title').textContent = tx(s, 'title');
  document.title = (MODE === 'edit' ? '编辑器 · ' : '') + tx(s, 'title');
  // 读者只能选到“实际发布进度”为止；编辑时可以选全部
  const max = state.editMode ? s.progress.length - 1 : publishedMax();
  const cur = state.editMode ? state.progress : readerProgress();
  $('#progress').innerHTML = s.progress.slice(0, max + 1).map((p, i) =>
    `<option value="${i}" ${i === cur ? 'selected' : ''}>${esc(tx(p, 'label'))}</option>`).join('');
  $('#search').placeholder = ui('search');
  $('#progress-label').textContent = ui('progress');
  $('#progress-wrap').title = ui('progressTip');
  for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === lang);
}

function render() {
  const route = parseRoute();
  renderHeader();
  $('#nav').innerHTML = renderNav(route);
  const { html, toc } = renderMain(route);
  $('#main').innerHTML = html;
  $('#toc').innerHTML = toc ? `<div class="toc-h">${esc(ui('toc'))}</div>${toc}` : '';
  document.body.classList.toggle('has-toc', !!toc);
  if (editor) $('#toolbar').innerHTML = editor.toolbarHtml();
  renderBell();
  document.body.classList.remove('nav-open');
}

// 读者也需要的交互：目录跳转、显示剧透、切换语言
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) { e.preventDefault(); document.getElementById(go.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const rv = e.target.closest('[data-reveal]');
  if (rv) { reveal(rv.dataset.reveal); render(); return; }
  const sp = e.target.closest('.spoiler-inline');
  if (sp) { sp.classList.add('shown'); return; }
  const lb = e.target.closest('[data-lang]');
  if (lb) { setLang(lb.dataset.lang); render(); }
});

// 链接指向某个章节（/s/）或纪元（/e/）时，滚动到那里
function scrollToTarget() {
  const r = parseRoute();
  const el = r.s ? document.getElementById('sec-' + r.s) : r.e ? document.getElementById('era-' + r.e) : null;
  if (el) { el.scrollIntoView({ block: 'start' }); return true; }
  return false;
}

let lastHash = '';
window.addEventListener('hashchange', () => {
  const pageChanged = location.hash.split('?')[0] !== lastHash.split('?')[0];
  lastHash = location.hash;
  render();
  if (!scrollToTarget() && pageChanged) window.scrollTo(0, 0);
});

async function bootEditor() {
  editor = await import('./editor.js');
  const gh = await import('./github.js');
  $('#main').innerHTML = '<p class="loading">正在从 GitHub 读取最新内容…</p>';
  let err = '';
  for (;;) {
    if (!gh.isConfigured() || err) await editor.showLogin(err);
    try {
      let remote = await gh.loadRemote();
      if (!remote) {
        // 仓库里还没有数据文件：退回读取网站上的版本，或者从空白开始
        try { remote = await (await fetch('data/wiki.json?t=' + Date.now(), { cache: 'no-store' })).json(); }
        catch { remote = emptyData(); }
        toast('仓库里还没有数据文件，发布时会自动创建');
      }
      loadForEditor(normalize(remote));
      break;
    } catch (e) {
      err = '读取失败：' + e.message;
    }
  }
  state.editMode = true;
  document.body.classList.add('editing');
  editor.initEditor(render);
}

async function boot() {
  setLang(lang);
  $('#progress').addEventListener('change', e => { setProgress(Number(e.target.value)); render(); });
  $('#search').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) location.hash = `#/search?q=${encodeURIComponent(e.target.value.trim())}`;
  });
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));

  if (MODE === 'edit') await bootEditor();
  else await loadPublic();
  initBell();

  lastHash = location.hash;
  render();
  scrollToTarget();
  window.__wikiBooted = true;
}

window.__wikiBooted = true; // 模块已加载
boot();
