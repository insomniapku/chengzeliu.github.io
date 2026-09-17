# 博客后台部署与维护

## Architecture

主站仍由 GitHub Pages 发布，没有迁移：

```text
chengzeliu.com/admin/ (静态 HTML/CSS/JS)
        │ credentials: include
        ▼
api.chengzeliu.com (Cloudflare Worker)
        ├── GitHub Contents API ──► _posts/*.md ──► GitHub Pages/Jekyll
        └── R2 BLOG_IMAGES ───────► img.chengzeliu.com/blog/...
```

浏览器只持有由 Worker 设置的 `HttpOnly` session cookie。GitHub Token、密码 hash、session secret 和 R2 凭据都不会发送到浏览器。

当前站点是在原纯 HTML 首页上加入的最小 Jekyll 层：

- `_posts/`：Markdown 文章。
- `_layouts/post.html`：文章页面模板。
- `blog/index.html`：文章列表。
- `index.html`：保留原主页，只把 Blog 卡片改成读取 `site.posts`。
- `admin/`：无框架静态管理后台。
- `worker/`：Cloudflare Worker API。

文章 URL 由 `_config.yml` 的 `permalink: /blog/:slug/` 生成。例如 `_posts/2026-09-17-my-post.md` 对应 `/blog/my-post/`。

## Markdown format

后台写入的文章格式如下：

```yaml
---
layout: post
title: "My Post"
date: "2026-09-17"
slug: "my-post"
description: "Post description"
cover: "https://img.chengzeliu.com/blog/2026/09/17/example.webp"
---
```

正文是普通 Markdown。更新文章时会保留 Worker 能解析的额外 Front Matter 字段。首版解析器支持标量和 JSON 风格数组/对象；不要在 Front Matter 中使用嵌套缩进 YAML。文章发布后 slug 固定，避免使用 Contents API 重命名时产生两个非原子 commit。

## Required Cloudflare configuration

### 1. 创建 R2 bucket

创建 bucket：

```text
chengzeliu-blog-images
```

`worker/wrangler.jsonc` 已把它绑定为 `BLOG_IMAGES`。

在 R2 bucket 的 Settings → Custom Domains 中连接 `img.chengzeliu.com`。图片需要能通过该自定义域公开读取。Worker 只负责写入/删除；浏览器没有 R2 密钥。

### 2. 检查 Worker 非敏感变量

部署前检查 `worker/wrangler.jsonc`：

```text
GITHUB_OWNER=insomniapku
GITHUB_REPO=chengzeliu.github.io
GITHUB_BRANCH=main
POSTS_DIRECTORY=_posts
PUBLIC_IMAGE_BASE_URL=https://img.chengzeliu.com
ALLOWED_ORIGINS=https://chengzeliu.com,https://www.chengzeliu.com
ENVIRONMENT=production
```

仓库目前实际分支是 `main`。如果以后更换默认发布分支，需要同步修改 `GITHUB_BRANCH`。

配置包含两个 Cloudflare 原生 Rate Limiting binding：登录每 IP 每分钟 5 次，写操作每 IP 每分钟 30 次。若账户套餐或 namespace 规则要求不同，可修改 `namespace_id`，但不要删除生产环境的登录限流。

### 3. 设置 Worker Secrets

在 `worker/` 目录执行：

```powershell
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put SESSION_SECRET
```

需要的敏感 Secret 只有：

- `GITHUB_TOKEN`
- `ADMIN_PASSWORD_HASH`
- `SESSION_SECRET`

生成密码 hash：

```powershell
npm run hash-password
```

脚本会要求输入至少 12 个字符的密码，并输出 PBKDF2-SHA256 hash。把输出作为 `ADMIN_PASSWORD_HASH`，不要把明文密码或 hash 写入 Git。

