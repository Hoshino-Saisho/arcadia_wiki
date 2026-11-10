// 编辑器（只在 editor.html 加载）：登录、弹窗表单、所有编辑动作、发布。
import { $, $$, esc, uid, h, move, toast } from './util.js';
import { renderText, FORMAT_HELP } from './markdown.js';
import {
  state, MODULE_TYPES, findModule, findItem, itemsOf, routeOf,
  touch, discardDraft, markPublished, normalize, resolveLink,
} from './store.js';
import { getConfig, setConfig, logout, guessRepo, verify, publish } from './github.js';

let rerender = () => {};
export function initEditor(onChange) {
  rerender = onChange;
  document.addEventListener('click', onClick);
  window.addEventListener('beforeunload', e => { if (state.usingDraft) { e.preventDefault(); e.returnValue = ''; } });
}

// ================= 登录 =================
export function showLogin(errorMsg = '') {
  const c = getConfig();
  const g = guessRepo();
  return new Promise(resolve => {
    const box = h(`<div class="login-back"><form class="login">
      <h2>ARCADIA 百科 · 编辑器</h2>
      <p class="muted">只有拥有仓库写入权限的人才能进入。令牌只保存在这台设备的浏览器里。</p>
      ${errorMsg ? `<div class="login-err">${esc(errorMsg)}</div>` : ''}
      <label class="f">GitHub 用户名<input name="owner" type="text" value="${esc(c.owner || g.owner)}" required></label>
      <label class="f">仓库名<input name="repo" type="text" value="${esc(c.repo || g.repo)}" required></label>
      <label class="f">访问令牌（Fine-grained token）<input name="token" type="password" value="${esc(c.token)}" required autocomplete="off"></label>
      <details class="f-help"><summary>高级：分支 / 数据文件路径</summary>
        <label class="f">分支<input name="branch" type="text" value="${esc(c.branch || 'main')}"></label>
        <label class="f">数据文件路径<input name="path" type="text" value="${esc(c.path || 'data/wiki.json')}"></label>
      </details>
      <button class="btn primary" type="submit">登录</button>
      <p class="f-help">还没有令牌？看仓库里 README 的“第三步”。</p>
    </form></div>`);
    document.body.appendChild(box);
    const form = $('form', box);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const cfg = { owner: fd.owner.trim(), repo: fd.repo.trim(), token: fd.token.trim(), branch: (fd.branch || 'main').trim(), path: (fd.path || 'data/wiki.json').trim() };
      const b = $('button[type=submit]', form);
      b.disabled = true; b.textContent = '验证中…';
      try {
        await verify(cfg);
        setConfig(cfg);
        box.remove();
        resolve(cfg);
      } catch (err) {
        b.disabled = false; b.textContent = '登录';
        let el = $('.login-err', form);
        if (!el) { el = h('<div class="login-err"></div>'); form.insertBefore(el, form.children[2]); }
        el.textContent = '登录失败：' + err.message;
      }
    };
    setTimeout(() => $('input[name=token]', box)?.focus(), 30);
  });
}

// ================= 通用弹窗表单 =================
// 字段：{key,label,type,value,options,help,bi,preview,size,columns,newRow,numeric}
// bi:true 表示中英双语：同时编辑 key 和 key_en
function spoilerOptions() {
  return state.data.site.progress.map((p, i) => [i, i === 0 ? `${p.label}（所有人可见）` : `读到「${p.label}」才显示`]);
}

function inputHtml(id, type, v, ph = '') {
  if (type === 'textarea') return `<textarea id="${id}" rows="${ph || 6}">${esc(v)}</textarea>`;
  return `<input id="${id}" type="text" value="${esc(v)}" ${ph ? `placeholder="${esc(ph)}"` : ''}>`;
}

