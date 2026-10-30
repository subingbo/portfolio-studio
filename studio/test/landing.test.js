'use strict'

const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const {
  startApp,
  createLandingFixture,
  makeTempDir,
  makePng,
  request,
  adminHeaders,
  jsonRequest,
  git,
  initRepo,
  waitForPublish,
} = require('./helpers')

async function setupLandingOrigin(root) {
  const basePath = path.join(root, 'base')
  await createLandingFixture(basePath)
  await initRepo(basePath)
  const remotePath = path.join(root, 'remote.git')
  await git(root, 'init', '--bare', '-b', 'main', remotePath)
  const sitePath = path.join(root, 'site')
  await git(root, 'clone', '-c', 'core.autocrlf=false', basePath, sitePath)
  await git(sitePath, 'config', 'user.email', 'studio-test@example.com')
  await git(sitePath, 'config', 'user.name', 'Studio Test')
  await git(sitePath, 'remote', 'set-url', 'origin', remotePath)
  await git(sitePath, 'push', '-u', 'origin', 'main')
  return { sitePath, remotePath }
}

async function startLandingApp(options = {}) {
  const root = options.root || await makeTempDir()
  const sitePath = options.sitePath || path.join(root, 'site')
  if (!options.sitePath) await createLandingFixture(sitePath)
  return startApp({ root, sitePath, adapter: 'landing', ...options })
}

function landingUploadRequest(context, png) {
  return request(context, {
    method: 'POST',
    path: '/api/media?collection=images&kind=image&name=pic.png',
    headers: adminHeaders(context, {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
    }),
    body: png,
  })
}

test('landing 适配器通过清单暴露文档、媒体与自定义组件', async (t) => {
  const context = await startLandingApp()
  t.after(() => context.close())
  const session = await request(context, { path: '/api/session' })
  assert.equal(session.status, 200)
  assert.equal(session.json.adapter.id, 'landing')
  assert.equal(session.json.adapter.webModule, 'web.js')
  assert.equal(session.json.capabilities.avatar, null)
  assert.equal(session.json.capabilities.media[0].mode, 'path')
  assert.deepEqual(session.json.documents.map((doc) => doc.id), ['landing'])
  const views = session.json.manifest.views
  assert.ok(views.some((view) => view.type === 'document' && view.document === 'landing'))
  assert.ok(views.some((view) => view.type === 'custom' && view.component === 'gallery-editor'))
  const accent = views[0].form.sections[0].fields.find((field) => field.path[0] === 'accent')
  assert.equal(accent.type, 'custom')
  assert.equal(accent.component, 'color')
})

test('landing 内容读写、头像禁用与自定义模块服务', async (t) => {
  const context = await startLandingApp()
  t.after(() => context.close())
  const data = (await request(context, { path: '/api/content/landing' })).json.data
  data.title = '更新后的标题'
  const saved = await jsonRequest(context, 'PUT', '/api/content/landing', { data })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.ok, true)

  const avatar = await request(context, {
    method: 'POST',
    path: '/api/avatar',
    headers: adminHeaders(context, { 'Content-Type': 'image/png', 'Content-Length': String((await makePng(16, 16)).length) }),
    body: await makePng(16, 16),
  })
  assert.equal(avatar.status, 404)
  assert.equal(avatar.json.error, 'AVATAR_NOT_SUPPORTED')

  const moduleResponse = await request(context, { path: '/adapter-web/web.js' })
  assert.equal(moduleResponse.status, 200)
  assert.match(moduleResponse.text, /gallery-editor/)
  const missing = await request(context, { path: '/adapter-web/other.js' })
  assert.equal(missing.status, 404)
})

test('landing 扁平媒体集合可上传并写入文档', async (t) => {
  const context = await startLandingApp()
  t.after(() => context.close())
  const upload = await landingUploadRequest(context, await makePng(800, 600))
  assert.equal(upload.status, 201)
  const converted = await jsonRequest(context, 'POST', '/api/media/convert', { token: upload.json.token })
  assert.equal(converted.status, 201)
  const media = converted.json.media
  assert.equal(media.type, 'image')
  assert.match(media.src, /^media\/images\/img-[a-z0-9-]+\.webp$/)

  const data = (await request(context, { path: '/api/content/landing' })).json.data
  data.images = [Object.assign({}, media, { alt: '示例图片', caption: '说明' })]
  const saved = await jsonRequest(context, 'PUT', '/api/content/landing', { data })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.ok, true)

  const listing = await request(context, { path: '/api/media?collection=images' })
  assert.equal(listing.status, 200)
  assert.equal(listing.json.files[0].references.length, 1)
  const validation = await jsonRequest(context, 'POST', '/api/validate', {})
  assert.equal(validation.json.ok, true)
})

test('landing 适配器可完成发布并只暂存 content 与 media', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupLandingOrigin(root)
  const landingFile = path.join(sitePath, 'content', 'landing.json')
  const data = JSON.parse(await fsp.readFile(landingFile, 'utf8'))
  data.title = '发布后的标题'
  await fsp.writeFile(landingFile, JSON.stringify(data, null, 2) + '\n', 'utf8')

  const context = await startApp({
    root,
    sitePath,
    adapter: 'landing',
    production: { url: '', expectedRemote: remotePath, branch: 'main' },
    publisher: { deployProbe: async () => ({ ok: true, detail: '测试桩：已上线' }) },
  })
  t.after(() => context.close())

  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'published', JSON.stringify(status))
  const files = (await git(sitePath, 'show', '--name-only', '--pretty=format:')).stdout
    .split(/\r?\n/).filter(Boolean)
  assert.deepEqual(files, ['content/landing.json'])
  const log = await git(sitePath, 'log', '-1', '--pretty=%s')
  assert.match(log.stdout, /^content: 工作台内容更新/)
  const session = await request(context, { path: '/api/session' })
  assert.equal(session.json.lockedSlugs.length, 0)
})
