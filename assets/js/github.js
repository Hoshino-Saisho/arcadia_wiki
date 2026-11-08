// GitHub API：编辑器登录验证、读取最新数据、发布。
// 令牌只保存在当前浏览器的 localStorage，不会写进网站文件。
//
// 可选的“私有仓库”：完整内容（包括还没公开的部分）存在私有仓库里，
// 公开仓库（网站）里的 wiki.json 只保留发布进度以内的内容。
import { storageGet, storageSet, storageDel, utf8ToBase64 } from './util.js';

const KEY = 'arcadia-wiki-github';

export function getConfig() {
  return { owner: '', repo: '', privateRepo: '', branch: 'main', path: 'data/wiki.json', token: '', ...storageGet(KEY, {}) };
}
export function setConfig(cfg) { storageSet(KEY, cfg); }
export function logout() { storageDel(KEY); }
export function isConfigured() {
  const c = getConfig();
  return !!(c.owner && c.repo && c.token);
}
export function hasPrivate() {
  return !!getConfig().privateRepo;
}

// 从当前网址猜用户名和仓库名：xxx.github.io/仓库名/editor.html
export function guessRepo() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  if (!m) return { owner: '', repo: '', path: 'data/wiki.json' };
  const segs = location.pathname.split('/').filter(Boolean);
  if (segs.length && segs[segs.length - 1].includes('.')) segs.pop(); // 去掉 editor.html
  const userSite = !segs.length;
  const repo = userSite ? `${m[1]}.github.io` : segs.shift();
  const path = [...segs, 'data', 'wiki.json'].join('/'); // 网站放在子文件夹时，数据路径也跟着变
  return { owner: m[1], repo, path };
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

const repoUrl = (c, repo) => `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(repo)}`;
const contentsUrl = (c, repo, path) => `${repoUrl(c, repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
// 私有仓库里固定放在 data/wiki.json
const PRIVATE_PATH = 'data/wiki.json';

async function checkRepo(cfg, repo, label) {
  const r = await api(cfg, repoUrl(cfg, repo));
  if (r.permissions && !r.permissions.push) throw new Error(`令牌对${label}「${repo}」只能读、不能写。请给令牌加上 Contents: Read and write 权限。`);
  return r;
}

// 登录验证：令牌必须对网站仓库（以及私有仓库，如果填了）有写入权限
export async function verify(cfg) {
  const pub = await checkRepo(cfg, cfg.repo, '网站仓库');
  if (cfg.privateRepo) {
    const priv = await checkRepo(cfg, cfg.privateRepo, '私有仓库');
    if (!priv.private) throw new Error(`「${cfg.privateRepo}」是公开仓库。用来存放完整内容的仓库必须设为 Private。`);
  }
  return pub.full_name;
}

async function readJson(cfg, repo, path) {
  try {
    const text = await api(cfg, `${contentsUrl(cfg, repo, path)}?ref=${encodeURIComponent(cfg.branch)}`, {}, 'application/vnd.github.raw+json');
    return JSON.parse(text);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// 读取最新的完整内容：有私有仓库就从私有仓库读（第一次用时私有仓库还是空的，就读网站仓库）
export async function loadRemote(cfg = getConfig()) {
  if (cfg.privateRepo) {
    const full = await readJson(cfg, cfg.privateRepo, PRIVATE_PATH);
    if (full) return full;
  }
  return readJson(cfg, cfg.repo, cfg.path);
}

async function putJson(cfg, repo, path, data, message) {
  let sha;
  try {
    sha = (await api(cfg, `${contentsUrl(cfg, repo, path)}?ref=${encodeURIComponent(cfg.branch)}`)).sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const body = { message, content: utf8ToBase64(JSON.stringify(data, null, 2) + '\n'), branch: cfg.branch };
  if (sha) body.sha = sha;
  return api(cfg, contentsUrl(cfg, repo, path), { method: 'PUT', body: JSON.stringify(body) });
}

// 发布：有私有仓库时，完整版存私有仓库，公开仓库只放 stripForPublic 处理过的版本
export async function publish(data, message, stripForPublic) {
  const cfg = getConfig();
  if (!isConfigured()) throw new Error('还没有登录 GitHub');
  const msg = message || `更新百科 ${new Date().toLocaleString()}`;
  if (cfg.privateRepo) {
    await putJson(cfg, cfg.privateRepo, PRIVATE_PATH, data, msg);
    await putJson(cfg, cfg.repo, cfg.path, stripForPublic(data), msg);
  } else {
    await putJson(cfg, cfg.repo, cfg.path, data, msg);
  }
}
