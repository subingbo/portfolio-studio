'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const { startApp, request, jsonRequest, uploadRequest, makePng, sharp } = require('./helpers')
const { runProcess } = require('../server/util')
const { checkFfmpeg } = require('../server/videos')

function mediaAbsolute(context, relative) {
  return path.join(context.sitePath, ...relative.split('/'))
}

async function readProjects(context) {
  const response = await request(context, { path: '/api/content/projects' })
  return response.json.data
}

async function saveProjects(context, data, extra = {}) {
  return jsonRequest(context, 'PUT', '/api/content/projects', Object.assign({ data }, extra))
}

test('图片上传转为 WebP 且尺寸与大小受限', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const response = await uploadRequest(context, {
    project: 'demo',
    kind: 'image',
    name: '大树.png',
    body: await makePng(2400, 1400),
  })
  assert.equal(response.status, 201)
  const media = response.json.media
  assert.equal(media.type, 'image')
  assert.match(media.src, /^media\/projects\/demo\/img-[a-z0-9-]+\.webp$/)
  assert.equal(media.poster, null)
  assert.equal(typeof media.alt, 'string')

  const absolute = mediaAbsolute(context, media.src)
  assert.equal(fs.existsSync(absolute), true)
  const metadata = await sharp(absolute).metadata()
  assert.ok(metadata.width <= 1920 && metadata.height <= 1920, '图片应缩到 1920px 以内')
  assert.ok(fs.statSync(absolute).size <= 2 * 1024 * 1024, '图片应小于 2 MiB')
})

test('视频上传转 H.264/AAC MP4 并生成 WebP 封面', async (t) => {
  const ffmpegReady = await checkFfmpeg()
  if (!ffmpegReady) {
    t.skip('本机没有 FFmpeg')
    return
  }
  const context = await startApp()
  t.after(() => context.close())

  const samplePath = path.join(context.root, 'sample.mp4')
  await runProcess('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=320x240:rate=15',
    '-t', '2',
    '-pix_fmt', 'yuv420p',
    samplePath,
  ], { timeoutMs: 60000 })

  const response = await uploadRequest(context, {
    project: 'demo',
    kind: 'video',
    name: '演示.mp4',
    contentType: 'video/mp4',
    body: await fsp.readFile(samplePath),
  })
  assert.equal(response.status, 201)
  const media = response.json.media
  assert.equal(media.type, 'video')
  assert.match(media.src, /^media\/projects\/demo\/vid-[a-z0-9-]+\.mp4$/)
  assert.match(media.poster, /-poster\.webp$/)
  assert.equal(fs.existsSync(mediaAbsolute(context, media.src)), true)
  assert.equal(fs.existsSync(mediaAbsolute(context, media.poster)), true)
  assert.ok(fs.statSync(mediaAbsolute(context, media.src)).size <= 18 * 1024 * 1024)
  assert.ok(response.json.meta.duration > 1.5 && response.json.meta.duration < 3)
})

test('超过配置时长上限的视频被拒绝', async (t) => {
  const ffmpegReady = await checkFfmpeg()
  if (!ffmpegReady) {
    t.skip('本机没有 FFmpeg')
    return
  }
  const context = await startApp({ limits: { videoMaxDurationSeconds: 1 } })
  t.after(() => context.close())

  const samplePath = path.join(context.root, 'sample-long.mp4')
  await runProcess('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=320x240:rate=15',
    '-t', '2',
    '-pix_fmt', 'yuv420p',
    samplePath,
  ], { timeoutMs: 60000 })

  const response = await uploadRequest(context, {
    project: 'demo',
    kind: 'video',
    name: 'long.mp4',
    contentType: 'video/mp4',
    body: await fsp.readFile(samplePath),
  })
  assert.equal(response.status, 422)
  assert.equal(response.json.error, 'VIDEO_TOO_LONG')
})

