'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const { startApp, request, jsonRequest, makePng, sharp } = require('./helpers')

async function readSiteFile(context) {
  return JSON.parse(await fsp.readFile(path.join(context.sitePath, 'content', 'site.json'), 'utf8'))
}

async function readProjectsFile(context) {
  return JSON.parse(await fsp.readFile(path.join(context.sitePath, 'content', 'projects.json'), 'utf8'))
}

test('保存站点资料会先备份再原子写入，且不留下临时文件', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const before = await readSiteFile(context)
  const next = JSON.parse(JSON.stringify(before))
  next.profile.name = '新名字'

  const response = await jsonRequest(context, 'PUT', '/api/content/site', { data: next })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)

  const saved = await readSiteFile(context)
  assert.equal(saved.profile.name, '新名字')

  const backupDir = path.join(context.root, '.studio', 'backups')
  const backups = await fsp.readdir(backupDir)
  assert.ok(backups.some((name) => name.startsWith('site-') && name.endsWith('.json')), '缺少站点资料备份')

  const contentFiles = (await fsp.readdir(path.join(context.sitePath, 'content'))).sort()
  assert.deepEqual(contentFiles, ['projects.json', 'site.json'])
})

test('结构校验失败时原文件保持不变', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const before = await readSiteFile(context)
  const broken = JSON.parse(JSON.stringify(before))
  broken.profile.name = ''
  broken.profile.email = 'not-an-email'

  const response = await jsonRequest(context, 'PUT', '/api/content/site', { data: broken })
  assert.equal(response.status, 400)
  assert.equal(response.json.ok, false)
  assert.ok(response.json.errors.length >= 2)

  const after = await readSiteFile(context)
  assert.equal(after.profile.name, before.profile.name)
  assert.equal(after.profile.email, before.profile.email)

  const contentFiles = (await fsp.readdir(path.join(context.sitePath, 'content'))).sort()
  assert.deepEqual(contentFiles, ['projects.json', 'site.json'])
})

test('项目结构校验失败时拒绝保存', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const data = await readProjectsFile(context)
  data.projects[0].slug = 'Bad Slug!'
  const response = await jsonRequest(context, 'PUT', '/api/content/projects', { data })
  assert.equal(response.status, 400)
  assert.ok(response.json.errors.some((issue) => issue.code === 'invalid-slug'))

  const after = await readProjectsFile(context)
  assert.equal(after.projects[0].slug, 'demo')
})

test('slug 改名会同步移动媒体目录并改写媒体路径', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const demoDir = path.join(context.sitePath, 'media', 'projects', 'demo')
  await fsp.mkdir(demoDir, { recursive: true })
  const webp = await sharp(await makePng(48, 48)).webp().toBuffer()
  await fsp.writeFile(path.join(demoDir, 'demo-1.webp'), webp)

  const data = await readProjectsFile(context)
  data.projects[0].slug = 'renamed'
  data.projects[0].media = [{
    id: 'demo-1',
    type: 'image',
    src: 'media/projects/demo/demo-1.webp',
    poster: null,
    alt: '演示画面',
    caption: '画面说明',
    tag: '演示',
  }]

  const response = await jsonRequest(context, 'PUT', '/api/content/projects', {
    data,
    renames: [{ from: 'demo', to: 'renamed' }],
  })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)

  assert.equal(fs.existsSync(path.join(context.sitePath, 'media', 'projects', 'renamed', 'demo-1.webp')), true)
  assert.equal(fs.existsSync(demoDir), false)

  const saved = await readProjectsFile(context)
  assert.equal(saved.projects[0].slug, 'renamed')
  assert.equal(saved.projects[0].media[0].src, 'media/projects/renamed/demo-1.webp')
})

test('已发布项目的 slug 锁定后不能改名或删除', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  context.app.state.lockSlugs(['demo'])

  const renamed = await readProjectsFile(context)
  renamed.projects[0].slug = 'renamed'
  const renameResponse = await jsonRequest(context, 'PUT', '/api/content/projects', {
    data: renamed,
    renames: [{ from: 'demo', to: 'renamed' }],
  })
  assert.equal(renameResponse.status, 400)
  assert.ok(renameResponse.json.errors.some((issue) => issue.code === 'SLUG_LOCKED'))

  const removed = await readProjectsFile(context)
  removed.projects = []
  const removeResponse = await jsonRequest(context, 'PUT', '/api/content/projects', { data: removed })
  assert.equal(removeResponse.status, 400)
  assert.ok(removeResponse.json.errors.some((issue) => issue.code === 'SLUG_LOCKED'))

  const saved = await readProjectsFile(context)
  assert.equal(saved.projects[0].slug, 'demo')
})

test('保存允许草稿缺少替代文本，但会给出提醒', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const data = await readProjectsFile(context)
  data.projects[0].media = [{
    id: 'demo-1',
    type: 'image',
    src: 'media/projects/demo/demo-1.webp',
    poster: null,
    alt: '',
    caption: '',
    tag: '',
  }]
  // 文件不存在时保存只给警告，不阻塞草稿。
  const response = await jsonRequest(context, 'PUT', '/api/content/projects', { data })
  assert.equal(response.status, 200)
  assert.ok(response.json.warnings.some((issue) => issue.code === 'missing-alt'))
  assert.ok(response.json.warnings.some((issue) => issue.code === 'media-missing'))
})

test('GET 内容接口返回磁盘上的当前草稿', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const site = await request(context, { path: '/api/content/site' })
  assert.equal(site.status, 200)
  assert.equal(site.json.data.profile.name, '测试站主')
  const projects = await request(context, { path: '/api/content/projects' })
  assert.equal(projects.status, 200)
  assert.equal(projects.json.data.projects[0].slug, 'demo')
})