function fieldHtml(f) {
  const id = 'f_' + f.key;
  const help = f.help ? `<div class="f-help">${f.help}</div>` : '';
  const v = f.value ?? '';
  if (f.bi) {
    const ta = f.type === 'textarea';
    const col = (suffix, label, val) => `<div class="bi-col"><div class="bi-lab">${label}</div>
      ${ta ? `<textarea id="${id}${suffix}" rows="${f.size || 6}">${esc(val)}</textarea>` : `<input id="${id}${suffix}" type="text" value="${esc(val)}">`}
      ${ta && f.preview ? `<div class="f-preview prose" data-for="${id}${suffix}"></div>` : ''}</div>`;
    return `<div class="f">${esc(f.label)}${help}<div class="bi">${col('', '中文', v)}${col('_en', 'English', f.value_en ?? '')}</div>
      ${ta && f.preview ? fmtHelp() : ''}</div>`;
  }
  switch (f.type) {
    case 'textarea':
      return `<label class="f">${esc(f.label)}${inputHtml(id, 'textarea', v, f.size)}${help}
        ${f.preview ? `<div class="f-preview prose" data-for="${id}"></div>${fmtHelp()}` : ''}</label>`;
    case 'select':
      return `<label class="f">${esc(f.label)}<select id="${id}">${f.options.map(([val, lab]) =>
        `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>${help}</label>`;
    case 'number':
      return `<label class="f">${esc(f.label)}<input id="${id}" type="number" step="any" value="${esc(v)}">${help}</label>`;
    case 'rows':
      return `<div class="f">${esc(f.label)}${help}<div class="rows" id="${id}"></div>
        <button type="button" class="ebtn" data-rows-add="${id}">＋ 添加一行</button></div>`;
    case 'info':
      return `<div class="f-info">${f.html}</div>`;
    default:
      return `<label class="f">${esc(f.label)}${inputHtml(id, 'text', v, f.placeholder)}${help}</label>`;
  }
}

function fmtHelp() {
  return `<details class="fmt-help"><summary>格式说明</summary><table>${FORMAT_HELP.map(([a, b]) =>
    `<tr><td><code>${esc(a)}</code></td><td>${esc(b)}</td></tr>`).join('')}</table></details>`;
}

function rowHtml(cols, row) {
  return `<div class="row">${cols.map(c => {
    const v = row[c.key] ?? '';
    if (c.type === 'select') return `<select data-col="${c.key}" title="${esc(c.label)}">${c.options.map(([val, lab]) =>
      `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    if (c.type === 'color') return `<input data-col="${c.key}" type="color" value="${esc(v || '#888888')}" title="${esc(c.label)}">`;
    const inp = (key, ph, val) => `<input data-col="${key}" type="${c.type === 'number' ? 'number' : 'text'}" step="any" placeholder="${esc(ph)}" value="${esc(val)}">`;
    if (c.bi) return `<div class="row-bi" style="flex:${c.flex || 1}">${inp(c.key, c.label, v)}${inp(c.key + '_en', c.label_en || 'English', row[c.key + '_en'] ?? '')}</div>`;
    return `<div class="row-one" style="flex:${c.flex || 1}">${inp(c.key, c.label, v)}</div>`;
  }).join('')}<span class="row-btns"><button type="button" class="ebtn" data-row="up">↑</button><button type="button" class="ebtn" data-row="down">↓</button><button type="button" class="ebtn danger" data-row="del">✕</button></span></div>`;
}

export function openForm({ title, fields, submitLabel = '保存', wide = false, extraButtons = '' }) {
  return new Promise(resolve => {
    const dlg = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-h">${esc(title)}<button class="x" data-close>✕</button></div>
      <div class="modal-b">${fields.map(fieldHtml).join('')}</div>
      <div class="modal-f">${extraButtons}<span class="grow"></span><button class="btn" data-close>取消</button><button class="btn primary" data-ok>${esc(submitLabel)}</button></div>
    </div></div>`);
    document.body.appendChild(dlg);

    for (const f of fields.filter(f => f.type === 'rows')) {
      const box = $('#f_' + f.key, dlg);
      (f.value || []).forEach(r => box.appendChild(h(rowHtml(f.columns, r))));
      $(`[data-rows-add="f_${f.key}"]`, dlg).onclick = () => {
        box.appendChild(h(rowHtml(f.columns, f.newRow ? f.newRow() : {})));
        box.lastElementChild.querySelector('input')?.focus();
      };
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-row]');
        if (!b) return;
        const row = b.closest('.row');
        if (b.dataset.row === 'del') row.remove();
        if (b.dataset.row === 'up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
        if (b.dataset.row === 'down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      });
    }
    for (const pv of $$('.f-preview', dlg)) {
      const ta = $('#' + pv.dataset.for, dlg);
      const upd = () => { pv.innerHTML = renderText(ta.value, { resolveLink }) || '<span class="muted">（预览）</span>'; };
      ta.addEventListener('input', upd); upd();
    }

    const close = (val) => { dlg.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const collect = () => {
      const out = {};
      for (const f of fields) {
        if (f.type === 'info') continue;
        const el = $('#f_' + f.key, dlg);
        if (f.bi) { out[f.key] = el.value; out[f.key + '_en'] = $('#f_' + f.key + '_en', dlg).value; continue; }
        if (f.type === 'rows') {
          out[f.key] = $$('.row', el).map(r => {
            const o = {};
            for (const inp of $$('[data-col]', r)) {
              const c = f.columns.find(x => x.key === inp.dataset.col || x.key + '_en' === inp.dataset.col);
              const isNum = c?.type === 'number' && inp.dataset.col === c.key;
              o[inp.dataset.col] = isNum ? (inp.value === '' ? '' : Number(inp.value)) : (c?.numeric ? Number(inp.value) : inp.value);
            }
            return o;
          });
        } else if (f.type === 'number') out[f.key] = el.value === '' ? 0 : Number(el.value);
        else if (f.numeric) out[f.key] = Number(el.value);
        else out[f.key] = el.value;
      }
      return out;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(collect());
    };
    document.addEventListener('keydown', onKey);
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) close(null);
      else if (e.target.closest('[data-ok]')) close(collect());
    });
    setTimeout(() => $('input,textarea', dlg)?.focus(), 30);
  });
}

