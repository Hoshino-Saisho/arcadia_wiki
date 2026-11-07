// 编辑器：编辑模式下的所有按钮行为、弹窗表单、发布/导入/导出。
import { $, $$, esc, uid, h, move, toast } from './util.js';
import { renderText, FORMAT_HELP } from './markdown.js';
import {
  state, MODULE_TYPES, findModule, findItem, itemsOf, routeOf,
  touch, discardDraft, markPublished, normalize, rebuildIndex, resolveLink, reveal,
} from './store.js';
import { getConfig, setConfig, testConnection, publish } from './github.js';

let rerender = () => {};
export function initEditor(onChange) {
  rerender = onChange;
  document.addEventListener('click', onClick);
}

// ================= 通用弹窗表单 =================
// fields: [{key,label,type,value,options,help,rows(columns),preview}]
function spoilerOptions() {
  return state.data.site.progress.map((p, i) => [i, i === 0 ? `${p.label}（所有人可见）` : `读到「${p.label}」才显示`]);
}

function fieldHtml(f) {
  const id = 'f_' + f.key;
  const help = f.help ? `<div class="f-help">${f.help}</div>` : '';
  const v = f.value ?? '';
  switch (f.type) {
    case 'textarea':
      return `<label class="f">${esc(f.label)}<textarea id="${id}" rows="${f.size || 6}">${esc(v)}</textarea>${help}
        ${f.preview ? `<div class="f-preview-h">预览</div><div class="f-preview prose" data-for="${id}"></div>
        <details class="fmt-help"><summary>格式说明</summary><table>${FORMAT_HELP.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td>${esc(b)}</td></tr>`).join('')}</table></details>` : ''}</label>`;
    case 'select':
      return `<label class="f">${esc(f.label)}<select id="${id}">${f.options.map(([val, lab]) =>
        `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>${help}</label>`;
    case 'number':
      return `<label class="f">${esc(f.label)}<input id="${id}" type="number" step="any" value="${esc(v)}">${help}</label>`;
    case 'color':
      return `<label class="f">${esc(f.label)}<input id="${id}" type="color" value="${esc(v || '#888888')}">${help}</label>`;
    case 'rows': {
      return `<div class="f">${esc(f.label)}${help}<div class="rows" id="${id}"></div>
        <button type="button" class="ebtn" data-rows-add="${id}">＋ 添加一行</button></div>`;
    }
    case 'info':
      return `<div class="f-info">${f.html}</div>`;
    default:
      return `<label class="f">${esc(f.label)}<input id="${id}" type="text" value="${esc(v)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>${help}</label>`;
  }
}

function rowHtml(cols, row) {
  return `<div class="row">${cols.map(c => {
    const v = row[c.key] ?? '';
    if (c.type === 'select') return `<select data-col="${c.key}" title="${esc(c.label)}">${c.options.map(([val, lab]) =>
      `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    if (c.type === 'color') return `<input data-col="${c.key}" type="color" value="${esc(v || '#888888')}" title="${esc(c.label)}">`;
    return `<input data-col="${c.key}" type="${c.type === 'number' ? 'number' : 'text'}" step="any" placeholder="${esc(c.label)}" value="${esc(v)}" style="flex:${c.flex || 1}">`;
  }).join('')}<button type="button" class="ebtn" data-row="up">↑</button><button type="button" class="ebtn" data-row="down">↓</button><button type="button" class="ebtn danger" data-row="del">✕</button></div>`;
}

export function openForm({ title, fields, submitLabel = '保存', wide = false, extraButtons = '' }) {
  return new Promise(resolve => {
    const dlg = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}">
      <div class="modal-h">${esc(title)}<button class="x" data-close>✕</button></div>
      <div class="modal-b">${fields.map(fieldHtml).join('')}</div>
      <div class="modal-f">${extraButtons}<span class="grow"></span><button class="btn" data-close>取消</button><button class="btn primary" data-ok>${esc(submitLabel)}</button></div>
    </div></div>`);
    document.body.appendChild(dlg);

    // 行编辑器
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
    // 实时预览
    for (const pv of $$('.f-preview', dlg)) {
      const ta = $('#' + pv.dataset.for, dlg);
      const upd = () => { pv.innerHTML = renderText(ta.value, { resolveLink }) || '<span class="muted">（空）</span>'; };
      ta.addEventListener('input', upd); upd();
    }

    const close = (val) => { dlg.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const collect = () => {
      const out = {};
      for (const f of fields) {
        if (f.type === 'info') continue;
        const el = $('#f_' + f.key, dlg);
        if (f.type === 'rows') {
          out[f.key] = $$('.row', el).map(r => {
            const o = {};
            for (const c of f.columns) {
              const inp = $(`[data-col="${c.key}"]`, r);
              o[c.key] = c.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : (c.numeric ? Number(inp.value) : inp.value);
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
      else if (e.target.closest('[data-extra]')) close({ __extra: e.target.closest('[data-extra]').dataset.extra, ...collect() });
    });
    setTimeout(() => $('input,textarea', dlg)?.focus(), 30);
  });
}

function confirmBox(msg) {
  return openForm({ title: '确认', fields: [{ type: 'info', html: esc(msg) }], submitLabel: '确定' }).then(v => !!v);
}

const splitList = (s) => String(s || '').split(/[,，、\n]/).map(x => x.trim()).filter(Boolean);

// ================= 各种编辑动作 =================
const actions = {
  // ---- 读者：显示剧透 ----
  reveal(ds) { reveal(ds.key); rerender(); },

  // ---- 站点 ----
  async 'edit-site'() {
    const s = state.data.site;
    const v = await openForm({
      title: '站点信息与阅读进度', wide: true, fields: [
        { key: 'title', label: '站点名称', value: s.title },
        { key: 'subtitle', label: '副标题', value: s.subtitle },
        { key: 'intro', label: '首页介绍', type: 'textarea', value: s.intro, preview: true, size: 4 },
        { key: 'progress', label: '阅读进度（防剧透等级，从上到下依次递进）', type: 'rows', value: s.progress,
          help: '第一行是“所有人可见”。每段内容都可以标上需要读到哪一级才显示。读者在顶部选择自己的进度。',
          columns: [{ key: 'label', label: '名称，例如：读完第一篇' }] },
        { key: 'defaultProgress', label: '新读者默认进度', type: 'select', numeric: true, value: s.defaultProgress ?? 0,
          options: s.progress.map((p, i) => [i, p.label]) },
      ],
    });
    if (!v) return;
    if (!v.progress.length) v.progress = [{ label: '全部' }];
    Object.assign(s, v);
    s.defaultProgress = Math.min(v.defaultProgress, v.progress.length - 1);
    touch(); rerender();
  },

  async 'add-module'() {
    const v = await openForm({
      title: '新建模块', fields: [
        { key: 'title', label: '模块名称', value: '', placeholder: '例如：势力、地点、能力' },
        { key: 'icon', label: '图标（一个 emoji 或字）', value: '📁' },
        { key: 'type', label: '模块类型', type: 'select', value: 'wiki',
          options: Object.entries(MODULE_TYPES).map(([k, t]) => [k, `${t.label} —— ${t.desc}`]) },
      ],
    });
    if (!v || !v.title.trim()) return;
    const m = normalize({ modules: [{ id: uid('m'), title: v.title.trim(), icon: v.icon, type: v.type }] }).modules[0];
    if (m.type === 'catalog') m.groups.push({ id: uid('g'), title: '默认分类', intro: '', fields: [] });
    state.data.modules.push(m);
    touch(); location.hash = `#/m/${m.id}`; rerender();
  },

  async 'edit-module'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({
      title: '编辑模块', fields: [
        { key: 'title', label: '名称', value: m.title },
        { key: 'icon', label: '图标', value: m.icon },
        { key: 'id', label: '网址标识（英文/数字，改了会让旧链接失效）', value: m.id },
        { key: 'intro', label: '模块介绍', type: 'textarea', value: m.intro, preview: true, size: 4 },
      ],
    });
    if (!v) return;
    const newId = v.id.trim().replace(/[^\w-]/g, '') || m.id;
    if (newId !== m.id && findModule(newId)) { toast('这个网址标识已被占用'); return; }
    Object.assign(m, { title: v.title, icon: v.icon, intro: v.intro, id: newId });
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

  // ---- 百科页面 ----
  async 'add-page'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({ title: '新建页面', fields: [{ key: 'title', label: '页面标题', value: '' }] });
    if (!v || !v.title.trim()) return;
    const p = { id: uid('p'), title: v.title.trim(), summary: '', spoiler: 0, sections: [] };
    m.pages.push(p);
    touch(); location.hash = routeOf(m, p); rerender();
  },

  // ---- 分类图鉴：子界面 ----
  async 'add-group'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({
      title: '新建子界面', fields: [
        { key: 'title', label: '名称', value: '', placeholder: '例如：人类 / 概念 / 特殊' },
        { key: 'fields', label: '设定栏模板（每行一个字段，新建条目时自动带上）', type: 'textarea', size: 5, value: '' },
      ],
    });
    if (!v || !v.title.trim()) return;
    const g = { id: uid('g'), title: v.title.trim(), intro: '', fields: splitList(v.fields) };
    m.groups.push(g);
    touch(); location.hash = `#/m/${m.id}/g/${g.id}`; rerender();
  },

  async 'edit-group'(ds) {
    const m = findModule(ds.m);
    const g = m.groups.find(x => x.id === ds.g);
    const v = await openForm({
      title: '编辑子界面', fields: [
        { key: 'title', label: '名称', value: g.title },
        { key: 'intro', label: '介绍', type: 'textarea', value: g.intro, preview: true, size: 3 },
        { key: 'fields', label: '设定栏模板（每行一个字段）', type: 'textarea', size: 6, value: (g.fields || []).join('\n'),
          help: '例如：英文名、年龄、阶级、概念、印记、所属、首次登场。只影响之后新建的条目。' },
      ],
    });
    if (!v) return;
    Object.assign(g, { title: v.title, intro: v.intro, fields: splitList(v.fields) });
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
      title: `在「${g.title}」新建条目`, fields: [
        { key: 'title', label: '名称', value: '' },
        { key: 'subtitle', label: '副标题 / 英文名', value: '' },
      ],
    });
    if (!v || !v.title.trim()) return;
    const e = {
      id: uid('c'), group: g.id, title: v.title.trim(), subtitle: v.subtitle, summary: '', image: '', spoiler: 0,
      infobox: (g.fields || []).map(k => ({ k, v: '', spoiler: 0 })), sections: [],
    };
    m.entries.push(e);
    touch(); location.hash = routeOf(m, e); rerender();
  },

  // ---- 时间线 ----
  async 'add-timeline'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({ title: '新建时间线', fields: [{ key: 'title', label: '名称', value: '', placeholder: '例如：人神游戏时间线' }] });
    if (!v || !v.title.trim()) return;
    const t = { id: uid('t'), title: v.title.trim() };
    m.timelines.push(t);
    touch(); location.hash = `#/m/${m.id}/t/${t.id}`; rerender();
  },

  async 'edit-timeline'(ds) {
    const m = findModule(ds.m);
    const t = m.timelines.find(x => x.id === ds.t);
    const v = await openForm({ title: '编辑时间线', fields: [{ key: 'title', label: '名称', value: t.title }] });
    if (!v) return;
    t.title = v.title; touch(); rerender();
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
          help: '事件按“排序值”落进纪元：起点 ≤ 排序值 < 终点。留空表示无限。建议用“距今多少年”的负数，例如九百年前填 -900，现在填 0。',
          newRow: () => ({ id: uid('e'), color: '#8a7f6a' }),
          columns: [{ key: 'title', label: '名称', flex: 2 }, { key: 'from', label: '起点', type: 'number' }, { key: 'to', label: '终点', type: 'number' }, { key: 'color', label: '颜色', type: 'color' }] },
      ],
    });
    if (!v) return;
    m.eras = v.eras.map(e => ({ id: uid('e'), ...e, from: e.from === '' ? null : e.from, to: e.to === '' ? null : e.to }));
    touch(); rerender();
  },

  async 'add-event'(ds) {
    const m = findModule(ds.m);
    const v = await openForm({
      title: '新建事件', fields: [
        { key: 'title', label: '事件名称', value: '' },
        { key: 'label', label: '时间（显示文字）', value: '', placeholder: '例如：近九百年前 / 共鸣纪 100 年 / 第二篇' },
        { key: 'sort', label: '排序值（数字，越小越早）', type: 'number', value: 0, help: '决定事件在时间线上的位置。例如九百年前填 -900，现在填 0。' },
      ],
    });
    if (!v || !v.title.trim()) return;
    const e = {
      id: uid('e'), title: v.title.trim(), summary: '', spoiler: 0, infobox: [], sections: [],
      date: { label: v.label, sort: v.sort, timeline: ds.t },
    };
    m.entries.push(e);
    touch(); location.hash = routeOf(m, e); rerender();
  },

  // ---- 条目通用 ----
  async 'edit-item'(ds) {
    const m = findModule(ds.m);
    const p = findItem(m, ds.p);
    const fields = [
      { key: 'title', label: '标题', value: p.title },
      { key: 'subtitle', label: m.type === 'catalog' ? '副标题 / 英文名' : '副标题', value: p.subtitle || '' },
      { key: 'aliases', label: '别名（用顿号或逗号分隔，站内链接也会认这些名字）', value: (p.aliases || []).join('、') },
      { key: 'summary', label: '导语（页面开头的一段概述）', type: 'textarea', value: p.summary, preview: true, size: 4 },
      { key: 'spoiler', label: '整个条目的剧透等级', type: 'select', numeric: true, value: p.spoiler || 0, options: spoilerOptions() },
      { key: 'id', label: '网址标识（英文/数字）', value: p.id },
    ];
    if (m.type !== 'wiki') fields.splice(3, 0, { key: 'image', label: '图片地址（可留空）', value: p.image || '', help: '可以填图片网址，或者把图片放进仓库 images 文件夹后填 images/文件名.png' });
    if (m.type === 'catalog') fields.push({ key: 'group', label: '所属子界面', type: 'select', value: p.group, options: m.groups.map(g => [g.id, g.title]) });
    if (m.type === 'timeline') {
      fields.push(
        { key: 'dlabel', label: '时间（显示文字）', value: p.date?.label || '' },
        { key: 'dsort', label: '排序值（数字，越小越早）', type: 'number', value: p.date?.sort ?? 0 },
        { key: 'dtl', label: '所属时间线', type: 'select', value: p.date?.timeline || m.timelines[0]?.id, options: m.timelines.map(t => [t.id, t.title]) },
      );
    }
    const v = await openForm({ title: '编辑基本信息', fields, wide: true });
    if (!v) return;
    const newId = v.id.trim().replace(/[^\w-]/g, '') || p.id;
    if (newId !== p.id && findItem(m, newId)) { toast('这个网址标识已被占用'); return; }
    Object.assign(p, {
      title: v.title.trim() || p.title, subtitle: v.subtitle, summary: v.summary, spoiler: v.spoiler,
      aliases: splitList(v.aliases), id: newId,
    });
    if ('image' in v) p.image = v.image.trim();
    if ('group' in v) p.group = v.group;
    if (m.type === 'timeline') p.date = { label: v.dlabel, sort: v.dsort, timeline: v.dtl };
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
        { key: 'rows', label: '字段', type: 'rows', value: p.infobox,
          help: '左边填字段名（如“阶级”），中间填内容（支持 [[链接]] 和 **粗体**），右边选剧透等级。',
          newRow: () => ({ spoiler: 0 }),
          columns: [{ key: 'k', label: '字段名' }, { key: 'v', label: '内容', flex: 3 }, { key: 'spoiler', label: '剧透', type: 'select', numeric: true, options: spoilerOptions() }] },
      ],
    });
    if (!v) return;
    p.infobox = v.rows.filter(r => r.k || r.v);
    touch(); rerender();
  },

  async 'add-section'(ds) {
    const m = findModule(ds.m);
    const p = findItem(m, ds.p);
    const v = await sectionForm({ title: '', body: '', level: 2, spoiler: 0 }, '添加章节');
    if (!v) return;
    const s = { id: uid('s'), ...v };
    const i = ds.s ? p.sections.findIndex(x => x.id === ds.s) + 1 : p.sections.length;
    p.sections.splice(i, 0, s);
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

  // ---- 点击红色链接：直接创建页面 ----
  async 'create-missing'(ds) {
    const choices = [];
    for (const m of state.data.modules) {
      if (m.type === 'catalog') m.groups.forEach(g => choices.push([`${m.id}|${g.id}`, `${m.title} › ${g.title}`]));
      else if (m.type === 'timeline') choices.push([`${m.id}|${m.timelines[0]?.id}`, `${m.title}`]);
      else choices.push([`${m.id}|`, m.title]);
    }
    if (!choices.length) { toast('请先新建一个模块'); return; }
    const v = await openForm({
      title: `创建页面「${ds.missing}」`, fields: [{ key: 'where', label: '放在哪里', type: 'select', value: choices[0][0], options: choices }],
      submitLabel: '创建',
    });
    if (!v) return;
    const [mid, sub] = v.where.split('|');
    const m = findModule(mid);
    const base = { title: ds.missing, summary: '', spoiler: 0, sections: [] };
    let item;
    if (m.type === 'wiki') { item = { id: uid('p'), ...base }; m.pages.push(item); }
    else if (m.type === 'catalog') {
      const g = m.groups.find(x => x.id === sub);
      item = { id: uid('c'), group: sub, subtitle: '', image: '', infobox: (g?.fields || []).map(k => ({ k, v: '', spoiler: 0 })), ...base };
      m.entries.push(item);
    } else { item = { id: uid('e'), infobox: [], date: { label: '', sort: 0, timeline: sub }, ...base }; m.entries.push(item); }
    touch(); location.hash = routeOf(m, item); rerender();
  },

  // ---- 工具栏 ----
  async publish() {
    const cfg = getConfig();
    if (!cfg.owner || !cfg.token) { toast('先填写 GitHub 设置'); await actions['gh-settings'](); return; }
    const v = await openForm({
      title: '发布到网站', submitLabel: '发布', fields: [
        { key: 'msg', label: '这次改了什么（会记在 GitHub 的提交记录里）', value: '更新百科' },
        { type: 'info', html: '发布后 GitHub 需要 1～2 分钟重新部署，读者那边可能还要再等几分钟才能看到（浏览器缓存）。' },
      ],
    });
    if (!v) return;
    const bar = $('#ed-status');
    try {
      bar.textContent = '发布中…';
      state.data.updatedAt = Date.now();
      const url = await publish(state.data, v.msg);
      markPublished();
      toast('发布成功！');
      console.log('commit:', url);
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
        if (!(await confirmBox('用这个文件替换当前全部内容？（会变成本地草稿，发布后才会上线）'))) return;
        state.data = normalize(data);
        touch(); rerender(); toast('已导入');
      } catch (e) { toast('导入失败：' + e.message, 5000); }
    };
    inp.click();
  },

  async discard() {
    if (!(await confirmBox('丢弃所有未发布的修改，恢复成网站上的版本？'))) return;
    discardDraft(); rerender(); toast('已恢复线上版本');
  },

  async 'gh-settings'() {
    const c = getConfig();
    const v = await openForm({
      title: 'GitHub 发布设置', wide: true, extraButtons: '<button class="btn" data-extra="test">测试连接</button>',
      fields: [
        { type: 'info', html: '这些信息只保存在<b>这台设备的浏览器</b>里，不会上传到网站。换电脑需要重新填写。' },
        { key: 'owner', label: 'GitHub 用户名', value: c.owner },
        { key: 'repo', label: '仓库名', value: c.repo },
        { key: 'branch', label: '分支', value: c.branch || 'main' },
        { key: 'path', label: '数据文件路径', value: c.path || 'data/wiki.json' },
        { key: 'token', label: '访问令牌（Fine-grained token，只授权这个仓库的 Contents 读写）', value: c.token },
      ],
    });
    if (!v) return;
    const { __extra, ...cfg } = v;
    setConfig(cfg);
    if (__extra === 'test') {
      try { toast('连接成功：' + await testConnection(cfg)); }
      catch (e) { toast('连接失败：' + e.message, 6000); }
      return actions['gh-settings']();
    }
    toast('已保存');
  },

  'toggle-edit'() {
    state.editMode = !state.editMode;
    document.body.classList.toggle('editing', state.editMode);
    rerender();
  },
};

