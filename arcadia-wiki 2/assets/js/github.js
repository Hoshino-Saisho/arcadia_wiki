// GitHub API：编辑器登录验证、读取最新数据、发布。
// 令牌只保存在当前浏览器的 localStorage，不会写进网站文件。
import { storageGet, storageSet, storageDel, utf8ToBase64 } from './util.js';

const KEY = 'arcadia-wiki-github';

export function getConfig() {
  return storageGet(KEY, { owner: '', repo: '', branch: 'main', path: 'data/wiki.json', token: '' });
}
export function setConfig(cfg) { storageSet(KEY, cfg); }
export function logout() { storageDel(KEY); }
export function isConfigured() {
  const c = getConfig();
  return !!(c.owner && c.repo && c.token);
}

// 从当前网址猜用户名和仓库名：xxx.github.io/仓库名/editor.html
export function guessRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  if (!m) return { owner: '', repo: '' };
  const repo = location.pathname.split('/').filter(Boolean)[0] || '';
  return { owner: m[1], repo: repo.endsWith('.html') ? `${m[1]}.github.io` : repo };
}

async function api(cfg, url, opts = {}, accept = 'application/vnd.github+json') {
  const res = await fetch(url, {
    ...opts,
    cache: 'no-store',
    headers: {
      Accept: accept,
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
    if (res.status === 404) msg += '（找不到仓库或文件：检查用户名、仓库名、分支，或者令牌没有授权这个仓库）';
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return accept.includes('raw') ? res.text() : res.json();
}

const repoUrl = (c) => `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
const contentsUrl = (c) => `${repoUrl(c)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;

// 登录验证：令牌必须能读到仓库，而且有写入权限
export async function verify(cfg) {
  const repo = await api(cfg, repoUrl(cfg));
  if (repo.permissions && !repo.permissions.push) throw new Error('这个令牌只能读、不能写。请给令牌加上 Contents: Read and write 权限。');
  return repo.full_name;
}

// 直接从仓库读最新的 wiki.json（比网站上的版本更新，不受部署延迟影响）
export async function loadRemote(cfg = getConfig()) {
  try {
    const text = await api(cfg, `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, {}, 'application/vnd.github.raw+json');
    return JSON.parse(text);
  } catch (e) {
    if (e.status === 404) return null; // 还没有数据文件
    throw e;
  }
}

export async function publish(data, message) {
  const cfg = getConfig();
  if (!isConfigured()) throw new Error('还没有登录 GitHub');
  let sha;
  try {
    sha = (await api(cfg, `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`)).sha;
  } catch (e) {
    if (e.status !== 404) throw e;
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
