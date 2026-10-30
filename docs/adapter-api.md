# 适配器接口（v1）

工作台核心是通用的：内容文档、媒体集合、头像、发布范围与编辑界面都由**适配器**声明。内置两个适配器：

- `portfolio`（默认）：本仓库的完整作品集模板（`site.json` + `projects.json` + 项目媒体 + 头像）。
- `landing`：最小示例（单文档 + 扁平图片集合 + 自定义颜色字段/图片编辑器）。

## 加载方式

适配器放在 `studio/adapters/<id>/index.js`，并在 `studio/server/adapters/loader.js` 的 `switch` 中登记（字面量 `require`，避免动态加载）。通过 `studio/config.json` 选择：

```json
{ "adapter": "portfolio" }
```

也可以设置环境变量 `STUDIO_ADAPTER`。适配器是**本地受信任代码**，拥有与服务端相同的权限；不要从不可信来源加载。

## BaseAdapter

```js
const { BaseAdapter } = require('../../server/adapters/base')

module.exports = new (class extends BaseAdapter {
  get id() { return 'my-site' }
  get name() { return 'My site adapter' }
  get version() { return '1.0.0' }
  get documents() { return [] }
  get mediaCollections() { return [] }
  get avatar() { return null }
  get publish() { return { stagePaths: ['content'], commitPrefix: 'content:', lockFrom: [], deployTargets: [] } }
  get manifest() { return { views: [] } }
  get webModule() { return null }
  validate({ documents, mode, config }) { return { errors: [], warnings: [] } }
})()
```

`apiVersion` 固定为 `1`。加载器会校验所有必需成员、路径是否越界、文档/媒体引用是否一致；不合规会直接报错。

## documents（内容文档）

| 字段 | 说明 |
| --- | --- |
| `id` | URL 中的文档 id（`/api/content/<id>`），小写字母/数字/连字符 |
| `file` | 相对站点根的文件路径，例如 `content/site.json` |
| `kind` | `object`（单对象）或 `collection`（`itemsKey` 下的数组） |
| `label` | 界面显示名 |
| `itemsKey` | 集合文档的数组字段，例如 `projects` |
| `identityField` | 集合条目的唯一标识字段，例如 `slug`（发布后可锁定） |
| `orderField` / `statusField` / `statuses` | 排序字段、状态字段与状态枚举 |
| `identityPattern` | 可选，标识字段的正则；默认 `^[a-z0-9][a-z0-9-]*$` |

## mediaCollections（媒体集合）

两种模式：

```js
// 每个条目一个目录：media/projects/<slug>/
{
  id: 'projects',
  label: '项目画面',
  mode: 'collection',
  document: 'projects',
  itemsKey: 'projects',
  mediaField: 'media',
  dirKey: 'slug',
  root: 'media/projects',
  cover: { field: 'coverMediaId' },
  itemDefaults: { alt: '', caption: '', tag: '' },
  formats: { image: ['.webp'], video: ['.mp4'] },
  limits: { imageMaxBytes: 2 * 1024 * 1024, totalMaxBytes: 80 * 1024 * 1024 }
}

// 扁平目录 + 文档中的一个媒体数组：media/images/<file>
{
  id: 'images',
  label: '页面图片',
  mode: 'path',
  document: 'landing',
  path: ['images'],
  root: 'media/images',
  itemDefaults: { alt: '', caption: '' },
  formats: { image: ['.webp'] }
}
```

媒体项固定使用 `{ id, type, src, poster, ...itemDefaults }`，其中 `src` 必须位于 `root/` 下，图片为 `.webp`、视频为 `.mp4` + 同目录 `.webp` 封面。上传、转换、素材库、清理、文件体积检查都由核心按这些描述执行。

## avatar（头像，可选）

```js
{
  document: 'site',
  pointer: ['profile', 'avatar'],
  file: 'media/profile/avatar.webp',
  size: 512,
  maxBytes: 1024 * 1024
}
```

声明后工作台显示头像卡片并开放 `/api/avatar`；未声明（`null`）时接口返回 404。

## publish（发布）

```js
{
  stagePaths: ['content', 'media'],   // 只暂存这些路径
  commitPrefix: 'content:',
  lockFrom: [{ document: 'projects', via: 'collection', itemsKey: 'projects', field: 'slug' }],
  deployTargets: [{ document: 'site', urlPath: '/content/site.json' }],
  stepLabels: { stage: '暂存 content 与 media' } // 可选
}
```

- 推送成功后 `lockFrom` 提取的标识会写入 `.studio/state.json`，之后禁止改名/删除。
- `deployTargets` 用于部署确认：比较正式域名上的 JSON 与本地文档；目标为空或未启用 `deployCheck` 时跳过。

## manifest（界面清单）

```js
{
  views: [
    { id: 'home', label: '首页资料', type: 'document', document: 'site', preview: 'index.html', form: { sections: [...] } },
    { id: 'projects', label: '作品', type: 'collection', document: 'projects', preview: 'projects.html',
      itemPreview: 'project.html?id={id}', list: {...}, item: { identityField: 'slug', defaults: {...}, form: {...} },
      media: { collection: 'projects', coverField: 'coverMediaId', fields: [...] } },
    { id: 'media', label: '素材库', type: 'media' },
    { id: 'publish', label: '发布', type: 'publish' }
  ],
  help: { intro: '...', sections: [{ title: '...', items: ['...'] }], tip: '...' }
}
```

视图类型：`document` / `collection` / `media` / `publish` / `custom`。字段路径是数组（相对文档或集合条目）：

| type | 说明 |
| --- | --- |
| `text` / `textarea` / `number` / `boolean` | 基础输入 |
| `email` / `url` / `slug` | 带类型提示的文本 |
| `select` | `options: [{ value, label }]` |
| `stringList` | 每行一个字符串 |
| `objectList` | 对象数组，`fields` 定义子字段 |
| `keyValue` | 字符串键值对象 |
| `custom` | 引用适配器注册的字段组件（`component`） |

## 自定义前端组件

适配器声明 `webModule: 'web.js'`，核心从 `/adapter-web/web.js` 提供该文件。模块里注册组件：

```js
Studio.registerFieldComponent('color', function ({ field, value, onChange }) {
  const input = document.createElement('input')
  input.type = 'color'
  input.value = value || '#f97316'
  input.addEventListener('input', () => onChange(input.value))
  return input
})

Studio.registerViewComponent('gallery-editor', function (view, root) {
  // 使用 Studio 暴露的 h / api / getDocument / uploadMedia / saveDocument / renderView 等
})
```

字段清单里写 `{ type: 'custom', component: 'color' }`，视图清单里写 `{ type: 'custom', component: 'gallery-editor' }`。组件未注册时会显示只读提示，不影响其他视图。

## 最小示例

`examples/landing-site` 是一个可直接运行的站点，适配器在 `studio/adapters/landing/`。查看内容与测试可以快速理解契约。

## 版本与测试

- 契约版本：`apiVersion = 1`；破坏性变更时递增，加载器会拒绝旧版本。
- 新增适配器后建议补充端到端测试：启动工作台 → 读取 manifest → 写内容 → 上传媒体 → 发布（可用本地 bare 仓库）。
