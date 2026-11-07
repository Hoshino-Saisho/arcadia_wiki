// 通过 GitHub API 把 data/wiki.json 直接提交到仓库（“发布”按钮）。
// 令牌只保存在当前浏览器的 localStorage，不会写进网站文件。
import { storageGet, storageSet, utf8ToBase64 } from './util.js';

const KEY = 'arcadia-wiki-github';

export function getConfig() {
  return storageGet(KEY, { owner: '', repo: '', branch: 'main', path: 'data/wiki.json', token: '' });
}

export function setConfig(cfg) {
  storageSet(KEY, cfg);
}

export function isConfigured() {
  const c = getConfig();
  return !!(c.owner && c.repo && c.token);
}

async function api(cfg, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += ' ' + (await res.json()).message; } catch { /* ignore */ }
    if (res.status === 401) msg += '（令牌无效或已过期）';
    if (res.status === 403) msg += '（令牌没有写入权限）';
    if (res.status === 404) msg += '（找不到仓库或文件，检查用户名/仓库名/分支，或令牌没有授权这个仓库）';
    throw new Error(msg);
  }
  return res.json();
}

function contentsUrl(cfg) {
  const path = cfg.path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
}

// 测试连接：能读到仓库就算成功
export async function testConnection(cfg = getConfig()) {
  const repo = await api(cfg, `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`);
  return repo.full_name;
}

export async function publish(data, message) {
  const cfg = getConfig();
  if (!isConfigured()) throw new Error('还没有填写 GitHub 设置');
  let sha;
  try {
    const cur = await api(cfg, `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`);
    sha = cur.sha;
  } catch (e) {
    if (!String(e.message).startsWith('404')) throw e; // 文件不存在时直接新建
  }
  const body = {
    message: message || `更新百科 ${new Date().toLocaleString()}`,
    content: utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await api(cfg, contentsUrl(cfg), { method: 'PUT', body: JSON.stringify(body) });
  return res.commit?.html_url;
}