生成 session secret 的一种方式：

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"
```

把输出作为 `SESSION_SECRET`。它至少需要 32 个字符。轮换它会立即让现有登录 session 失效。

### 4. Worker custom domain

部署 Worker 后，在 Cloudflare Workers & Pages → Worker → Settings → Domains & Routes 中添加 `api.chengzeliu.com`。

不要把 `chengzeliu.com` 主域切换到 Worker；主域继续指向 GitHub Pages。

## Required GitHub configuration

创建 fine-grained Personal Access Token：

1. Repository access 只选择 `insomniapku/chengzeliu.github.io`。
2. Repository permissions 只额外授予 `Contents: Read and write`。
3. Metadata 的只读权限是 GitHub 自动附带的。
4. 设置合理的过期时间，并在过期前轮换 Worker 的 `GITHUB_TOKEN` Secret。

不要把 Token 写入 `wrangler.jsonc`、`.dev.vars.example`、前端文件、localStorage 或 sessionStorage。

GitHub Pages 继续从 `main` 分支发布。Jekyll 会读取 `_config.yml`、`_posts/` 和 `_layouts/`；不需要 Node server 或数据库。首次推送后，在 repository 的 Actions/Pages 页面确认 Jekyll build 成功。

## Local development

Worker：

```powershell
cd worker
npm install
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

在未提交的 `.dev.vars` 中填入测试用 Secret。`npm run dev` 会把 `ENVIRONMENT` 覆盖为 `development`，允许 `localhost`/`127.0.0.1` Origin，并允许本地 HTTP session cookie。生产部署仍强制 `Secure; HttpOnly; SameSite=Strict`。

另开终端，从 repository 根目录启动一个静态文件服务，例如：

```powershell
python -m http.server 4000
```

访问 `http://localhost:4000/admin/`。后台会用相同的本地主机名连接 8787 端口，确保 `SameSite=Strict` cookie 在本地也能正常发送。

本地普通静态服务器不会渲染 Jekyll Liquid；文章页面的完整本地预览需要 Jekyll。GitHub Pages 的构建结果仍应以 Pages build 为准。

## Test

```powershell
cd worker
npm run typecheck
npm test
npx wrangler deploy --dry-run
```

测试覆盖 slug/path traversal、防止 Front Matter 丢字段、GitHub Contents API 请求与 SHA、密码 hash、session 过期、未认证请求、Origin/CSRF、图片签名/MIME/大小，以及文章创建、更新和删除。

## Deployment

### GitHub Pages

```powershell
git add .
git commit -m "Add secure blog admin"
git push origin main
```

等待 GitHub Pages build 成功后检查：

```text
https://chengzeliu.com/
https://chengzeliu.com/blog/
https://chengzeliu.com/blog/homepage-launched/
https://chengzeliu.com/admin/
```

### Cloudflare Worker

完成 R2、Secrets 和 GitHub Token 设置后：

```powershell
cd worker
npm run deploy
```

检查 `https://api.chengzeliu.com/api/health`，预期：

```json
{"ok":true}
```

然后登录 `/admin/`，上传一张测试图片并发布一篇测试文章。Publish 成功只表示 GitHub commit 已创建；GitHub Pages 通常还需要短暂构建时间。

## Security behavior

- 所有文章与图片 API 都要求登录；未登录返回 `401`。
- 所有 `POST`、`PUT`、`DELETE` 都校验精确 Origin，作为 CSRF 防护。
- production CORS 不使用 `*`，并只允许配置的主站 Origin 携带 cookie。
- session 使用 HMAC-SHA256 签名，8 小时过期；cookie 不可被 JavaScript 读取。
- Markdown 上限 512 KiB；图片上限 8 MiB。
- slug 只保留 `a-z`、`0-9` 和 `-`，不能形成路径穿越。
- 图片扩展名由实际文件签名决定，不信任原文件名。
- 后台预览不执行 raw HTML，先转义文章内容，再生成有限的 Markdown 标签；链接协议有白名单。
- 删除文章不会删除 R2 图片。图片生命周期与文章生命周期保持独立。
- API 错误不会把 GitHub 返回体或 Secret 暴露给浏览器。

## API endpoints

```text
GET    /api/health
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/posts
GET    /api/posts/:slug
POST   /api/posts
PUT    /api/posts/:slug
DELETE /api/posts/:slug
POST   /api/images
DELETE /api/images/:key
```

除 `/api/health`、登录和退出外，其余接口要求有效 session。退出也要求来自允许的 Origin。

## 尚未包含

首版刻意没有多用户、数据库、草稿流、WYSIWYG、图片资产管理器、自动删除未使用图片、评论、搜索、Newsletter 或 Analytics dashboard。R2 图片优化/压缩也未加入；上传会原样保存经过类型与大小验证的文件。
