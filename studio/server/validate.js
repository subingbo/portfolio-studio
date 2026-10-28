'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MEDIA_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/
const STATUSES = ['published', 'draft', 'archived']
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

function requireString(issues, value, pathLabel, { allowEmpty = false } = {}) {
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

function validateSite(site, { issues, mode, config }) {
  if (!site || typeof site !== 'object' || Array.isArray(site)) {
    addIssue(issues, 'error', 'schema', 'site', 'site.json 必须是对象')
    return
  }
  const profile = site.profile
  if (!profile || typeof profile !== 'object') {
    addIssue(issues, 'error', 'schema', 'site.profile', '缺少 profile')
  } else {
    requireString(issues, profile.name, 'site.profile.name')
    optionalString(issues, profile.initial, 'site.profile.initial')
    requireString(issues, profile.eyebrow, 'site.profile.eyebrow')
    requireString(issues, profile.slogan, 'site.profile.slogan')
    requireString(issues, profile.intro, 'site.profile.intro')
    if (!Array.isArray(profile.tags) || profile.tags.length === 0) {
      addIssue(issues, 'error', 'schema', 'site.profile.tags', '需要至少一个技术标签')
    } else {
      profile.tags.forEach((tag, index) => requireString(issues, tag, 'site.profile.tags[' + index + ']'))
    }
    if (!requireString(issues, profile.email, 'site.profile.email')) {
      // 已记录错误
    } else if (!EMAIL_PATTERN.test(profile.email)) {
      addIssue(issues, 'error', 'invalid-email', 'site.profile.email', '邮箱格式不正确')
    }
    if (!requireString(issues, profile.github, 'site.profile.github')) {
      // 已记录错误
    } else if (!HTTPS_PATTERN.test(profile.github)) {
      addIssue(issues, 'error', 'invalid-url', 'site.profile.github', '链接必须是 https')
    }
    if (profile.avatar !== undefined && profile.avatar !== null) {
      if (typeof profile.avatar !== 'string') {
        addIssue(issues, 'error', 'schema', 'site.profile.avatar', '头像需要字符串路径')
      } else if (profile.avatar && profile.avatar !== 'media/profile/avatar.webp') {
        addIssue(issues, 'error', 'invalid-avatar', 'site.profile.avatar', '头像路径必须是 media/profile/avatar.webp')
      } else if (profile.avatar) {
        const avatarFile = path.join(config.paths.siteMedia, 'profile', 'avatar.webp')
        if (!fs.existsSync(avatarFile)) {
          addIssue(issues, mode === 'publish' ? 'error' : 'warning', 'avatar-missing', 'site.profile.avatar', '头像文件不存在，请重新上传')
        } else if (fs.statSync(avatarFile).size > config.limits.imageMaxBytes) {
          addIssue(issues, mode === 'publish' ? 'error' : 'warning', 'avatar-too-large', 'site.profile.avatar', '头像文件超过 2 MiB')
        }
      }
    }
  }
  const about = site.about
  if (!about || typeof about !== 'object') {
    addIssue(issues, 'error', 'schema', 'site.about', '缺少 about')
  } else {
    optionalString(issues, about.intro, 'site.about.intro')
    optionalString(issues, about.contactNote, 'site.about.contactNote')
    if (!Array.isArray(about.education)) {
      addIssue(issues, 'error', 'schema', 'site.about.education', '需要数组')
    } else {
      about.education.forEach((entry, index) => {
        requireString(issues, entry.school, 'site.about.education[' + index + '].school')
        requireString(issues, entry.period, 'site.about.education[' + index + '].period')
        optionalString(issues, entry.detail, 'site.about.education[' + index + '].detail')
      })
    }
    if (!Array.isArray(about.internships)) {
      addIssue(issues, 'error', 'schema', 'site.about.internships', '需要数组')
    } else {
      about.internships.forEach((entry, index) => {
        requireString(issues, entry.company, 'site.about.internships[' + index + '].company')
        requireString(issues, entry.period, 'site.about.internships[' + index + '].period')
        requireString(issues, entry.role, 'site.about.internships[' + index + '].role')
        if (!Array.isArray(entry.bullets)) {
          addIssue(issues, 'error', 'schema', 'site.about.internships[' + index + '].bullets', '需要数组')
        } else {
          entry.bullets.forEach((bullet, bulletIndex) => {
            requireString(issues, bullet, 'site.about.internships[' + index + '].bullets[' + bulletIndex + ']')
          })
        }
      })
    }
    if (!Array.isArray(about.capabilities)) {
      addIssue(issues, 'error', 'schema', 'site.about.capabilities', '需要数组')
    } else {
      about.capabilities.forEach((entry, index) => {
        requireString(issues, entry.title, 'site.about.capabilities[' + index + '].title')
        requireString(issues, entry.description, 'site.about.capabilities[' + index + '].description')
      })
    }
  }
  walkStrings(site, 'site', (value, pathLabel) => scanPrivacy(issues, value, pathLabel, mode))
}

function validateProjectsFile(data, { issues, mode, config }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    addIssue(issues, 'error', 'schema', 'projects', 'projects.json 必须是对象')
    return
  }
  if (!Array.isArray(data.projects)) {
    addIssue(issues, 'error', 'schema', 'projects.projects', '需要 projects 数组')
    return
  }
  const slugs = new Set()
  const orders = new Set()
  let publishedCount = 0

  data.projects.forEach((project, index) => {
    const base = 'projects.projects[' + index + ']'
    if (!project || typeof project !== 'object') {
      addIssue(issues, 'error', 'schema', base, '项目必须是对象')
      return
    }
    if (!SLUG_PATTERN.test(project.slug || '')) {
      addIssue(issues, 'error', 'invalid-slug', base + '.slug', 'slug 只能包含小写字母、数字和连字符')
    } else if (slugs.has(project.slug)) {
      addIssue(issues, 'error', 'duplicate-slug', base + '.slug', 'slug 重复：' + project.slug)
    } else {
      slugs.add(project.slug)
    }
    if (!STATUSES.includes(project.status)) {
      addIssue(issues, 'error', 'invalid-status', base + '.status', 'status 必须是 published、draft 或 archived')
    }
    if (!Number.isInteger(project.order)) {
      addIssue(issues, 'error', 'invalid-order', base + '.order', 'order 必须是整数')
    } else if (orders.has(project.order)) {
      addIssue(issues, 'warning', 'duplicate-order', base + '.order', 'order 与其他项目重复，排序可能不稳定')
    } else {
      orders.add(project.order)
    }
    for (const field of ['category', 'title', 'tagline', 'role', 'summary', 'overview']) {
      requireString(issues, project[field], base + '.' + field)
    }
    if (!Array.isArray(project.stack) || project.stack.length === 0) {
      addIssue(issues, 'error', 'schema', base + '.stack', '需要至少一项技术栈')
    } else {
      project.stack.forEach((entry, stackIndex) => requireString(issues, entry, base + '.stack[' + stackIndex + ']'))
    }
    if (!Array.isArray(project.proof)) {
      addIssue(issues, 'error', 'schema', base + '.proof', '需要数组')
    } else {
      project.proof.forEach((entry, proofIndex) => {
        requireString(issues, entry.value, base + '.proof[' + proofIndex + '].value')
        requireString(issues, entry.label, base + '.proof[' + proofIndex + '].label')
      })
    }
    if (!Array.isArray(project.sections)) {
      addIssue(issues, 'error', 'schema', base + '.sections', '需要数组')
    } else {
      project.sections.forEach((entry, sectionIndex) => {
        requireString(issues, entry.title, base + '.sections[' + sectionIndex + '].title')
        requireString(issues, entry.body, base + '.sections[' + sectionIndex + '].body')
      })
    }
    if (!project.evidence || typeof project.evidence !== 'object' || Array.isArray(project.evidence)) {
      addIssue(issues, 'error', 'schema', base + '.evidence', '需要对象')
    } else {
      Object.keys(project.evidence).forEach((key) => {
        optionalString(issues, project.evidence[key], base + '.evidence.' + key)
        if (!/^[A-Za-z0-9_-]+$/.test(key)) {
          addIssue(issues, 'warning', 'evidence-key', base + '.evidence.' + key, '建议使用英文键名')
        }
      })
    }
    if (project.sourceUrl !== '' && !HTTPS_PATTERN.test(project.sourceUrl || '')) {
      addIssue(issues, 'error', 'invalid-url', base + '.sourceUrl', '源码链接必须为空或 https')
    }
    if (project.status === 'published') publishedCount += 1

    const mediaIds = new Set()
    const mediaList = Array.isArray(project.media) ? project.media : null
    if (!mediaList) {
      addIssue(issues, 'error', 'schema', base + '.media', '需要 media 数组')
    } else {
      mediaList.forEach((item, mediaIndex) => {
        validateMediaItem({
          issues,
          mode,
          config,
          slug: project.slug,
          base: base + '.media[' + mediaIndex + ']',
          item,
          mediaIds,
        })
      })
    }
    if (project.coverMediaId !== null && project.coverMediaId !== undefined) {
      if (typeof project.coverMediaId !== 'string') {
        addIssue(issues, 'error', 'schema', base + '.coverMediaId', '封面需要媒体 id 或 null')
      } else if (!mediaIds.has(project.coverMediaId)) {
        addIssue(issues, 'error', 'missing-cover', base + '.coverMediaId', '封面引用的媒体不存在')
      }
    }
  })

  if (publishedCount === 0) {
    addIssue(issues, 'warning', 'no-published', 'projects.projects', '没有 published 状态的项目，作品页会显示为空')
  }

  walkStrings(data, 'projects', (value, pathLabel) => scanPrivacy(issues, value, pathLabel, mode))

  if (mode === 'publish') {
    const totalBytes = mediaDirectorySize(config.paths.siteMedia)
    if (totalBytes > config.limits.mediaTotalMaxBytes) {
      addIssue(
        issues,
        'error',
        'media-total',
        'media',
        '媒体总量 ' + (totalBytes / 1024 / 1024).toFixed(1) + ' MiB 超过 ' + (config.limits.mediaTotalMaxBytes / 1024 / 1024) + ' MiB 限制'
      )
    }
  }
}

