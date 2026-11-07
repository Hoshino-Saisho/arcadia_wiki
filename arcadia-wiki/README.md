# ARCADIA 百科 · 部署与使用指南

这是一个纯静态网站，不需要服务器，也不需要数据库：

- **网页本体**：`index.html` 和 `assets/` 文件夹。
- **全部内容**：只有一个文件，`data/wiki.json`。
- **托管**：放在 GitHub Pages 上，免费。
- **编辑**：在网页上点“发布”，编辑器会通过 GitHub API 把新的 `wiki.json` 提交到仓库，GitHub 再自动重新部署。

```
arcadia-wiki/
├─ index.html            网页入口
├─ .nojekyll             告诉 GitHub 不要用 Jekyll 处理（保留即可）
├─ assets/css/style.css  样式
├─ assets/js/            程序（main / render / editor / store / markdown / github / util）
├─ data/wiki.json        ★ 全部内容都在这里
└─ images/               （可选）自己建，用来放角色图片
```

---

## 第一步：建 GitHub 仓库

1. 去 github.com 注册账号，已有账号就跳过。
2. 点右上角 **＋ → New repository**：
   - Repository name 填 `arcadia-wiki`（随意，后面要用）。
   - 选 **Public**。免费账号只有公开仓库能用 GitHub Pages。
   - 点 **Create repository**。
3. 在新仓库页面点 **uploading an existing file**（或 **Add file → Upload files**）。
4. 把 `arcadia-wiki` 文件夹**里面的所有东西**拖进去。注意是拖里面的东西，不要连文件夹本身一起拖。
   - Mac 默认会隐藏 `.nojekyll` 这个文件，漏传也没关系。
5. 拉到底，点 **Commit changes**。

## 第二步：打开 GitHub Pages

1. 仓库页面 → **Settings → Pages**。
2. **Source** 选 **Deploy from a branch**。
3. **Branch** 选 `main`，文件夹选 `/ (root)`，点 **Save**。
4. 等 1～2 分钟，刷新页面，上方会出现网址：`https://你的用户名.github.io/arcadia-wiki/`。
5. 打开网址，能看到百科首页，第一步和第二步就成功了。

## 第三步：绑定你自己的域名

下面用 `example.com` 代表你买的域名。

### 3.1 先验证域名所有权（推荐，可以防止域名被别人劫持）

1. 点右上角头像 → **Settings**（个人设置，不是仓库设置）→ 左侧 **Pages** → **Add a domain**。
2. 输入 `example.com`。GitHub 会给你一条 **TXT 记录**，名字类似 `_github-pages-challenge-你的用户名`。
3. 到买域名的网站，进入 DNS 管理，添加这条 TXT 记录。
4. 回到 GitHub，点 **Verify**。DNS 生效可能要几分钟到几小时，不行就晚点再点。

### 3.2 在仓库里填域名

1. 仓库 → **Settings → Pages → Custom domain**，填 `example.com`，点 **Save**。
2. GitHub 会自动在仓库里生成一个 `CNAME` 文件，**不要删它**。

> GitHub 官方建议**先在仓库里填好域名，再去改 DNS**。按这个顺序做，就不会有别人趁机占用你的域名。

### 3.3 在域名商那里添加 DNS 记录

| 类型 | 主机名 / 名称 | 值 |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA（可选，IPv6） | `@` | `2606:50c0:8000::153` |
| AAAA（可选） | `@` | `2606:50c0:8001::153` |
| AAAA（可选） | `@` | `2606:50c0:8002::153` |
| AAAA（可选） | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `你的用户名.github.io` |

注意：

- CNAME 的值**不要带仓库名**，就是 `你的用户名.github.io`。
- **不要**添加通配符记录 `*`，会有域名被劫持的风险。
- 如果你用 Cloudflare 管理 DNS，先把这几条记录设成 **DNS only（灰色云朵）**，等 HTTPS 证书签发后再考虑开代理。
- 域名商原来自带的“停放页”A 记录或 CNAME 记录，要删掉，否则会冲突。

### 3.4 打开 HTTPS

1. 回到仓库 **Settings → Pages**，等 DNS 检查通过（显示绿色勾）。
2. 勾选 **Enforce HTTPS**。证书签发最长可能要 24 小时，期间这个选项可能是灰的，等等就好。

