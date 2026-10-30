# 作品集站点模板 · Portfolio Studio

一个零构建的静态作品集网站，配一个本地可视化内容工作台。在浏览器里改内容、上传图片/视频、实时预览，然后一键校验、提交、推送发布。

- **站点**：纯 HTML / CSS / JS，无构建步骤。内容存放在 `content/site.json` 与 `content/projects.json`，媒体存放在 `media/`。
- **工作台**：`studio/` 下的本地 Node 应用，只监听回环地址；编辑 JSON、处理图片/视频、预览真实页面，发布时只提交 `content/` 与 `media/`。
- **环境**：工作台需要 Node.js ≥ 21；FFmpeg 可选（只影响视频上传）。

## 快速开始

```bash
git clone https://github.com/<你的账号>/portfolio-studio.git
cd portfolio-studio/studio
npm install
cp config.example.json config.json
# 修改 config.json：sitePath、production.expectedRemote，按需填写 production.url
npm start
# 打开 http://127.0.0.1:3737（或 http://localhost:3737）
```

`studio/config.json` 已被 Git 忽略；`sitePath` 默认是 `..`（仓库根目录），所以工作台直接管理这个仓库。

### 不想用工作台

也可以直接编辑 JSON 和 `media/`：

- `content/site.json`：个人资料、联系方式、教育、实习、能力、头像。
- `content/projects.json`：项目状态、顺序、文案、链接、封面与媒体。
- `media/projects/<项目 slug>/`：项目图片（WebP）与视频（MP4 + WebP 封面）。

字段规则见 [docs/content-schema.md](docs/content-schema.md)。

## 页面

| 文件 | 说明 |
| --- | --- |
| `index.html` | 首页：个人资料、精选作品、最新文章（文章为可选接口） |
| `about.html` | 关于页：教育、实习、能力、联系方式 |
| `projects.html` | 作品列表（16:9 封面） |
| `project.html` | 作品详情：`?id=<slug>`，大封面、工程胶片、视频 |
| `blog.html` | 文章列表（可选接口） |
| `article.html` | 文章详情与留言（可选接口） |

## 可选文章接口

文章区默认关闭。在 `content/site.json` 里把 `integrations.postsApiBase` 设为 HTTPS 接口地址即可启用。页面期望的契约：

- `GET {base}/posts?pageNum=1&pageSize=6` → `{ "data": { "items": [{ "postId", "title", "excerpt", "category", "createdAt", "commentCount" }] } }`
- `GET {base}/posts/{id}` → `{ "data": { "title", "content"（Markdown）, "category", "createdAt", "commentCount" } }`
- `GET {base}/posts/{id}/comments?pageNum=1&pageSize=50` → `{ "data": { "items": [...] } }`

留空时页面显示"文章功能未配置"，不会发起请求。接口需要允许你的站点域名跨域访问。

## 适配器：接入自己的站点结构

默认的 `portfolio` 适配器对应本仓库的模板。要让工作台管理**另一种站点结构**，在 `studio/adapters/<id>/index.js` 实现 `BaseAdapter`（或写一个满足同样接口的对象），声明内容文档、媒体集合、头像、发布范围与界面清单，然后在 `studio/config.json` 里设置：

```json
{ "adapter": "<id>" }
```

- 内容路径、字段表单、媒体布局、slug 锁定、预览路由、发布暂存路径全部由适配器描述；核心负责安全、备份/原子写入、媒体处理与发布流水线。
- 编辑界面由 manifest 自动渲染；特殊字段/视图可以用一个浏览器模块注册自定义组件。
- 内置 `portfolio`（完整作品集）与 `landing`（最小单页示例，含自定义颜色字段与图片编辑器）。
- 完整接口、字段类型与自定义组件说明：[docs/adapter-api.md](docs/adapter-api.md)。

运行内置示例：

```bash
cd studio
cp config.example.json config.json
# 将 config.json 改为："adapter": "landing", "sitePath": "../examples/landing-site"
npm start
```

## 媒体规则

- 图片：JPG / PNG / WebP → WebP，最长边 ≤ 1920px，≤ 2 MiB。
- 视频：MP4 / MOV / WebM → H.264/AAC MP4，≤ 1080p、≤ 12 秒、≤ 18 MiB，并生成 WebP 封面。
- 头像：512×512 方图，保存为 `media/profile/avatar.webp`（在工作台上传）。
- 全部发布媒体 ≤ 80 MiB；拒绝 SVG、GIF 与 Git LFS 指针。

## 发布

工作台的发布流水线：

1. 校验内容与媒体；
2. 运行站点测试脚本（默认 `npm test`，可用 `production.testScript` 修改）；
3. 检查 Git 分支、暂存区与远程（未配置远程时跳过远程检查）；
4. 只暂存适配器声明的发布路径（默认 `content/` 与 `media/`），提交并推送 `origin/<branch>`；
5. 可选：轮询 `production.url` 上的 JSON，确认部署已生效。

`studio/config.json` 示例：

```json
{
  "sitePath": "..",
  "port": 3737,
  "production": {
    "url": "https://example.com",
    "expectedRemote": "https://github.com/your-name/your-site.git",
    "branch": "main",
    "testScript": "test",
    "deployCheck": { "enabled": true }
  }
}
```

`production.url` 留空或 `deployCheck.enabled` 为 `false` 时跳过部署确认，但提交与推送照常执行。站点可以部署到任意静态托管（GitHub Pages、Netlify、Vercel、Cloudflare Pages、对象存储 + CDN 等）。

## 工作台功能

- 页面：首页资料、关于页、作品、素材库、发布。
- 作品管理：新建、拖拽排序、归档、发布后锁定 slug、选择封面、工程胶片排序、替代文本。
- 媒体：拖拽上传、自动转 WebP / MP4、视频封面、未使用素材清理。
- 头像：上传、自动裁切、恢复默认；本地头像优先于姓名首字。
- 实时预览：右侧加载真实站点页面，读取已保存的草稿。
- 安全：仅监听回环地址、写接口需要会话令牌、校验 Host / Origin、备份与原子写入、只发布 `content/` 与 `media/`。

## 测试

```bash
npm test                # 站点检查
cd studio && npm test   # 工作台检查（portfolio + landing 适配器）
```

## 目录

```text
content/ media/ assets/ *.html   站点模板（portfolio 适配器管理）
tests/                           站点验收测试
studio/server/                   工作台核心（HTTP、存储、媒体、发布）
studio/server/adapters/          适配器契约与加载器
studio/adapters/portfolio/       默认适配器（完整作品集）
studio/adapters/landing/         最小示例适配器（含自定义组件）
studio/web/                      manifest 驱动的通用界面
examples/landing-site/           landing 示例站点
docs/                            内容契约、适配器接口、生效逻辑
```

## 安全说明

- 工作台只在本机使用，不要把 3737 端口暴露到公网。
- Git 使用本机已有凭据，工作台不保存任何 Token。
- `.studio/`（备份、临时文件）与 `studio/config.json` 已被 Git 忽略。

## 架构与生效逻辑

从编辑到线上生效的完整链路（含流程图、失败分支、缓存与回退策略）见 [docs/how-it-works.md](docs/how-it-works.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