function sectionForm(s, title) {
  return openForm({
    title, wide: true, fields: [
      { key: 'title', label: '章节标题', value: s.title },
      { key: 'level', label: '层级', type: 'select', numeric: true, value: s.level || 2, options: [[2, '一级标题（进目录）'], [3, '二级标题（目录里缩进）']] },
      { key: 'spoiler', label: '剧透等级', type: 'select', numeric: true, value: s.spoiler || 0, options: spoilerOptions() },
      { key: 'body', label: '正文（Ctrl+Enter 保存）', type: 'textarea', value: s.body, preview: true, size: 12 },
    ],
  });
}

async function onClick(e) {
  // 目录跳转
  const go = e.target.closest('[data-goto]');
  if (go) {
    e.preventDefault();
    document.getElementById(go.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  // 行内剧透
  const sp = e.target.closest('.spoiler-inline:not([data-act])');
  if (sp) { sp.classList.add('shown'); return; }
  // 红链
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

// 编辑模式底部工具栏
export function toolbarHtml() {
  if (!state.editMode) return '';
  const cfg = getConfig();
  const status = state.usingDraft ? '● 有未发布的修改（已自动保存在本机）' : '✓ 与网站一致';
  return `<div class="ed-bar">
    <span id="ed-status" class="${state.usingDraft ? 'dirty' : ''}">${status}</span>
    <span class="grow"></span>
    <button class="btn primary" data-act="publish">发布到网站</button>
    <button class="btn" data-act="export">导出备份</button>
    <button class="btn" data-act="import">导入</button>
    <button class="btn" data-act="discard" ${state.usingDraft ? '' : 'disabled'}>放弃修改</button>
    <button class="btn" data-act="gh-settings">${cfg.token ? 'GitHub 设置' : '⚠ 填写 GitHub 设置'}</button>
    <button class="btn" data-act="toggle-edit">退出编辑</button>
  </div>`;
}
