// 入口：载入数据、画出框架、监听路由
import { $, esc, storageGet, storageSet } from './util.js';
import { isConfigured } from './github.js';
import { state, loadData, setProgress } from './store.js';
import { renderNav, renderMain, parseRoute } from './render.js';
import { initEditor, toolbarHtml } from './editor.js';

const AUTHOR_KEY = 'arcadia-wiki-author';

function renderHeader() {
  const s = state.data.site;
  const opts = s.progress.map((p, i) => `<option value="${i}" ${i === state.progress ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  $('#site-title').textContent = s.title;
  document.title = s.title;
  $('#progress').innerHTML = opts;
  const toggle = $('#edit-toggle');
  toggle.textContent = state.editMode ? '退出编辑' : '✎ 编辑';
  // 编辑按钮只给作者看：用 ?edit 打开过一次，或者填过 GitHub 设置
  toggle.hidden = !(state.editMode || storageGet(AUTHOR_KEY) || isConfigured());
  $('#draft-banner').hidden = !(state.usingDraft && !state.editMode);
}

function render() {
  const route = parseRoute();
  renderHeader();
  $('#nav').innerHTML = renderNav(route);
  const { html, toc } = renderMain(route);
  const main = $('#main');
  main.innerHTML = html;
  const side = $('#toc');
  side.innerHTML = toc ? `<div class="toc-h">目录</div>${toc}` : '';
  document.body.classList.toggle('has-toc', !!toc);
  $('#toolbar').innerHTML = toolbarHtml();
  document.body.classList.remove('nav-open');
}

let lastHash = '';
window.addEventListener('hashchange', () => {
  const pageChanged = location.hash.split('?')[0] !== lastHash.split('?')[0];
  lastHash = location.hash;
  render();
  if (pageChanged) window.scrollTo(0, 0);
});

async function boot() {
  await loadData();
  initEditor(render);

  $('#progress').addEventListener('change', e => { setProgress(Number(e.target.value)); render(); });
  $('#search').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) location.hash = `#/search?q=${encodeURIComponent(e.target.value.trim())}`;
  });
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#edit-toggle').dataset.act = 'toggle-edit';

  // 网址带 ?edit 直接进入编辑模式
  if (new URLSearchParams(location.search).has('edit')) {
    storageSet(AUTHOR_KEY, true);
    state.editMode = true;
    document.body.classList.add('editing');
  }
  lastHash = location.hash;
  render();
}

boot();
