# Portfolio Studio · 本地内容工作台

管理本仓库（父目录）静态作品集站点的本地可视化工作台。它编辑 `content/site.json` 与 `content/projects.json`，用 sharp / FFmpeg 处理上传的媒体，预览真实页面，并把 `content/` + `media/` 提交推送到 Git。

完整快速开始见[仓库根 README](../README.md)，JSON 字段契约见[内容结构文档](../docs/content-schema.md)，适配器接口见[适配器文档](../docs/adapter-api.md)，从编辑到线上生效的链路见[生效逻辑报告](../docs/how-it-works.md)。

## 环境要求

- Node.js ≥ 21（使用内置测试运行器与 `fetch`）
- FFmpeg + ffprobe 在 `PATH` 中（仅视频上传需要；没有它图片与工作台照常可用）

## 启动

```bash
cd studio
npm install
cp config.example.json config.json
npm start
# 打开 http://127.0.0.1:3737（或 http://localhost:3737）
```

服务只绑定 `127.0.0.1`。`config.json` 已被 Git 忽略。

## 适配器

工作台核心是通用的：站点结构（内容文档、媒体布局、头像、发布范围、编辑界面）由适配器声明。默认 `portfolio`，内置 `landing` 最小示例；通过 `config.json` 的 `adapter` 选择，环境变量 `STUDIO_ADAPTER` 可覆盖。

新增适配器：在 `studio/adapters/<id>/index.js` 实现 `BaseAdapter`（或满足同样接口），并在 `studio/server/adapters/loader.js` 的 `switch` 中登记。适配器是本地受信任代码。完整契约、字段类型与自定义组件见 [docs/adapter-api.md](../docs/adapter-api.md)。

## 配置

```json
{
  "adapter": "portfolio",
  "sitePath": "..",
  "port": 3737,
  "production": {
    "url": "",
    "expectedRemote": "https://github.com/your-name/your-site.git",
    "branch": "main",
    "testScript": "test",
    "deployCheck": { "enabled": false }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `adapter` | 适配器 id，默认 `portfolio` |
| `sitePath` | 站点仓库根目录，默认 `..`（当前仓库根） |
| `port` | 本地端口，默认 3737 |
| `production.expectedRemote` | 期望的 `origin` 地址；留空则跳过远程校验 |
| `production.branch` | 发布分支 |
| `production.testScript` | 发布前运行的 npm 脚本，默认 `test` |
| `production.url` + `deployCheck.enabled` | 推送后轮询 `${url}/content/site.json` 与 `/content/projects.json` 确认部署；`url` 留空则跳过 |

环境变量覆盖：`STUDIO_ADAPTER`、`STUDIO_SITE_PATH`、`STUDIO_PORT`、`STUDIO_SITE_URL`、`STUDIO_GIT_REMOTE`、`STUDIO_GIT_BRANCH`。

## 功能

- **首页资料 / 关于页**：编辑资料、技术标签、联系方式、教育、实习、能力；上传或恢复头像。
- **作品**：新建、拖拽排序、归档、首次发布后锁定 slug；选择封面；调整工程胶片顺序；填写替代文本、说明与功能标签。
- **素材库**：列出媒体文件与引用关系；扫描未使用素材并在确认后删除（普通删除只移除引用）。
- **发布**：校验 → 站点测试 → Git 前置检查 → 只暂存 `content/` + `media/` → 提交 → 推送 → 可选部署确认。
- **预览**：右侧 iframe 加载真实站点，读取已保存的草稿；外部文章接口在本地可能不可用。
- **帮助**：内置使用说明（首次打开自动展示）。

## 媒体规则

- 图片：JPG / PNG / WebP → WebP，最长边 ≤ 1920px，≤ 2 MiB。
- 视频：MP4 / MOV / WebM → H.264/AAC MP4，≤ 1080p、≤ 12 秒、≤ 18 MiB，并生成 WebP 封面。
- 头像：512×512 方图，保存为 `media/profile/avatar.webp`，≤ 1 MiB。
- 全部发布媒体 ≤ 80 MiB；拒绝 SVG、GIF 与 Git LFS 指针。

## 发布保护

- 只暂存 `content/**` 与 `media/**`，其他未提交修改不会被带上。
- 暂存区已有文件、分支不是配置分支、远程地址不符、本地落后或分叉时停止。
- 站点测试失败不创建提交；推送失败保留本地提交并提示检查凭据；部署确认超时给出"已推送待确认"提示。
- 发布成功后记录已发布 slug，禁止再修改这些 slug。

## 测试

```bash
npm test
```

覆盖：适配器契约与加载、manifest 导航/表单渲染、内容校验、备份与原子写入、slug 改名与锁定、图片/视频处理、上传安全（Host / Origin / 令牌 / 路径 / 魔数）、发布流水线（暂存范围、分叉、测试失败、推送拒绝、部署超时、并发发布），以及 landing 示例适配器的端到端流程。

## 安全模型

- 仅绑定回环地址；每次启动生成随机会话令牌，写接口必须携带。
- 校验 Host（仅 `127.0.0.1:<port>` / `localhost:<port>`）与 Origin；不发送任何 CORS 头。
- 静态文件走文件索引，请求路径只作为 Map 键，不参与路径拼接。
- 媒体按魔数判断类型、由服务端生成文件名；先写临时文件，成功后原子移动。
- 保存前备份、原子写入 JSON；发布轮询只允许 HTTPS + 配置域名，并拒绝解析到环回/私网/保留地址的主机。
- Git 使用本机凭据，不保存 Token；`.studio/` 与 `config.json` 已被 Git 忽略。

## 许可证

MIT
