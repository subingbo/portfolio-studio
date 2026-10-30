'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { resolveInside } = require('./config')
const { getByPath } = require('./adapters/base')
const { mediaEntries, limitsFor } = require('./media-model')

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MEDIA_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HTTPS_PATTERN = /^https:\/\/[^\s]+$/i

const PRIVACY_RULES = [
  { code: 'phone', pattern: /1[3-9]\d{9}/, message: '疑似手机号' },
  { code: 'student-id-label', pattern: /学号/, message: '出现“学号”字样' },
  { code: 'student-id-number', pattern: /\b20\d{9}\b/, message: '疑似学号' },
  { code: 'resume-docx', pattern: /\.docx\b/i, message: '不要链接简历文件（.docx）' },
  { code: 'resume-pdf', pattern: /\.pdf\b/i, message: '不要链接简历文件（.pdf）' },
  { code: 'js-protocol', pattern: /javascript:/i, message: '不允许 javascript: 协议' },
  { code: 'data-protocol', pattern: /data:text\//i, message: '不允许 data: 文本协议' },
]

function createIssues() {
  return { errors: [], warnings: [] }
}

function addIssue(issues, level, code, pathLabel, message) {
  issues[level === 'warning' ? 'warnings' : 'errors'].push({ level, code, path: pathLabel, message })
}

function requireString(issues, value, pathLabel, options = {}) {
  const allowEmpty = options && options.allowEmpty
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    addIssue(issues, 'error', 'schema', pathLabel, '需要非空字符串')
    return false
  }
  return true
}

function optionalString(issues, value, pathLabel) {
  if (value === undefined || value === null) return
  if (typeof value !== 'string') {
    addIssue(issues, 'error', 'schema', pathLabel, '需要字符串')
  }
}

function scanPrivacy(issues, value, pathLabel, mode) {
  if (typeof value !== 'string' || !value) return
  const level = mode === 'publish' ? 'error' : 'warning'
  for (const rule of PRIVACY_RULES) {
    if (rule.pattern.test(value)) {
      addIssue(issues, level, 'privacy-' + rule.code, pathLabel, rule.message)
    }
  }
}

function walkStrings(value, pathLabel, visit) {
  if (typeof value === 'string') {
    visit(value, pathLabel)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, pathLabel + '[' + index + ']', visit))
    return
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => walkStrings(value[key], pathLabel + '.' + key, visit))
  }
}

function scanDocumentPrivacy(issues, data, label, mode) {
  walkStrings(data, label, (value, pathLabel) => scanPrivacy(issues, value, pathLabel, mode))
}

function directorySize(root) {
  if (!fs.existsSync(root)) return 0
  let total = 0
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (error) {
      continue
    }
    for (const entry of entries) {
      if (!SAFE_FILE_NAME.test(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolute)
      } else if (entry.isFile()) {
        total += fs.statSync(absolute).size
      }
    }
  }
  return total
}

function validateMediaFiles({ adapter, documents, config, mode, issues }) {
  for (const collection of adapter.mediaCollections) {
    const limits = limitsFor(collection, config)
    const entries = mediaEntries(collection, documents)
    entries.forEach((entry, index) => {
      if (!entry.media || typeof entry.media !== 'object') return
      const base = collection.id + '[' + index + ']'
      const itemDir = collection.mode === 'collection' && collection.dirKey && entry.itemKey
        ? collection.root + '/' + entry.itemKey
        : collection.root
      const isVideo = entry.media.type === 'video'
      checkReferencedFile({
        issues,
        mode,
        config,
        relative: entry.media.src,
        itemDir,
        base: base + '.src',
        limit: isVideo ? limits.videoMaxBytes : limits.imageMaxBytes,
        label: '媒体',
      })
      if (isVideo && entry.media.poster) {
        checkReferencedFile({
          issues,
          mode,
          config,
          relative: entry.media.poster,
          itemDir,
          base: base + '.poster',
          limit: limits.imageMaxBytes,
          label: '视频封面',
        })
      }
    })
    const root = resolveInside(config.sitePath, collection.root)
    const total = directorySize(root)
    if (mode === 'publish' && limits.totalMaxBytes && total > limits.totalMaxBytes) {
      addIssue(
        issues,
        'error',
        'media-total',
        collection.id,
        '媒体总量 ' + (total / 1024 / 1024).toFixed(1) + ' MiB 超过 ' + (limits.totalMaxBytes / 1024 / 1024) + ' MiB 限制'
      )
    }
  }
}

function checkReferencedFile({ issues, mode, config, relative, itemDir, base, limit, label }) {
  if (typeof relative !== 'string' || !relative) return
  let absolute
  try {
    absolute = resolveInside(config.sitePath, relative)
  } catch (error) {
    addIssue(issues, 'error', 'media-path', base, '媒体路径越界：' + relative)
    return
  }
  if (itemDir && !relative.startsWith(itemDir + '/')) {
    addIssue(issues, 'error', 'media-path', base, label + '必须位于 ' + itemDir + '/')
    return
  }
  if (!fs.existsSync(absolute)) {
    addIssue(issues, mode === 'publish' ? 'error' : 'warning', 'media-missing', base, label + '文件不存在：' + path.basename(relative))
    return
  }
  const size = fs.statSync(absolute).size
  if (size > limit) {
    addIssue(
      issues,
      mode === 'publish' ? 'error' : 'warning',
      'media-too-large',
      base,
      label + '超过 ' + (limit / 1024 / 1024) + ' MiB：' + (size / 1024 / 1024).toFixed(2) + ' MiB'
    )
  }
}

function validateAvatarFile({ adapter, documents, config, mode, issues }) {
  const avatar = adapter.avatar
  if (!avatar) return
  const document = documents[avatar.document]
  const value = getByPath(document, avatar.pointer)
  if (typeof value !== 'string' || !value) return
  const base = avatar.document + '.' + avatar.pointer.join('.')
  let absolute
  try {
    absolute = resolveInside(config.sitePath, avatar.file)
  } catch (error) {
    addIssue(issues, 'error', 'avatar-path', base, '头像路径越界')
    return
  }
  if (!fs.existsSync(absolute)) {
    addIssue(issues, mode === 'publish' ? 'error' : 'warning', 'avatar-missing', base, '头像文件不存在，请重新上传')
    return
  }
  if (fs.statSync(absolute).size > avatar.maxBytes) {
    addIssue(
      issues,
      mode === 'publish' ? 'error' : 'warning',
      'avatar-too-large',
      base,
      '头像文件超过 ' + (avatar.maxBytes / 1024 / 1024).toFixed(0) + ' MiB'
    )
  }
}

function validateDocuments({ adapter, documents, config, mode = 'save' }) {
  const issues = createIssues()
  const result = adapter.validate({ documents, mode, config })
  for (const issue of (result && result.errors) || []) issues.errors.push(issue)
  for (const issue of (result && result.warnings) || []) issues.warnings.push(issue)
  validateMediaFiles({ adapter, documents, config, mode, issues })
  validateAvatarFile({ adapter, documents, config, mode, issues })
  return {
    ok: issues.errors.length === 0,
    errors: issues.errors,
    warnings: issues.warnings,
  }
}

module.exports = {
  validateDocuments,
  createIssues,
  addIssue,
  requireString,
  optionalString,
  scanPrivacy,
  walkStrings,
  scanDocumentPrivacy,
  directorySize,
  PRIVACY_RULES,
  SLUG_PATTERN,
  MEDIA_ID_PATTERN,
  SAFE_FILE_NAME,
  EMAIL_PATTERN,
  HTTPS_PATTERN,
}
