// 简易文本格式（类 Markdown），保证安全：先转义 HTML，再加格式。
//
// 支持的写法（编辑器里也会显示这张说明）：
//   **粗体**   *斜体*   ~~删除线~~
//   [[页面标题]] 或 [[页面标题|显示文字]]   站内链接（按标题自动查找）
//   [文字](https://...)                       外部链接
//   ||剧透文字||                               模糊遮挡，点击显示
//   以 "- " 开头的行                           列表
//   以 "1. " 开头的行                          有序列表
//   以 "> " 开头的行                           引用
//   以 "### " 开头的行                         小标题（不进目录）
//   空一行                                     分段
import { esc } from './util.js';

export const FORMAT_HELP = [
  ['**粗体**', '粗体'],
  ['*斜体*', '斜体'],
  ['[[星晨]] / [[星晨|主角]]', '站内链接'],
  ['[文字](https://...)', '外部链接'],
  ['||剧透||', '点击才显示'],
  ['- 项目', '列表'],
  ['1. 项目', '有序列表'],
  ['> 引文', '引用'],
  ['### 小标题', '小标题'],
  ['空一行', '分段'],
];

function inline(src, ctx) {
  let s = esc(src);
  // 站内链接 [[标题|显示]]
  s = s.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, label) => {
    const t = target.trim();
    const link = ctx?.resolveLink ? ctx.resolveLink(t) : null;
    const text = (label || t).trim();
    if (link) return `<a class="wikilink" href="${link}">${text}</a>`;
    return `<a class="wikilink missing" title="还没有这个页面" data-missing="${t}">${text}</a>`;
  });
  // 外部链接 [文字](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#\/[^\s)]*)\)/g,
    (_, text, url) => url.startsWith('#')
      ? `<a href="${url}">${text}</a>`
      : `<a href="${url}" target="_blank" rel="noopener">${text}</a>`);
  // 剧透 ||文字||
  s = s.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler-inline" title="点击显示">$1</span>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s;
}

export function renderText(text, ctx) {
  if (!text) return '';
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // {type:'ul'|'ol', items:[]}
  let quote = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(l => inline(l, ctx)).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map(i => `<li>${inline(i, ctx)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.map(l => inline(l, ctx)).join('<br>')}</blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) { flushAll(); continue; }
    if ((m = line.match(/^###\s+(.*)$/))) { flushAll(); out.push(`<h4>${inline(m[1], ctx)}</h4>`); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^[-*•]\s+(.*)$/))) {
      flushPara(); flushQuote();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(m[1]); continue;
    }
    if ((m = line.match(/^\d+[.、]\s*(.*)$/))) {
      flushPara(); flushQuote();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(m[1]); continue;
    }
    flushList(); flushQuote();
    para.push(line);
  }
  flushAll();
  return out.join('\n');
}

// 去掉格式符号，给搜索和摘要用
export function plainText(text) {
  return String(text || '')
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, a, b) => b || a)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|\|(.+?)\|\|/g, '■■■')
    .replace(/[*~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
