'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const { startApp, jsonRequest, avatarRequest, makePng, sharp } = require('./helpers')

async function readSite(context) {
  return JSON.parse(await fsp.readFile(path.join(context.sitePath, 'content', 'site.json'), 'utf8'))
}

test('上传头像会居中裁成 512×512 WebP 并写入 site.json', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const response = await avatarRequest(context, await makePng(1200, 800))
  assert.equal(response.status, 201)
  assert.equal(response.json.avatar, 'media/profile/avatar.webp')

  const absolute = path.join(context.sitePath, 'media', 'profile', 'avatar.webp')
  assert.equal(fs.existsSync(absolute), true)
  const metadata = await sharp(absolute).metadata()
  assert.equal(metadata.width, 512)
  assert.equal(metadata.height, 512)
  assert.ok(fs.statSync(absolute).size <= 1024 * 1024, '头像应小于 1 MiB')

  const site = await readSite(context)
  assert.equal(site.profile.avatar, 'media/profile/avatar.webp')

  const backups = await fsp.readdir(path.join(context.root, '.studio', 'backups'))
  assert.ok(backups.some((name) => name.startsWith('site-')), '头像写入前应备份 site.json')
})

test('头像上传拒绝 SVG、GIF 与非图片内容', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const svg = await avatarRequest(context, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml')
  assert.equal(svg.status, 415)
  assert.equal(svg.json.error, 'SVG_REJECTED')

  const gif = await avatarRequest(context, Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 1)]), 'image/gif')
  assert.equal(gif.status, 415)
  assert.equal(gif.json.error, 'GIF_REJECTED')

  const notImage = await avatarRequest(
    context,
    Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(16, 0)]),
    'image/png'
  )
  assert.equal(notImage.status, 415)
  assert.equal(notImage.json.error, 'MIME_MISMATCH')

  const site = await readSite(context)
  assert.equal(site.profile.avatar, '')
})

test('头像上传需要会话令牌', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const response = await avatarRequest(context, await makePng(32, 32), 'image/png', false)
  assert.equal(response.status, 401)
})

test('恢复默认会清空头像引用', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const uploaded = await avatarRequest(context, await makePng(64, 64))
  assert.equal(uploaded.status, 201)

  const removed = await jsonRequest(context, 'POST', '/api/avatar/remove', {})
  assert.equal(removed.status, 200)
  assert.equal(removed.json.avatar, '')

  const site = await readSite(context)
  assert.equal(site.profile.avatar, '')
  assert.equal(fs.existsSync(path.join(context.sitePath, 'media', 'profile', 'avatar.webp')), true, '文件保留，等待覆盖')
})

test('发布校验要求头像文件存在', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  await avatarRequest(context, await makePng(64, 64))
  await fsp.rm(path.join(context.sitePath, 'media', 'profile', 'avatar.webp'))

  const validation = await jsonRequest(context, 'POST', '/api/validate', {})
  assert.equal(validation.status, 200)
  assert.equal(validation.json.ok, false)
  assert.ok(validation.json.errors.some((issue) => issue.code === 'avatar-missing'))
})
