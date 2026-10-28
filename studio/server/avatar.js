'use strict'

const fsp = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')
const { readHead, isGitLfsPointer, sniffBuffer } = require('./magic')

const AVATAR_RELATIVE = 'media/profile/avatar.webp'
const AVATAR_SIZE = 512
const AVATAR_MAX_BYTES = 1024 * 1024
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

function createAvatarStore(config, contentStore) {
  // 所有路径都是服务端固定常量，不拼接任何请求数据。
  const tempInput = path.join(config.paths.temp, 'avatar-input.bin')
  const tempOutput = path.join(config.paths.temp, 'avatar-output.webp')
  const outputDir = path.join(config.paths.siteMedia, 'profile')
  const outputFile = path.join(outputDir, 'avatar.webp')

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
          .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'centre' })
          .webp({ quality })
          .toBuffer()
        if (buffer.length <= AVATAR_MAX_BYTES) break
      }
      if (!buffer || buffer.length > AVATAR_MAX_BYTES) {
        throw avatarError(413, 'MEDIA_TOO_LARGE', '头像压缩后仍超过 1 MiB，请换一张更简单的图片')
      }
      await fsp.mkdir(outputDir, { recursive: true })
      await fsp.writeFile(tempOutput, buffer)
      await moveFile(tempOutput, outputFile)
      const site = await contentStore.readSite()
      site.profile.avatar = AVATAR_RELATIVE
      const saved = await contentStore.saveSite(site)
      if (!saved.ok) {
        const first = saved.errors && saved.errors[0]
        throw avatarError(400, 'INVALID_CONTENT', first ? first.path + '：' + first.message : '站点资料校验失败')
      }
      const metadata = await sharp(buffer).metadata()
      return {
        avatar: AVATAR_RELATIVE,
        meta: { size: buffer.length, width: metadata.width, height: metadata.height },
        warnings: saved.warnings || [],
      }
    } finally {
      await fsp.rm(tempInput, { force: true }).catch(() => {})
      await fsp.rm(tempOutput, { force: true }).catch(() => {})
    }
  }

  async function removeAvatar() {
    const site = await contentStore.readSite()
    site.profile.avatar = ''
    const saved = await contentStore.saveSite(site)
    if (!saved.ok) {
      const first = saved.errors && saved.errors[0]
      throw avatarError(400, 'INVALID_CONTENT', first ? first.path + '：' + first.message : '站点资料校验失败')
    }
    return { ok: true, avatar: '', warnings: saved.warnings || [] }
  }

  return { beginUpload, finishUpload, removeAvatar, relativePath: AVATAR_RELATIVE }
}

module.exports = { createAvatarStore, AVATAR_RELATIVE }
