'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { SAFE_FILE_NAME } = require('./util')
const { resolveInside } = require('./config')
const { readHead, isGitLfsPointer, sniffBuffer } = require('./magic')
const { processImage } = require('./images')
const { processVideo, checkFfmpeg, ffmpegMissing } = require('./videos')
const {
  mediaEntries,
  dirRelative,
  fileRelative,
  findItemByKey,
  referenceMap,
  limitsFor,
  itemDefaults,
} = require('./media-model')

const SESSION_TTL_MS = 15 * 60 * 1000
const EXTENSION_TYPE = {
  '.webp': 'image',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.avif': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
}

function mediaError(status, code, message) {
  return Object.assign(new Error(message), { code, status })
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

function createMediaStore(config, documentStore, adapter) {
  const collections = new Map(adapter.mediaCollections.map((collection) => [collection.id, collection]))
  const sessions = new Map()

  function collectionById(id) {
    if (!adapter.mediaCollections.length) {
      throw mediaError(400, 'NO_MEDIA_COLLECTION', '该站点没有配置媒体集合')
    }
    if (!id) return adapter.mediaCollections[0]
    const collection = collections.get(id)
    if (!collection) throw mediaError(400, 'UNKNOWN_MEDIA_COLLECTION', '未知媒体集合：' + id)
    return collection
  }

  function limitsOf(collection) {
    return limitsFor(collection, config)
  }

  function outputExtension(collection, kind) {
    const formats = collection.formats && Array.isArray(collection.formats[kind]) ? collection.formats[kind] : []
    if (formats.length) return formats[0]
    return kind === 'video' ? '.mp4' : '.webp'
  }

  function tempDirectory(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) {
      throw mediaError(400, 'INVALID_UPLOAD_TOKEN', '上传会话令牌不合法')
    }
    return resolveInside(config.paths.temp, token)
  }

  function targetDirectory(collection, itemKey) {
    const relative = dirRelative(collection, itemKey)
    if (!relative) throw mediaError(400, 'INVALID_ITEM', '缺少媒体所属条目')
    return resolveInside(config.sitePath, relative)
  }

  async function allMediaIds() {
    const documents = await documentStore.readAll()
    const ids = new Set()
    for (const collection of adapter.mediaCollections) {
      for (const entry of mediaEntries(collection, documents)) {
        if (entry.media && typeof entry.media.id === 'string') ids.add(entry.media.id)
      }
    }
    return ids
  }

  async function uniqueMediaId(kind) {
    const used = await allMediaIds()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = (kind === 'image' ? 'img' : 'vid') + '-' +
        Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex')
      if (!used.has(candidate)) return candidate
    }
    throw mediaError(500, 'ID_COLLISION', '无法生成唯一媒体 id')
  }

  function sweepSessions() {
    const now = Date.now()
    for (const [token, session] of sessions) {
      if (now - session.createdAt <= SESSION_TTL_MS) continue
      sessions.delete(token)
      fsp.rm(tempDirectory(token), { recursive: true, force: true }).catch(() => {})
    }
  }

  async function createUploadSession({ collectionId, itemKey, kind, contentLength }) {
    const collection = collectionById(collectionId)
    if (kind !== 'image' && kind !== 'video') {
      throw mediaError(400, 'INVALID_KIND', 'kind 必须是 image 或 video')
    }
    const formats = collection.formats || {}
    if (!Array.isArray(formats[kind]) || formats[kind].length === 0) {
      throw mediaError(400, 'UNSUPPORTED_MEDIA_KIND', '该媒体集合不支持 ' + kind + ' 类型')
    }
    const limits = limitsOf(collection)
    const cap = kind === 'image' ? limits.uploadImageMaxBytes : limits.uploadVideoMaxBytes
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      throw mediaError(411, 'LENGTH_REQUIRED', '上传请求缺少 Content-Length')
    }
    if (contentLength > cap) {
      throw mediaError(413, 'UPLOAD_TOO_LARGE', '文件超过上传上限（' + Math.round(cap / 1024 / 1024) + ' MiB）')
    }
    if (collection.mode === 'collection' && collection.dirKey) {
      if (typeof itemKey !== 'string' || !itemKey) {
        throw mediaError(400, 'INVALID_ITEM', '缺少媒体所属条目')
      }
      const documents = await documentStore.readAll()
      if (!findItemByKey(collection, documents, itemKey)) {
        throw mediaError(404, 'ITEM_NOT_FOUND', '条目不存在，请先保存再上传媒体')
      }
    }
    if (kind === 'video' && !(await checkFfmpeg())) {
      throw ffmpegMissing()
    }
    sweepSessions()
    const token = crypto.randomBytes(16).toString('hex')
    await fsp.mkdir(tempDirectory(token), { recursive: true })
    const handle = await fsp.open(path.join(tempDirectory(token), 'input.bin'), 'wx')
    sessions.set(token, {
      collectionId: collection.id,
      itemKey: collection.mode === 'collection' && collection.dirKey ? itemKey : null,
      kind,
      cap,
      createdAt: Date.now(),
    })
    return { token, cap, handle }
  }

  async function abortUpload(token) {
    if (!/^[a-f0-9]{32}$/.test(String(token || ''))) return
    sessions.delete(token)
    await fsp.rm(tempDirectory(token), { recursive: true, force: true }).catch(() => {})
  }

  async function convertUpload({ token }) {
    const session = sessions.get(token)
    if (!session) {
      throw mediaError(410, 'UPLOAD_EXPIRED', '上传会话不存在或已过期，请重试')
    }
    const collection = collectionById(session.collectionId)
    const limits = limitsOf(collection)
    const tmpDir = tempDirectory(token)
    const inputFile = path.join(tmpDir, 'input.bin')
    try {
      if (session.itemKey) {
        const documents = await documentStore.readAll()
        if (!findItemByKey(collection, documents, session.itemKey)) {
          throw mediaError(404, 'ITEM_NOT_FOUND', '条目不存在，请先保存再上传媒体')
        }
      }
      const targetDir = targetDirectory(collection, session.itemKey)
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
      const extension = outputExtension(collection, session.kind)
      await fsp.mkdir(targetDir, { recursive: true })

      if (session.kind === 'image') {
        const outputFile = path.join(tmpDir, mediaId + extension)
        const info = await processImage(inputFile, outputFile, limits)
        const outputName = path.basename(outputFile)
        if (!SAFE_FILE_NAME.test(outputName)) throw mediaError(500, 'INTERNAL', '内部文件名不合法')
        await moveFile(outputFile, path.join(targetDir, outputName))
        return {
          media: Object.assign({
            id: mediaId,
            type: 'image',
            src: fileRelative(collection, session.itemKey, outputName),
            poster: null,
          }, itemDefaults(collection)),
          meta: { size: info.bytes, width: info.width, height: info.height, duration: null },
        }
      }

      const outputFile = path.join(tmpDir, mediaId + extension)
      const posterFile = path.join(tmpDir, mediaId + '-poster.webp')
      const info = await processVideo(inputFile, outputFile, posterFile, limits)
      const outputName = path.basename(outputFile)
      const posterName = path.basename(posterFile)
      if (!SAFE_FILE_NAME.test(outputName) || !SAFE_FILE_NAME.test(posterName)) {
        throw mediaError(500, 'INTERNAL', '内部文件名不合法')
      }
      await moveFile(outputFile, path.join(targetDir, outputName))
      await moveFile(posterFile, path.join(targetDir, posterName))
      return {
        media: Object.assign({
          id: mediaId,
          type: 'video',
          src: fileRelative(collection, session.itemKey, outputName),
          poster: fileRelative(collection, session.itemKey, posterName),
        }, itemDefaults(collection)),
        meta: {
          size: info.size,
          width: info.width,
          height: info.height,
          duration: typeof info.duration === 'number' ? info.duration : null,
        },
      }
    } finally {
      sessions.delete(token)
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  function listFiles(rootDir) {
    const files = []
    const stack = [{ absolute: rootDir, relative: '' }]
    while (stack.length) {
      const current = stack.pop()
      let entries = []
      try {
        entries = fs.readdirSync(current.absolute, { withFileTypes: true })
      } catch (error) {
        continue
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || !SAFE_FILE_NAME.test(entry.name)) continue
        const absolute = path.join(current.absolute, entry.name)
        if (entry.isDirectory()) {
          stack.push({ absolute, relative: current.relative + '/' + entry.name })
        } else if (entry.isFile()) {
          files.push({ absolute, relative: current.relative + '/' + entry.name })
        }
      }
    }
    return files
  }

  async function list(collectionId) {
    const collection = collectionById(collectionId)
    const limits = limitsOf(collection)
    const documents = await documentStore.readAll()
    const references = referenceMap(adapter, documents)
    const root = resolveInside(config.sitePath, collection.root)
    const files = listFiles(root).map((file) => {
      const relative = collection.root + file.relative
      const stat = fs.statSync(file.absolute)
      const segments = file.relative.split('/').filter(Boolean)
      const extension = path.extname(file.relative).toLowerCase()
      return {
        path: relative,
        project: collection.mode === 'collection' && collection.dirKey ? (segments[0] || null) : null,
        name: path.basename(file.relative),
        type: EXTENSION_TYPE[extension] || 'other',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        references: references.get(relative) || [],
      }
    })
    files.sort((left, right) => left.path.localeCompare(right.path))
    return {
      collection: collection.id,
      files,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      totalLimit: limits.totalMaxBytes || config.limits.mediaTotalMaxBytes,
    }
  }

  async function removeReference({ collectionId, itemKey, mediaId }) {
    const collection = collectionById(collectionId)
    const documents = await documentStore.readAll()
    const entries = mediaEntries(collection, documents)
    const entry = entries.find((candidate) => {
      if (!candidate.media || candidate.media.id !== mediaId) return false
      if (collection.mode === 'collection' && collection.dirKey) return candidate.itemKey === itemKey
      return true
    })
    if (!entry) throw mediaError(404, 'MEDIA_NOT_FOUND', '媒体不存在或已被移除')
    entry.list.splice(entry.mediaIndex, 1)
    if (collection.cover && entry.item && entry.item[collection.cover.field] === mediaId) {
      entry.item[collection.cover.field] = null
    }
    const documentData = documents[collection.document]
    const result = await documentStore.saveDocument(collection.document, documentData)
    if (!result.ok) {
      return { ok: false, errors: result.errors, warnings: result.warnings }
    }
    return { ok: true, warnings: result.warnings }
  }

  async function cleanupCandidates(collectionId) {
    const listing = await list(collectionId)
    return {
      collection: listing.collection,
      candidates: listing.files.filter((file) => file.references.length === 0),
      totalBytes: listing.totalBytes,
      totalLimit: listing.totalLimit,
    }
  }

  function safeRelative(collection, relativePath) {
    if (typeof relativePath !== 'string') return false
    if (!relativePath.startsWith(collection.root + '/')) return false
    const rest = relativePath.slice(collection.root.length + 1)
    const segments = rest.split('/')
    if (!segments.length) return false
    return segments.every((segment) => SAFE_FILE_NAME.test(segment))
  }

  async function deleteFiles(collectionId, relativePaths) {
    if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
      throw mediaError(400, 'INVALID_INPUT', '需要要删除的文件列表')
    }
    const collection = collectionById(collectionId)
    const documents = await documentStore.readAll()
    const references = referenceMap(adapter, documents)
    const deleted = []
    for (const relative of relativePaths) {
      if (!safeRelative(collection, relative)) {
        throw mediaError(400, 'INVALID_PATH', '文件路径不合法：' + relative)
      }
      if (references.has(relative)) {
        throw mediaError(409, 'STILL_REFERENCED', '仍被引用的文件不能删除：' + relative)
      }
      const absolute = resolveInside(config.sitePath, relative)
      if (!fs.existsSync(absolute)) continue
      await fsp.unlink(absolute)
      deleted.push(relative)
    }
    return { collection: collection.id, deleted }
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

module.exports = { createMediaStore }