test('默认配置下超过 12 秒的视频被拒绝', async (t) => {
  const { loadConfig } = require('../server/config')
  assert.equal(loadConfig().limits.videoMaxDurationSeconds, 12)

  const ffmpegReady = await checkFfmpeg()
  if (!ffmpegReady) {
    t.skip('本机没有 FFmpeg')
    return
  }
  const context = await startApp()
  t.after(() => context.close())

  const samplePath = path.join(context.root, 'sample-13s.mp4')
  await runProcess('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=160x120:rate=10',
    '-t', '13',
    '-pix_fmt', 'yuv420p',
    samplePath,
  ], { timeoutMs: 60000 })

  const response = await uploadRequest(context, {
    project: 'demo',
    kind: 'video',
    name: 'long-13s.mp4',
    contentType: 'video/mp4',
    body: await fsp.readFile(samplePath),
  })
  assert.equal(response.status, 422)
  assert.equal(response.json.error, 'VIDEO_TOO_LONG')
  assert.match(response.json.message, /12 秒/)
})

test('删除引用后素材可在清理中删除，仍被引用的文件拒绝删除', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const upload = await uploadRequest(context, {
    project: 'demo',
    body: await makePng(120, 80),
  })
  assert.equal(upload.status, 201)
  const media = upload.json.media
  const absolute = mediaAbsolute(context, media.src)

  const data = await readProjects(context)
  data.projects[0].media = [Object.assign({}, media, { alt: '演示画面', caption: '说明', tag: '标签' })]
  data.projects[0].coverMediaId = media.id
  const saved = await saveProjects(context, data)
  assert.equal(saved.status, 200)

  const blocked = await jsonRequest(context, 'POST', '/api/media/cleanup/confirm', { files: [media.src] })
  assert.equal(blocked.status, 409)
  assert.equal(blocked.json.error, 'STILL_REFERENCED')

  const removed = await jsonRequest(context, 'POST', '/api/media/remove', { project: 'demo', mediaId: media.id })
  assert.equal(removed.status, 200)
  const afterRemove = await readProjects(context)
  assert.equal(afterRemove.projects[0].media.length, 0)
  assert.equal(afterRemove.projects[0].coverMediaId, null)

  const cleanup = await jsonRequest(context, 'POST', '/api/media/cleanup', {})
  assert.equal(cleanup.status, 200)
  assert.ok(cleanup.json.candidates.some((file) => file.path === media.src))

  const confirmed = await jsonRequest(context, 'POST', '/api/media/cleanup/confirm', { files: [media.src] })
  assert.equal(confirmed.status, 200)
  assert.deepEqual(confirmed.json.deleted, [media.src])
  assert.equal(fs.existsSync(absolute), false)
})

test('素材库列出文件与引用关系及总量', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const upload = await uploadRequest(context, { project: 'demo', body: await makePng(80, 60) })
  const media = upload.json.media
  const data = await readProjects(context)
  data.projects[0].media = [Object.assign({}, media, { alt: '画面', caption: '', tag: '' })]
  await saveProjects(context, data)

  const listing = await request(context, { path: '/api/media' })
  assert.equal(listing.status, 200)
  assert.ok(listing.json.files.some((file) => file.path === media.src && file.references.length === 1))
  assert.ok(listing.json.totalBytes > 0)
  assert.equal(typeof listing.json.totalLimit, 'number')
})

test('上传不存在的项目返回 404，缺 Content-Length 返回 411', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const missing = await uploadRequest(context, { project: 'nope', body: await makePng(20, 20) })
  assert.equal(missing.status, 404)

  const response = await request(context, {
    method: 'POST',
    path: '/api/media?project=demo&kind=image&name=x.png',
    headers: {
      Origin: 'http://127.0.0.1:' + context.port,
      'X-Studio-Token': context.token,
      'Content-Type': 'image/png',
    },
  })
  assert.equal(response.status, 411)
})