完成后，`https://example.com` 和 `https://www.example.com` 都会打开你的百科。

---

## 第四步：让网页编辑器能直接发布

编辑器需要一个只对这个仓库有写入权限的**访问令牌**。

1. 头像 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。
2. 按下面填写：
   - **Token name**：随意，例如 `arcadia-wiki-editor`。
   - **Expiration**：建议选一年，到期再换。
   - **Repository access**：选 **Only select repositories**，只勾 `arcadia-wiki`。
   - **Permissions → Repository permissions → Contents**：选 **Read and write**，其他都不用开。
3. 点 **Generate token**，**复制令牌**。令牌只显示这一次。
4. 打开 `https://example.com/?edit`。网址后面加 `?edit` 会进入编辑模式，同一台设备以后顶部都会显示“编辑”按钮。
5. 点底部工具栏的 **GitHub 设置**，依次填写：
   - 用户名
   - 仓库名 `arcadia-wiki`
   - 分支 `main`
   - 路径 `data/wiki.json`
   - 刚才复制的令牌
6. 点 **测试连接**，显示“连接成功”就可以了。

> 令牌只保存在**这台设备的浏览器**里，不会写进网站，读者看不到。
> 换电脑或换浏览器，需要重新填一次。
> 不要把令牌发给别人，也不要截图外传。万一泄露，到同一个页面把它删掉，重新生成一个。

---

## 日常怎么编辑

1. 打开 `https://example.com/?edit`，或者点顶部的 **✎ 编辑**。
2. 页面上会出现蓝色的小按钮，改什么就点什么：
   - **首页**：新建模块（百科页面 / 分类图鉴 / 时间线三种），编辑站点名称和阅读进度。
   - **分类图鉴**（例如“人物”）：
     - 用 **＋ 子界面** 增加“人类 / 概念 / 特殊”这样的分页。
     - 每个子界面可以设置**设定栏模板**，比如英文名、年龄、阶级。新建条目时会自动带上这些字段。
   - **条目页**：
     - **编辑基本信息**：标题、别名、导语、图片、剧透等级。
     - **编辑角色设定栏**：右侧信息框的字段。
     - **添加章节**：正文，带实时预览和格式说明。
   - **时间线**：
     - 用 **＋ 新建事件** 填写“显示时间”和“排序值”，事件会自动排进时间线。
     - **编辑纪元** 设置纪元的范围和颜色。
     - 用 **＋ 时间线** 再建一条新的时间线。
3. 所有修改会**自动保存在本机**，底部显示“有未发布的修改”。这时候只有你自己能看到。
4. 点 **发布到网站**。等 1～2 分钟 GitHub 重新部署完，读者就能看到了。
5. 每次发布都会在 GitHub 留一条提交记录，改坏了可以在仓库的 **History** 里找回旧版本。也可以随时点 **导出备份**，下载一份 JSON。

### 正文格式

| 写法 | 效果 |
|---|---|
| `**粗体**` | **粗体** |
| `*斜体*` | *斜体* |
| `[[星晨]]` 或 `[[星晨\|主角]]` | 站内链接，按标题或别名自动找页面 |
| `[文字](https://...)` | 外部链接 |
| `\|\|剧透内容\|\|` | 黑条遮住，点击才显示 |
| `- 项目` / `1. 项目` | 列表 |
| `> 引文` | 引用框 |
| `### 小标题` | 段落里的小标题 |

链接到还不存在的页面时，链接会显示成**红色**。编辑模式下点红色链接，可以直接创建这个页面。

### 防剧透

- 在“编辑站点信息”里设置阅读进度的等级，例如：不剧透 / 读完第一篇 / 读完第二篇……
- 整个条目、单个章节、设定栏里的单个字段，都可以设剧透等级。
- 读者在顶部选择自己读到哪里，超出进度的内容会被遮住，点一下才显示。

### 图片

1. 在仓库里新建一个 `images` 文件夹：GitHub 网页上 **Add file → Upload files**，上传时把文件名写成 `images/xxx.png`。
2. 在条目的“图片地址”里填 `images/xxx.png`。

---

## 在自己电脑上预览（可选）

直接双击 `index.html` 打不开数据，因为浏览器不允许本地页面读取文件。需要开一个本地服务器：

```
cd arcadia-wiki
python -m http.server 8000
```

然后打开 `http://localhost:8000/?edit`。