function confirmBox(msg) {
  return openForm({ title: '确认', fields: [{ type: 'info', html: esc(msg) }], submitLabel: '确定' }).then(v => !!v);
}

const splitList = (s) => String(s || '').split(/[,，、\n]/).map(x => x.trim()).filter(Boolean);
// 设定栏模板：每行“中文 | English”
const parseTemplate = (s) => String(s || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
  const [k, en] = l.split(/\s*[|｜]\s*/);
  return { k, k_en: en || '' };
});
const templateText = (fields) => (fields || []).map(f => typeof f === 'string' ? f : (f.k_en ? `${f.k} | ${f.k_en}` : f.k)).join('\n');
const templateRows = (fields) => (fields || []).map(f => typeof f === 'string' ? { k: f, k_en: '', v: '', v_en: '', spoiler: 0 } : { k: f.k, k_en: f.k_en || '', v: '', v_en: '', spoiler: 0 });

// 双语字段的简写：bi('title','标题', obj)
const bi = (key, label, obj, extra = {}) => ({ key, label, bi: true, value: obj?.[key] ?? '', value_en: obj?.[key + '_en'] ?? '', ...extra });

// ================= 编辑动作 =================
const actions = {
  async 'edit-site'() {
    const s = state.data.site;
    const v = await openForm({
      title: '站点信息与阅读进度', wide: true, fields: [
        bi('title', '站点名称', s),
        bi('subtitle', '副标题', s),
        bi('intro', '首页介绍', s, { type: 'textarea', preview: true, size: 4 }),
        { key: 'progress', label: '阅读进度（防剧透等级，从上到下依次递进）', type: 'rows', value: s.progress,
          help: '第一行是“所有人可见”。每段内容都可以标上需要读到哪一级才显示。读者在顶部选择自己的进度。',
          columns: [{ key: 'label', label: '中文，例如：读完第一篇', label_en: 'English, e.g. Finished Part One', bi: true }] },
        { key: 'defaultProgress', label: '新读者默认进度', type: 'select', numeric: true, value: s.defaultProgress ?? 0,
          options: s.progress.map((p, i) => [i, p.label]) },
      ],
    });
    if (!v) return;
    if (!v.progress.length) v.progress = [{ label: '全部', label_en: 'All' }];
    Object.assign(s, v);
    s.defaultProgress = Math.min(v.defaultProgress, v.progress.length - 1);
    touch(); rerender();
  },

  async 'add-module'() {
    const v = await openForm({
      title: '新建模块', fields: [
        bi('title', '模块名称（例如：势力 / Factions）', {}),
        { key: 'icon', label: '图标（一个 emoji 或字）', value: '📁' },
        { key: 'type', label: '模块类型', type: 'select', value: 'wiki',
          options: Object.entries(MODULE_TYPES).map(([k, t]) => [k, `${t.label} —— ${t.desc}`]) },
      ],
    });
    if (!v || !v.title.trim()) return;
    const m = normalize({ modules: [{ id: uid('m'), title: v.title.trim(), title_en: v.title_en.trim(), icon: v.icon, type: v.type }] }).modules[0];
    if (m.type === 'catalog') m.groups.push({ id: uid('g'), title: '默认分类', title_en: 'General', intro: '', fields: [] });
    state.data.modules.push(m);
    touch(); location.hash = `#/m/${m.id}`; rerender();
  },

  async 'edit-module'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({
      title: '编辑模块', wide: true, fields: [
        bi('title', '名称', m),
        { key: 'icon', label: '图标', value: m.icon },
        bi('intro', '模块介绍', m, { type: 'textarea', preview: true, size: 4 }),
        { key: 'id', label: '网址标识（英文/数字，改了会让旧链接失效）', value: m.id },
      ],
    });
    if (!v) return;
    const newId = v.id.trim().replace(/[^\w-]/g, '') || m.id;
    if (newId !== m.id && findModule(newId)) { toast('这个网址标识已被占用'); return; }
    Object.assign(m, { ...v, id: newId });
    touch(); if (newId !== ds.m) location.hash = `#/m/${newId}`; rerender();
  },

  async 'del-module'(ds) {
    const m = findModule(ds.m);
    if (!(await confirmBox(`删除模块「${m.title}」以及里面的全部 ${itemsOf(m).length} 个条目？`))) return;
    state.data.modules = state.data.modules.filter(x => x !== m);
    touch(); location.hash = '#/'; rerender();
  },

  'move-module'(ds) {
    const arr = state.data.modules;
    move(arr, arr.findIndex(x => x.id === ds.m), Number(ds.d));
    touch(); rerender();
  },

  async 'add-page'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({ title: '新建页面', fields: [bi('title', '页面标题', {})] });
    if (!v || !v.title.trim()) return;
    const p = { id: uid('p'), title: v.title.trim(), title_en: v.title_en.trim(), summary: '', spoiler: 0, sections: [] };
    m.pages.push(p);
    touch(); location.hash = routeOf(m, p); rerender();
  },

  async 'add-group'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({
      title: '新建子界面', wide: true, fields: [
        bi('title', '名称（例如：人类 / Humans）', {}),
        { key: 'fields', label: '设定栏模板（每行一个字段，写成“中文 | English”）', type: 'textarea', size: 5, value: '',
          help: '例如：<code>阶级 | Tier</code>。新建条目时会自动带上这些字段。' },
      ],
    });
    if (!v || !v.title.trim()) return;
    const g = { id: uid('g'), title: v.title.trim(), title_en: v.title_en.trim(), intro: '', fields: parseTemplate(v.fields) };
    m.groups.push(g);
    touch(); location.hash = `#/m/${m.id}/g/${g.id}`; rerender();
  },

  async 'edit-group'(ds) {
    const m = findModule(ds.m);
    const g = m.groups.find(x => x.id === ds.g);
    const v = await openForm({
      title: '编辑子界面', wide: true, fields: [
        bi('title', '名称', g),
        bi('intro', '介绍', g, { type: 'textarea', preview: true, size: 3 }),
        { key: 'fields', label: '设定栏模板（每行一个字段，写成“中文 | English”）', type: 'textarea', size: 6, value: templateText(g.fields),
          help: '只影响之后新建的条目。' },
      ],
    });
    if (!v) return;
    Object.assign(g, { title: v.title, title_en: v.title_en, intro: v.intro, intro_en: v.intro_en, fields: parseTemplate(v.fields) });
    touch(); rerender();
  },

  async 'del-group'(ds) {
    const m = findModule(ds.m);
    const g = m.groups.find(x => x.id === ds.g);
    const n = m.entries.filter(e => e.group === g.id).length;
    if (!(await confirmBox(`删除子界面「${g.title}」以及里面的 ${n} 个条目？`))) return;
    m.groups = m.groups.filter(x => x !== g);
    m.entries = m.entries.filter(e => e.group !== g.id);
    touch(); location.hash = `#/m/${m.id}`; rerender();
  },

  'move-group'(ds) {
    const m = findModule(ds.m);
    move(m.groups, m.groups.findIndex(x => x.id === ds.g), Number(ds.d));
    touch(); rerender();
  },

  async 'add-entry'(ds) {
    const m = findModule(ds.m);
    const g = m.groups.find(x => x.id === ds.g);
    const v = await openForm({
      title: `在「${g.title}」新建条目`, fields: [bi('title', '名称', {}), bi('subtitle', '副标题', {})],
    });
    if (!v || !v.title.trim()) return;
    const e = {
      id: uid('c'), group: g.id, title: v.title.trim(), title_en: v.title_en.trim(), subtitle: v.subtitle, subtitle_en: v.subtitle_en,
      summary: '', image: '', spoiler: 0, infobox: templateRows(g.fields), sections: [],
    };
    m.entries.push(e);
    touch(); location.hash = routeOf(m, e); rerender();
  },

  async 'add-timeline'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({ title: '新建时间线', fields: [bi('title', '名称（例如：人神游戏 / The Human-God Game）', {})] });
    if (!v || !v.title.trim()) return;
    const t = { id: uid('t'), title: v.title.trim(), title_en: v.title_en.trim() };
    m.timelines.push(t);
    touch(); location.hash = `#/m/${m.id}/t/${t.id}`; rerender();
  },

  async 'edit-timeline'(ds) {
    const m = findModule(ds.m);
    const t = m.timelines.find(x => x.id === ds.t);
    const v = await openForm({ title: '编辑时间线', fields: [bi('title', '名称', t)] });
    if (!v) return;
    Object.assign(t, v); touch(); rerender();
  },

  async 'del-timeline'(ds) {
    const m = findModule(ds.m);
    const t = m.timelines.find(x => x.id === ds.t);
    const n = m.entries.filter(e => e.date?.timeline === t.id).length;
    if (!(await confirmBox(`删除时间线「${t.title}」？里面的 ${n} 个事件会移到第一条时间线。`))) return;
    m.timelines = m.timelines.filter(x => x !== t);
    for (const e of m.entries) if (e.date?.timeline === t.id) e.date.timeline = m.timelines[0].id;
    touch(); location.hash = `#/m/${m.id}`; rerender();
  },

  async 'edit-eras'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({
      title: '编辑纪元', wide: true, fields: [
        { key: 'eras', label: '纪元', type: 'rows', value: m.eras,
          help: '事件按“排序值”落进纪元：起点 ≤ 排序值 < 终点，留空表示无限。建议用“距今多少年”：九百年前填 -900，现在填 0。',
          newRow: () => ({ color: '#8a7f6a' }),
          columns: [{ key: 'title', label: '名称', label_en: 'Name', bi: true, flex: 2 }, { key: 'from', label: '起点', type: 'number' }, { key: 'to', label: '终点', type: 'number' }, { key: 'color', label: '颜色', type: 'color' }] },
      ],
    });
    if (!v) return;
    m.eras = v.eras.map(e => ({ id: uid('e'), ...e, from: e.from === '' ? null : e.from, to: e.to === '' ? null : e.to }));
    touch(); rerender();
  },

  async 'add-event'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({
      title: '新建事件', wide: true, fields: [
        bi('title', '事件名称', {}),
        bi('label', '时间（显示文字，例如：近九百年前 / Nearly 900 years ago）', {}),
        { key: 'sort', label: '排序值（数字，越小越早）', type: 'number', value: 0, help: '决定事件在时间线上的位置。例如九百年前填 -900，现在填 0。' },
      ],
    });
    if (!v || !v.title.trim()) return;
    const e = {
      id: uid('e'), title: v.title.trim(), title_en: v.title_en.trim(), summary: '', spoiler: 0, infobox: [], sections: [],
      date: { label: v.label, label_en: v.label_en, sort: v.sort, timeline: ds.t },
    };
    m.entries.push(e);
    touch(); location.hash = routeOf(m, e); rerender();
  },

  async 'edit-item'(ds) {
    const m = findModule(ds.m);
    const p = findItem(m, ds.p);
    const fields = [
      bi('title', '标题', p),
      bi('subtitle', m.type === 'catalog' ? '副标题（例如称号）' : '副标题', p),
      { key: 'aliases', label: '中文别名（顿号或逗号分隔；站内链接也认这些名字）', value: (p.aliases || []).join('、') },
      { key: 'aliases_en', label: 'English aliases (comma separated)', value: (p.aliases_en || []).join(', ') },
      bi('summary', '导语（页面开头的一段概述）', p, { type: 'textarea', preview: true, size: 4 }),
      { key: 'spoiler', label: '整个条目的剧透等级', type: 'select', numeric: true, value: p.spoiler || 0, options: spoilerOptions() },
      { key: 'id', label: '网址标识（英文/数字）', value: p.id },
    ];
    if (m.type !== 'wiki') fields.splice(4, 0, { key: 'image', label: '图片地址（可留空）', value: p.image || '', help: '图片网址，或者把图片放进仓库 images 文件夹后填 images/文件名.png' });
    if (m.type === 'catalog') fields.push({ key: 'group', label: '所属子界面', type: 'select', value: p.group, options: m.groups.map(g => [g.id, g.title]) });
    if (m.type === 'timeline') {
      fields.push(
        { key: 'dlabel', label: '时间（中文显示）', value: p.date?.label || '' },
        { key: 'dlabel_en', label: 'Date (English label)', value: p.date?.label_en || '' },
        { key: 'dsort', label: '排序值（数字，越小越早）', type: 'number', value: p.date?.sort ?? 0 },
        { key: 'dtl', label: '所属时间线', type: 'select', value: p.date?.timeline || m.timelines[0]?.id, options: m.timelines.map(t => [t.id, t.title]) },
      );
    }
    const v = await openForm({ title: '编辑基本信息', fields, wide: true });
    if (!v) return;
    const newId = v.id.trim().replace(/[^\w-]/g, '') || p.id;
    if (newId !== p.id && findItem(m, newId)) { toast('这个网址标识已被占用'); return; }
    Object.assign(p, {
      title: v.title.trim() || p.title, title_en: v.title_en.trim(), subtitle: v.subtitle, subtitle_en: v.subtitle_en,
      summary: v.summary, summary_en: v.summary_en, spoiler: v.spoiler,
      aliases: splitList(v.aliases), aliases_en: splitList(v.aliases_en), id: newId,
    });
    if ('image' in v) p.image = v.image.trim();
    if ('group' in v) p.group = v.group;
    if (m.type === 'timeline') p.date = { label: v.dlabel, label_en: v.dlabel_en, sort: v.dsort, timeline: v.dtl };
    touch(); location.hash = routeOf(m, p); rerender();
  },

  async 'del-item'(ds) {
    const m = findModule(ds.m);
    const p = findItem(m, ds.p);
    if (!(await confirmBox(`删除「${p.title}」？`))) return;
    if (m.type === 'wiki') m.pages = m.pages.filter(x => x !== p); else m.entries = m.entries.filter(x => x !== p);
    touch(); location.hash = p.group ? `#/m/${m.id}/g/${p.group}` : `#/m/${m.id}`; rerender();
  },

  async 'edit-infobox'(ds) {
    const m = findModule(ds.m);
    const p = findItem(m, ds.p);
    const v = await openForm({
      title: m.type === 'catalog' ? '角色设定栏' : '信息栏', wide: true, fields: [
        { key: 'rows', label: '字段（每格上面中文、下面英文）', type: 'rows', value: p.infobox,
          help: '内容支持 [[链接]] 和 **粗体**。右边选剧透等级。',
          newRow: () => ({ spoiler: 0 }),
          columns: [
            { key: 'k', label: '字段名', label_en: 'Field', bi: true },
            { key: 'v', label: '内容', label_en: 'Value', bi: true, flex: 3 },
            { key: 'spoiler', label: '剧透', type: 'select', numeric: true, options: spoilerOptions() },
          ] },
      ],
    });
    if (!v) return;
    p.infobox = v.rows.filter(r => r.k || r.v || r.k_en || r.v_en);
    touch(); rerender();
  },

  async 'add-section'(ds) {
    const p = findItem(findModule(ds.m), ds.p);
    const v = await sectionForm({ title: '', body: '', level: 2, spoiler: 0 }, '添加章节');
    if (!v) return;
    const i = ds.s ? p.sections.findIndex(x => x.id === ds.s) + 1 : p.sections.length;
    p.sections.splice(i, 0, { id: uid('s'), ...v });
    touch(); rerender();
  },

  async 'edit-section'(ds) {
    const p = findItem(findModule(ds.m), ds.p);
    const s = p.sections.find(x => x.id === ds.s);
    const v = await sectionForm(s, '编辑章节');
    if (!v) return;
    Object.assign(s, v);
    touch(); rerender();
  },

  async 'del-section'(ds) {
    const p = findItem(findModule(ds.m), ds.p);
    const s = p.sections.find(x => x.id === ds.s);
    if (!(await confirmBox(`删除章节「${s.title || '（无标题）'}」？`))) return;
    p.sections = p.sections.filter(x => x !== s);
    touch(); rerender();
  },

  'move-section'(ds) {
    const p = findItem(findModule(ds.m), ds.p);
    move(p.sections, p.sections.findIndex(x => x.id === ds.s), Number(ds.d));
    touch(); rerender();
  },

  async 'create-missing'(ds) {
    const choices = [];
    for (const m of state.data.modules) {
      if (m.type === 'catalog') m.groups.forEach(g => choices.push([`${m.id}|${g.id}`, `${m.title} › ${g.title}`]));
      else if (m.type === 'timeline') choices.push([`${m.id}|${m.timelines[0]?.id}`, m.title]);
      else choices.push([`${m.id}|`, m.title]);
    }
    if (!choices.length) { toast('请先新建一个模块'); return; }
    const v = await openForm({
      title: `创建页面「${ds.missing}」`, submitLabel: '创建',
      fields: [{ key: 'where', label: '放在哪里', type: 'select', value: choices[0][0], options: choices }],
    });
    if (!v) return;
    const [mid, sub] = v.where.split('|');
    const m = findModule(mid);
    const isEn = /^[\x00-\x7F]+$/.test(ds.missing);
    const base = { title: ds.missing, title_en: isEn ? ds.missing : '', summary: '', spoiler: 0, sections: [] };
    let item;
    if (m.type === 'wiki') { item = { id: uid('p'), ...base }; m.pages.push(item); }
    else if (m.type === 'catalog') {
      const g = m.groups.find(x => x.id === sub);
      item = { id: uid('c'), group: sub, subtitle: '', image: '', infobox: templateRows(g?.fields), ...base };
      m.entries.push(item);
    } else { item = { id: uid('e'), infobox: [], date: { label: '', sort: 0, timeline: sub }, ...base }; m.entries.push(item); }
    touch(); location.hash = routeOf(m, item); rerender();
  },

  // ---- 工具栏 ----
  async publish() {
    const v = await openForm({
      title: '发布到网站', submitLabel: '发布', fields: [
        { key: 'msg', label: '这次改了什么（会记在 GitHub 的提交记录里）', value: '更新百科' },
        { type: 'info', html: '发布后 GitHub 需要 1～2 分钟重新部署。读者那边可能还要再等几分钟（浏览器缓存）。' },
      ],
    });
    if (!v) return;
    const bar = $('#ed-status');
    try {
      if (bar) bar.textContent = '发布中…';
      state.data.updatedAt = Date.now();
      await publish(state.data, v.msg);
      markPublished();
      toast('发布成功！');
    } catch (e) {
      toast('发布失败：' + e.message, 6000);
    }
    rerender();
  },

  export() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wiki-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  import() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        if (!data.modules) throw new Error('不是百科数据文件');
        if (!(await confirmBox('用这个文件替换当前全部内容？（会变成本机草稿，发布后才会上线）'))) return;
        state.data = normalize(data);
        touch(); rerender(); toast('已导入');
      } catch (e) { toast('导入失败：' + e.message, 5000); }
    };
    inp.click();
  },

  async discard() {
    if (!(await confirmBox('丢弃所有未发布的修改，恢复成仓库里的最新版本？'))) return;
    discardDraft(); rerender(); toast('已恢复');
  },

  'toggle-preview'() {
    state.editMode = !state.editMode;
    document.body.classList.toggle('editing', state.editMode);
    rerender();
  },

  async logout() {
    const msg = state.usingDraft ? '还有未发布的修改（会留在这台设备上）。确定退出登录？' : '退出登录？这台设备上保存的令牌会被删除。';
    if (!(await confirmBox(msg))) return;
    logout();
    location.reload();
  },
};

