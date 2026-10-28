'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { SAFE_FILE_NAME } = require('./util')
const { readHead, isGitLfsPointer, sniffBuffer } = require('./magic')
const { processImage } = require('./images')
const { processVideo, checkFfmpeg, ffmpegMissing } = require('./videos')
const { SLUG_PATTERN } = require('./validate')

const MEDIA_PATH_PATTERN = /^media\/projects\/([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9._-]+)$/

function mediaError(status, code, message) {
  return Object.assign(new Error(message), { code, status })
}

function buildReferenceMap(data) {
  const map = new Map()
  function add(relative, projectSlug, mediaId, field) {
    if (typeof relative !== 'string' || !relative) return
    if (!map.has(relative)) map.set(relative, [])
    map.get(relative).push({ project: projectSlug, mediaId, field })
  }
  for (const project of data.projects || []) {
    for (const item of project.media || []) {
      add(item.src, project.slug, item.id, 'src')
      add(item.poster, project.slug, item.id, 'poster')
    }
  }
  return map
}

async function moveFile(from, to) {
  try {
    await fsp.rename(from, to)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await fsp.copyFile(from, to)
    await fsp.unlink(from)
  }
}

function createMediaStore(config, contentStore) {
  const limits = config.limits
  const projectsRoot = path.join(config.paths.siteMedia, 'projects')

  function projectDirectory(slug) {
    if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
      throw mediaError(400, 'INVALID_SLUG', '项目 slug 不合法')
    }
    const boundary = path.resolve(projectsRoot)
    const target = path.resolve(boundary, slug)
    if (!target.startsWith(boundary + path.sep)) {
      throw mediaError(400, 'INVALID_SLUG', '项目 slug 越界')
    }
    return target
  }

  async function uniqueMediaId(kind) {
    const data = await contentStore.readProjects()
    const used = new Set()
    for (const project of data.projects || []) {
      for (const item of project.media || []) used.add(item.id)
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = (kind === 'image' ? 'img' : 'vid') + '-' +
        Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex')
      if (!used.has(candidate)) return candidate
    }
    throw mediaError(500, 'ID_COLLISION', '无法生成唯一媒体 id')
  }

  async function finalize({ slug, targetDir, mediaId, outputFile, posterFile, type, info }) {
    await fsp.mkdir(targetDir, { recursive: true })
    const outputName = path.basename(outputFile)
    if (!SAFE_FILE_NAME.test(outputName)) {
      throw mediaError(500, 'INTERNAL', '内部文件名不合法')
    }
    await moveFile(outputFile, path.join(targetDir, outputName))
    let poster = null
    if (posterFile) {
      const posterName = path.basename(posterFile)
      if (!SAFE_FILE_NAME.test(posterName)) {
        throw mediaError(500, 'INTERNAL', '内部文件封面名不合法')
      }
      await moveFile(posterFile, path.join(targetDir, posterName))
      poster = 'media/projects/' + slug + '/' + posterName
    }
    return {
      media: {
        id: mediaId,
        type,
        src: 'media/projects/' + slug + '/' + outputName,
        poster,
        alt: '',
        caption: '',
        tag: '',
      },
      meta: {
        size: info.size || info.bytes,
        width: info.width,
        height: info.height,
        duration: typeof info.duration === 'number' ? info.duration : null,
      },
    }
  }

  const uploadSessions = new Map()
  const SESSION_TTL_MS = 15 * 60 * 1000

  // 会话令牌只允许 32 位十六进制；临时目录与输入文件都从这里派生。
  function tempDirectory(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
      throw mediaError(400, 'INVALID_UPLOAD_TOKEN', '上传会话令牌不合法')
    }
    const boundary = path.resolve(config.paths.temp)
    const target = path.resolve(boundary, token)
    if (!target.startsWith(boundary + path.sep)) {
      throw mediaError(400, 'INVALID_UPLOAD_TOKEN', '上传会话令牌越界')
    }
    return target
  }

  function tempInputFile(token) {
    const directory = tempDirectory(token)
    return path.join(directory, 'input.bin')
  }

  // 项目目录只从 projects.json 的条目派生；路径解析后再做目录边界校验。
  function resolveProjectDirectory(slug) {
    return projectDirectory(slug)
  }

  function sweepSessions() {
    const now = Date.now()
    for (const [token, session] of uploadSessions) {
      if (now - session.createdAt <= SESSION_TTL_MS) continue
      uploadSessions.delete(token)
      fsp.rm(tempDirectory(token), { recursive: true, force: true }).catch(() => {})
    }
  }

  // 建立上传会话：绑定项目（来自 projects.json 的规范 slug）、上限与临时文件句柄。
  async function createUploadSession({ requestedSlug, kind, contentLength }) {
    if (kind !== 'image' && kind !== 'video') {
      throw mediaError(400, 'INVALID_KIND', 'kind 必须是 image 或 video')
    }
    const cap = kind === 'image' ? limits.uploadImageMaxBytes : limits.uploadVideoMaxBytes
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      throw mediaError(411, 'LENGTH_REQUIRED', '上传请求缺少 Content-Length')
    }
    if (contentLength > cap) {
      throw mediaError(413, 'UPLOAD_TOO_LARGE', '文件超过上传上限（' + Math.round(cap / 1024 / 1024) + ' MiB）')
    }
    const projects = await contentStore.readProjects()
    const projectIndex = (projects.projects || []).findIndex((item) => item.slug === requestedSlug)
    const project = projectIndex >= 0 ? projects.projects[projectIndex] : null
    if (!project) {
      throw mediaError(404, 'PROJECT_NOT_FOUND', '项目不存在，请先保存项目再上传媒体')
    }
    if (!SLUG_PATTERN.test(project.slug || '')) {
      throw mediaError(400, 'INVALID_SLUG', '项目 slug 不合法')
    }
    if (kind === 'video' && !(await checkFfmpeg())) {
      throw ffmpegMissing()
    }
    sweepSessions()
    const token = crypto.randomBytes(16).toString('hex')
    await fsp.mkdir(tempDirectory(token), { recursive: true })
    const handle = await fsp.open(tempInputFile(token), 'wx')
    uploadSessions.set(token, { kind, cap, projectIndex, createdAt: Date.now() })
    return { token, cap, handle }
  }

  async function abortUpload(token) {
    if (!/^[a-f0-9]{32}$/.test(String(token || ''))) return
    uploadSessions.delete(token)
    await fsp.rm(tempDirectory(token), { recursive: true, force: true }).catch(() => {})
  }

  // 转换函数只接收上传会话令牌；项目目录来自 projects.json 的条目。
  async function convertUpload({ token }) {
    const session = uploadSessions.get(token)
    if (!session) {
      throw mediaError(410, 'UPLOAD_EXPIRED', '上传会话不存在或已过期，请重试')
    }
    const tmpDir = tempDirectory(token)
    const inputFile = tempInputFile(token)
    try {
      const projects = await contentStore.readProjects()
      const list = Array.isArray(projects.projects) ? projects.projects : []
      const project = list[session.projectIndex]
      if (!project) {
        throw mediaError(400, 'PROJECT_NOT_FOUND', '项目不存在，请先保存项目再上传媒体')
      }
      const slug = project.slug
      const targetDir = resolveProjectDirectory(slug)
      const head = readHead(inputFile)
      if (isGitLfsPointer(head)) {
        throw mediaError(400, 'LFS_POINTER', '检测到 Git LFS 指针文件，请上传真实媒体文件')
      }
      const sniff = sniffBuffer(head)
      if (sniff.format === 'svg') {
        throw mediaError(415, 'SVG_REJECTED', '首版不接受 SVG，请使用 JPG、PNG 或 WebP')
      }
      if (sniff.format === 'gif') {
        throw mediaError(415, 'GIF_REJECTED', '首版不接受 GIF，请使用 JPG、PNG 或 WebP')
      }
      if (sniff.kind !== session.kind) {
        throw mediaError(415, 'MIME_MISMATCH', '文件内容与上传类型不符')
      }
      const mediaId = await uniqueMediaId(session.kind)
      if (session.kind === 'image') {
        const outputFile = path.join(tmpDir, mediaId + '.webp')
        const info = await processImage(inputFile, outputFile, limits)
        return await finalize({ slug, targetDir, mediaId, outputFile, posterFile: null, type: 'image', info })
      }
      const outputFile = path.join(tmpDir, mediaId + '.mp4')
      const posterFile = path.join(tmpDir, mediaId + '-poster.webp')
      const info = await processVideo(inputFile, outputFile, posterFile, limits)
      return await finalize({ slug, targetDir, mediaId, outputFile, posterFile, type: 'video', info })
    } finally {
      uploadSessions.delete(token)
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  async function list() {
    const data = await contentStore.readProjects()
    const references = buildReferenceMap(data)
    const files = []
    if (fs.existsSync(projectsRoot)) {
      for (const projectEntry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!projectEntry.isDirectory() || !SLUG_PATTERN.test(projectEntry.name)) continue
        const projectDir = path.join(projectsRoot, projectEntry.name)
        for (const fileEntry of fs.readdirSync(projectDir, { withFileTypes: true })) {
          if (!fileEntry.isFile() || !SAFE_FILE_NAME.test(fileEntry.name)) continue
          const absolute = path.join(projectDir, fileEntry.name)
          const stat = fs.statSync(absolute)
          const relative = 'media/projects/' + projectEntry.name + '/' + fileEntry.name
          const extension = path.extname(fileEntry.name).toLowerCase()
          files.push({
            path: relative,
            project: projectEntry.name,
            name: fileEntry.name,
            type: extension === '.mp4' ? 'video' : extension === '.webp' ? 'image' : 'other',
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            references: references.get(relative) || [],
          })
        }
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    return {
      files,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      totalLimit: limits.mediaTotalMaxBytes,
    }
  }

  async function removeReference(slug, mediaId) {
    const data = await contentStore.readProjects()
    const project = (data.projects || []).find((item) => item.slug === slug)
    if (!project) throw mediaError(404, 'PROJECT_NOT_FOUND', '项目不存在')
    const index = (project.media || []).findIndex((item) => item.id === mediaId)
    if (index < 0) throw mediaError(404, 'MEDIA_NOT_FOUND', '媒体不存在或已被移除')
    project.media.splice(index, 1)
    if (project.coverMediaId === mediaId) project.coverMediaId = null
    const result = await contentStore.saveProjects(data, [])
    if (!result.ok) {
      return { ok: false, errors: result.errors, warnings: result.warnings }
    }
    return { ok: true, warnings: result.warnings, projects: data }
  }

  async function cleanupCandidates() {
    const listing = await list()
    return {
      candidates: listing.files.filter((file) => file.references.length === 0),
      totalBytes: listing.totalBytes,
      totalLimit: listing.totalLimit,
    }
  }

  async function deleteFiles(relativePaths) {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw mediaError(400, 'INVALID_INPUT', '需要要删除的文件列表')
    }
    const data = await contentStore.readProjects()
    const references = buildReferenceMap(data)
    const deleted = []
    for (const relative of relativePaths) {
      if (typeof relative !== 'string') {
        throw mediaError(400, 'INVALID_PATH', '文件路径不合法')
      }
      const match = MEDIA_PATH_PATTERN.exec(relative)
      if (!match) {
        throw mediaError(400, 'INVALID_PATH', '文件路径不合法：' + relative)
      }
      const [, slug, fileName] = match
      if (!SAFE_FILE_NAME.test(fileName)) {
        throw mediaError(400, 'INVALID_PATH', '文件名不合法：' + relative)
      }
      if (references.has(relative)) {
        throw mediaError(409, 'STILL_REFERENCED', '仍被引用的文件不能删除：' + relative)
      }
      const absolute = path.join(projectDirectory(slug), fileName)
      if (!fs.existsSync(absolute)) continue
      await fsp.unlink(absolute)
      deleted.push(relative)
    }
    return { deleted }
  }

  return {
    createUploadSession,
    abortUpload,
    convertUpload,
    list,
    removeReference,
    cleanupCandidates,
    deleteFiles,
    checkFfmpeg,
  }
}

module.exports = { createMediaStore, buildReferenceMap, MEDIA_PATH_PATTERN }
