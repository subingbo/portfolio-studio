'use strict'

const { BaseAdapter } = require('../../server/adapters/base')
const {
  createIssues,
  addIssue,
  requireString,
  optionalString,
  scanPrivacy,
  walkStrings,
  MEDIA_ID_PATTERN,
  SAFE_FILE_NAME,
} = require('../../server/validate')

const MIB = 1024 * 1024

function validateMediaItem({ issues, mode, item, ids, index }) {
  const base = 'landing.images[' + index + ']'
  if (!item || typeof item !== 'object') {
    addIssue(issues, 'error', 'schema', base, '图片必须是对象')
    return
  }
  if (!MEDIA_ID_PATTERN.test(item.id || '')) {
    addIssue(issues, 'error', 'invalid-media-id', base + '.id', '图片 id 不合法')
  } else if (ids.has(item.id)) {
    addIssue(issues, 'error', 'duplicate-media-id', base + '.id', '图片 id 重复')
  } else {
    ids.add(item.id)
  }
  if (item.type !== 'image') {
    addIssue(issues, 'error', 'invalid-media-type', base + '.type', '示例适配器只支持图片')
  }
  const prefix = 'media/images/'
  if (typeof item.src !== 'string' || !item.src.startsWith(prefix)) {
    addIssue(issues, 'error', 'media-path', base + '.src', '图片必须位于 ' + prefix)
  } else {
    const fileName = item.src.slice(prefix.length)
    if (!SAFE_FILE_NAME.test(fileName) || !fileName.endsWith('.webp')) {
      addIssue(issues, 'error', 'media-path', base + '.src', '图片文件名必须是 WebP')
    }
  }
  if (typeof item.alt !== 'string' || !item.alt.trim()) {
    addIssue(issues, mode === 'publish' ? 'error' : 'warning', 'missing-alt', base + '.alt', '缺少替代文本')
  }
  optionalString(issues, item.caption, base + '.caption')
}

function validateLanding({ documents, mode }) {
  const issues = createIssues()
  const data = documents.landing
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    addIssue(issues, 'error', 'schema', 'landing', 'landing.json 必须是对象')
    return { errors: issues.errors, warnings: issues.warnings }
  }
  requireString(issues, data.title, 'landing.title')
  optionalString(issues, data.subtitle, 'landing.subtitle')
  optionalString(issues, data.intro, 'landing.intro')
  optionalString(issues, data.accent, 'landing.accent')
  if (data.accent && !/^#[0-9a-f]{6}$/i.test(data.accent)) {
    addIssue(issues, 'error', 'invalid-color', 'landing.accent', '强调色必须是 #RRGGBB')
  }
  if (!Array.isArray(data.sections)) {
    addIssue(issues, 'error', 'schema', 'landing.sections', '需要数组')
  } else {
    data.sections.forEach((section, index) => {
      requireString(issues, section.heading, 'landing.sections[' + index + '].heading')
      requireString(issues, section.body, 'landing.sections[' + index + '].body')
    })
  }
  if (!Array.isArray(data.images)) {
    addIssue(issues, 'error', 'schema', 'landing.images', '需要数组')
  } else {
    const ids = new Set()
    data.images.forEach((item, index) => validateMediaItem({ issues, mode, item, ids, index }))
  }
  walkStrings(data, 'landing', (value, pathLabel) => scanPrivacy(issues, value, pathLabel, mode))
  return { errors: issues.errors, warnings: issues.warnings }
}

class LandingAdapter extends BaseAdapter {
  get id() {
    return 'landing'
  }

  get name() {
    return 'Landing page adapter'
  }

  get version() {
    return '1.0.0'
  }

  get documents() {
    return [{ id: 'landing', file: 'content/landing.json', kind: 'object', label: '落地页' }]
  }

  get mediaCollections() {
    return [
      {
        id: 'images',
        label: '页面图片',
        mode: 'path',
        document: 'landing',
        path: ['images'],
        root: 'media/images',
        itemDefaults: { alt: '', caption: '' },
        formats: { image: ['.webp'] },
        limits: {
          imageMaxBytes: 2 * MIB,
          imageMaxSide: 1600,
          totalMaxBytes: 40 * MIB,
        },
      },
    ]
  }

  get avatar() {
    return null
  }

  get publish() {
    return {
      stagePaths: ['content', 'media'],
      commitPrefix: 'content:',
      lockFrom: [],
      deployTargets: [{ document: 'landing', urlPath: '/content/landing.json' }],
      stepLabels: { stage: '暂存 content 与 media' },
    }
  }

  get webModule() {
    return 'web.js'
  }

  get manifest() {
    return {
      views: [
        {
          id: 'landing',
          label: '落地页',
          type: 'document',
          document: 'landing',
          preview: 'index.html',
          description: '编辑 content/landing.json：标题、介绍、强调色与段落。',
          form: {
            sections: [
              {
                title: '基本信息',
                fields: [
                  { path: ['title'], label: '标题', type: 'text', required: true },
                  { path: ['subtitle'], label: '副标题', type: 'text' },
                  { path: ['accent'], label: '强调色', type: 'custom', component: 'color' },
                  { path: ['intro'], label: '介绍', type: 'textarea', rows: 4 },
                ],
              },
              {
                title: '段落',
                fields: [
                  {
                    path: ['sections'],
                    type: 'objectList',
                    itemLabel: '段落',
                    addLabel: '添加段落',
                    fields: [
                      { path: ['heading'], label: '标题', type: 'text' },
                      { path: ['body'], label: '正文', type: 'textarea', rows: 3 },
                    ],
                  },
                ],
              },
            ],
          },
        },
        { id: 'gallery', label: '页面图片', type: 'custom', component: 'gallery-editor' },
        { id: 'media', label: '素材库', type: 'media' },
        { id: 'publish', label: '发布', type: 'publish' },
      ],
      help: {
        intro: '这是一个最小适配器示例：单文档 + 扁平图片集合 + 一个自定义表单组件。',
        sections: [
          {
            title: '怎么用',
            items: [
              '在“落地页”编辑标题、副标题、强调色与段落。',
              '在“页面图片”上传图片并填写替代文本，保存后写入 landing.json 的 images 数组。',
              '“发布”与 portfolio 适配器一致：校验、测试、提交 content/ 与 media/、推送。',
            ],
          },
        ],
        tip: '保存草稿只改本地文件，发布才会上线。',
      },
    }
  }

  validate(context) {
    return validateLanding(context)
  }
}

module.exports = new LandingAdapter()