function sectionForm(s, title) {
  return openForm({
    title, wide: true, fields: [
      bi('title', '章节标题', s),
      { key: 'level', label: '层级', type: 'select', numeric: true, value: s.level || 2, options: [[2, '一级标题（进目录）'], [3, '二级标题（目录里缩进）']] },
      { key: 'spoiler', label: '剧透等级', type: 'select', numeric: true, value: s.spoiler || 0, options: spoilerOptions() },
      bi('body', '正文（Ctrl+Enter 保存）', s, { type: 'textarea', preview: true, size: 12 }),
    ],
  });
}

async function onClick(e) {
  const miss = e.target.closest('.wikilink.missing');
  if (miss && state.editMode) { actions['create-missing']({ missing: miss.dataset.missing }); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const fn = actions[b.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { await fn({ ...b.dataset }); }
  catch (err) { console.error(err); toast('出错了：' + err.message, 5000); }
}

export function toolbarHtml() {
  const c = getConfig();
  const status = state.usingDraft ? '● 有未发布的修改（已自动保存在本机）' : '✓ 与仓库一致';
  return `<div class="ed-bar">
    <span class="ed-who">${esc(c.owner)}/${esc(c.repo)}</span>
    <span id="ed-status" class="${state.usingDraft ? 'dirty' : ''}">${status}</span>
    <span class="grow"></span>
    <button class="btn primary" data-act="publish" ${state.usingDraft ? '' : 'disabled'}>发布到网站</button>
    <button class="btn" data-act="toggle-preview">${state.editMode ? '👁 读者视角预览' : '✎ 回到编辑'}</button>
    <button class="btn" data-act="export">导出备份</button>
    <button class="btn" data-act="import">导入</button>
    <button class="btn" data-act="discard" ${state.usingDraft ? '' : 'disabled'}>放弃修改</button>
    <a class="btn" href="index.html${location.hash}" target="_blank">打开网站</a>
    <button class="btn" data-act="logout">退出登录</button>
  </div>`;
}
