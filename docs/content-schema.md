# 内容结构

站点在运行时读取两个 JSON 文件（`cache: "no-cache"`）。任一请求失败时，页面保留内置静态内容并显示提示。工作台直接编辑这两个文件。

## `content/site.json`

```json
{
  "profile": {
    "name": "Your Name",
    "initial": "Y",
    "avatar": "",
    "eyebrow": "FULL STACK · ENGINEERING NOTES",
    "slogan": "一句话定位。",
    "intro": "简短介绍。",
    "tags": ["后端", "前端", "数据库"],
    "email": "you@example.com",
    "github": "https://github.com/your-name"
  },
  "integrations": {
    "postsApiBase": ""
  },
  "about": {
    "intro": "关于页介绍。",
    "education": [
      { "school": "示例大学", "period": "2020—2024", "detail": "计算机科学与技术 · 本科" }
    ],
    "internships": [
      { "company": "示例公司", "period": "2024—至今", "role": "软件工程师", "bullets": ["完成 X。", "优化 Y。"] }
    ],
    "capabilities": [
      { "title": "后端", "description": "API、数据库、缓存。" }
    ],
    "contactNote": "想交流可以发邮件。"
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `profile.name` / `slogan` / `intro` / `email` | 必填非空字符串；邮箱需符合邮箱格式 |
| `profile.initial` | 可选显示首字；留空时取 `name` 的第一个字符 |
| `profile.avatar` | `""` 或固定为 `media/profile/avatar.webp`；发布前文件必须存在 |
| `profile.tags` | 非空字符串数组 |
| `profile.github` | `https://` 链接 |
| `integrations.postsApiBase` | `""`（关闭文章）或 `https://` 接口地址 |
| `about.education[]` | `school`、`period` 必填；`detail` 可选 |
| `about.internships[]` | `company`、`period`、`role`、`bullets[]` |
| `about.capabilities[]` | `title`、`description` |

## `content/projects.json`

```json
{
  "version": 1,
  "projects": [
    {
      "slug": "sample-project",
      "status": "published",
      "order": 1,
      "category": "项目",
      "title": "项目标题",
      "tagline": "一句话定位",
      "role": "你的角色",
      "summary": "卡片摘要",
      "stack": ["Node.js", "SQLite"],
      "proof": [{ "value": "3", "label": "模块" }],
      "overview": "项目概览",
      "sections": [{ "title": "问题", "body": "..." }],
      "evidence": { "deployment": "部署证据" },
      "sourceUrl": "",
      "coverMediaId": null,
      "media": []
    }
  ]
}
```

| 字段 | 规则 |
| --- | --- |
| `slug` | 小写字母、数字与 `-`；唯一；首次发布后锁定 |
| `status` | `published`（展示）、`draft`（不展示）、`archived`（不展示但保留） |
| `order` | 整数；越小越靠前 |
| `category` / `title` / `tagline` / `role` / `summary` / `overview` | 必填非空字符串 |
| `stack` | 非空字符串数组 |
| `proof[]` | `value` 与 `label` 字符串 |
| `sections[]` | `title` 与 `body` 字符串 |
| `evidence` | 字符串键值对象；`deployment` / `modelEvaluation` / `offlineVerification` 会显示中文标签 |
| `sourceUrl` | `""` 或 `https://` 链接 |
| `coverMediaId` | `null` 或 `media` 中某一项的 `id` |
| `media[]` | 见下 |

### 媒体项

```json
{
  "id": "media-id",
  "type": "image",
  "src": "media/projects/sample-project/file.webp",
  "poster": null,
  "alt": "画面内容说明",
  "caption": "显示在胶片条下方的说明",
  "tag": "功能标签"
}
```

| 字段 | 规则 |
| --- | --- |
| `id` | 小写字母、数字与 `-`；同一项目内唯一 |
| `type` | `image` 或 `video` |
| `src` | 必须以 `media/projects/<项目 slug>/` 开头；图片为 `.webp`，视频为 `.mp4` |
| `poster` | 图片为 `null`；视频必填同目录的 `.webp` 封面 |
| `alt` | 发布必填（草稿可空，但会有提醒） |
| `caption` | 可选字符串 |
| `tag` | 可选胶片条标签 |

## 媒体与发布规则

- 图片文件 ≤ 2 MiB；视频文件 ≤ 18 MiB；全部发布媒体 ≤ 80 MiB。
- 图片保存为 WebP（最长边 ≤ 1920px）；视频保存为 H.264/AAC MP4（≤ 1080p、≤ 12 秒）并生成 WebP 封面。
- 发布校验会拒绝手机号、类似学号的字符串、`.docx` / `.pdf` 链接与不安全协议。
- 工作台只暂存 `content/**` 与 `media/**`；无关修改请留在暂存区之外。
