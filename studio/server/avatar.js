'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')
const { resolveInside } = require('./config')
const { setByPath } = require('./adapters/base')
const { readHead, isGitLfsPointer, sniffBuffer } = require('./magic')

const QUALITY_STEPS = [86, 74, 64, 54]

function avatarError(status, code, message) {
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

function createAvatarStore(config, documentStore, adapter) {
  const spec = adapter.avatar
  if (!spec) {
    return {
      supported: false,
      async beginUpload() {
        throw avatarError(404, 'AVATAR_NOT_SUPPORTED', '当前适配器没有配置头像')
      },
      async finishUpload() {
        throw avatarError(404, 'AVATAR_NOT_SUPPORTED', '当前适配器没有配置头像')
      },
      async removeAvatar() {
        throw avatarError(404, 'AVATAR_NOT_SUPPORTED', '当前适配器没有配置头像')
      },
    }
  }

  const tempInput = path.join(config.paths.temp, 'avatar-input.bin')
  const tempOutput = path.join(config.paths.temp, 'avatar-output.webp')
  const outputFile = resolveInside(config.sitePath, spec.file)
  const outputDir = path.dirname(outputFile)
  const maxBytes = spec.maxBytes

  async function beginUpload(contentLength) {
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      throw avatarError(411, 'LENGTH_REQUIRED', '上传请求缺少 Content-Length')
    }
    if (contentLength > config.limits.uploadImageMaxBytes) {
      throw avatarError(
        413,
        'UPLOAD_TOO_LARGE',
        '头像文件超过上传上限（' + Math.round(config.limits.uploadImageMaxBytes / 1024 / 1024) + ' MiB）'
      )
    }
    await fsp.mkdir(config.paths.temp, { recursive: true })
    const handle = await fsp.open(tempInput, 'w')
    return { handle, cap: config.limits.uploadImageMaxBytes }
  }

  async function finishUpload() {
    let buffer = null
    try {
      const head = readHead(tempInput)
      if (isGitLfsPointer(head)) {
        throw avatarError(400, 'LFS_POINTER', '检测到 Git LFS 指针文件，请上传真实图片')
      }
      const sniff = sniffBuffer(head)
      if (sniff.format === 'svg') {
        throw avatarError(415, 'SVG_REJECTED', '首版不接受 SVG，请使用 JPG、PNG 或 WebP')
      }
      if (sniff.format === 'gif') {
        throw avatarError(415, 'GIF_REJECTED', '首版不接受 GIF，请使用 JPG、PNG 或 WebP')
      }
      if (sniff.kind !== 'image') {
        throw avatarError(415, 'MIME_MISMATCH', '头像必须是 JPG、PNG 或 WebP 图片')
      }
      for (const quality of QUALITY_STEPS) {
        buffer = await sharp(tempInput)
          .rotate()
          .resize(spec.size, spec.size, { fit: 'cover', position: 'centre' })
          .webp({ quality })
          .toBuffer()
        if (buffer.length <= maxBytes) break
      }
      if (!buffer || buffer.length > maxBytes) {
        throw avatarError(413, 'MEDIA_TOO_LARGE', '头像压缩后仍超过 ' + Math.round(maxBytes / 1024) + ' KiB')
      }
      await fsp.mkdir(outputDir, { recursive: true })
      await fsp.writeFile(tempOutput, buffer)
      await moveFile(tempOutput, outputFile)

      const documentData = await documentStore.readDocument(spec.document)
      setByPath(documentData, spec.pointer, spec.file)
      const saved = await documentStore.saveDocument(spec.document, documentData)
      if (!saved.ok) {
        const first = saved.errors && saved.errors[0]
        throw avatarError(400, 'INVALID_CONTENT', first ? first.path + '：' + first.message : '站点文档校验失败')
      }
      const metadata = await sharp(buffer).metadata()
      return {
        avatar: spec.file,
        meta: { size: buffer.length, width: metadata.width, height: metadata.height },
        warnings: saved.warnings || [],
      }
    } finally {
      await fsp.rm(tempInput, { force: true }).catch(() => {})
      await fsp.rm(tempOutput, { force: true }).catch(() => {})
    }
  }

  async function removeAvatar() {
    const documentData = await documentStore.readDocument(spec.document)
    setByPath(documentData, spec.pointer, '')
    const saved = await documentStore.saveDocument(spec.document, documentData)
    if (!saved.ok) {
      const first = saved.errors && saved.errors[0]
      throw avatarError(400, 'INVALID_CONTENT', first ? first.path + '：' + first.message : '站点文档校验失败')
    }
    return { ok: true, avatar: '', warnings: saved.warnings || [] }
  }

  return { supported: true, beginUpload, finishUpload, removeAvatar, relativePath: spec.file }
}

module.exports = { createAvatarStore }