function validateMediaItem({ issues, mode, config, slug, base, item, mediaIds }) {
  if (!item || typeof item !== 'object') {
    addIssue(issues, 'error', 'schema', base, '媒体必须是对象')
    return
  }
  if (!MEDIA_ID_PATTERN.test(item.id || '')) {
    addIssue(issues, 'error', 'invalid-media-id', base + '.id', '媒体 id 只能包含小写字母、数字和连字符')
  } else if (mediaIds.has(item.id)) {
    addIssue(issues, 'error', 'duplicate-media-id', base + '.id', '同一项目内媒体 id 重复')
  } else {
    mediaIds.add(item.id)
  }
  if (!['image', 'video'].includes(item.type)) {
    addIssue(issues, 'error', 'invalid-media-type', base + '.type', '媒体类型必须是 image 或 video')
  }
  const prefix = 'media/projects/' + slug + '/'
  const expectedExtension = item.type === 'video' ? '.mp4' : '.webp'
  if (typeof item.src !== 'string' || !item.src.startsWith(prefix)) {
    addIssue(issues, 'error', 'media-path', base + '.src', '媒体必须位于 ' + prefix)
  } else {
    const fileName = item.src.slice(prefix.length)
    if (!SAFE_FILE_NAME.test(fileName)) {
      addIssue(issues, 'error', 'media-path', base + '.src', '媒体文件名不合法')
    } else if (!fileName.endsWith(expectedExtension)) {
      addIssue(issues, 'error', 'media-format', base + '.src', '媒体文件应为 ' + expectedExtension)
    } else {
      checkMediaFile({ issues, mode, config, slug, fileName, base: base + '.src', limit: item.type === 'video' ? config.limits.videoMaxBytes : config.limits.imageMaxBytes, label: '媒体' })
    }
  }
  if (typeof item.alt !== 'string' || !item.alt.trim()) {
    addIssue(issues, mode === 'publish' ? 'error' : 'warning', 'missing-alt', base + '.alt', '缺少无障碍替代文本')
  }
  optionalString(issues, item.caption, base + '.caption')
  optionalString(issues, item.tag, base + '.tag')
  if (item.type === 'video') {
    if (typeof item.poster !== 'string' || !item.poster.startsWith(prefix)) {
      addIssue(issues, 'error', 'media-poster', base + '.poster', '视频需要位于 ' + prefix + ' 的 WebP 封面')
    } else {
      const posterName = item.poster.slice(prefix.length)
      if (!SAFE_FILE_NAME.test(posterName) || !posterName.endsWith('.webp')) {
        addIssue(issues, 'error', 'media-poster', base + '.poster', '视频封面必须是同目录的 WebP 文件')
      } else {
        checkMediaFile({ issues, mode, config, slug, fileName: posterName, base: base + '.poster', limit: config.limits.imageMaxBytes, label: '视频封面' })
      }
    }
  } else if (item.poster !== null && item.poster !== undefined && item.poster !== '') {
    addIssue(issues, 'error', 'media-poster', base + '.poster', '图片媒体不需要 poster')
  }
}

function checkMediaFile({ issues, mode, config, slug, fileName, base, limit, label }) {
  const absolute = path.join(config.paths.siteMedia, 'projects', slug, fileName)
  if (!fs.existsSync(absolute)) {
    addIssue(issues, mode === 'publish' ? 'error' : 'warning', 'media-missing', base, label + '文件不存在：' + fileName)
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

function mediaDirectorySize(mediaRoot) {
  if (!fs.existsSync(mediaRoot)) return 0
  let total = 0
  const stack = [mediaRoot]
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

function validateContent({ site, projects, config, mode = 'save' }) {
  const issues = createIssues()
  validateSite(site, { issues, mode, config })
  validateProjectsFile(projects, { issues, mode, config })
  return {
    ok: issues.errors.length === 0,
    errors: issues.errors,
    warnings: issues.warnings,
  }
}

module.exports = {
  validateContent,
  PRIVACY_RULES,
  SLUG_PATTERN,
  MEDIA_ID_PATTERN,
}
