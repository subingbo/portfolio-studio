'use strict'

const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')
const {
  startApp,
  createFixtureSite,
  makeTempDir,
  request,
  jsonRequest,
  git,
  initRepo,
  waitForPublish,
} = require('./helpers')

async function setupBareOrigin(root) {
  const basePath = path.join(root, 'base')
  await createFixtureSite(basePath)
  await fsp.mkdir(path.join(basePath, 'docs'), { recursive: true })
  await fsp.writeFile(path.join(basePath, 'docs', 'guide.md'), '原始内容\n', 'utf8')
  await initRepo(basePath)

  const remotePath = path.join(root, 'remote.git')
  await git(root, 'init', '--bare', '-b', 'main', remotePath)

  const sitePath = path.join(root, 'site')
  await git(root, 'clone', '-c', 'core.autocrlf=false', basePath, sitePath)
  await git(sitePath, 'config', 'user.email', 'studio-test@example.com')
  await git(sitePath, 'config', 'user.name', 'Studio Test')
  await git(sitePath, 'config', 'core.autocrlf', 'false')
  await git(sitePath, 'remote', 'set-url', 'origin', remotePath)
  await git(sitePath, 'push', '-u', 'origin', 'main')
  return { sitePath, remotePath }
}

function production(remotePath) {
  return {
    url: 'https://example.com',
    expectedRemote: remotePath,
    branch: 'main',
  }
}

async function modifySiteName(sitePath, name) {
  const file = path.join(sitePath, 'content', 'site.json')
  const data = JSON.parse(await fsp.readFile(file, 'utf8'))
  data.profile.name = name
  await fsp.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

const okProbe = async () => ({ ok: true, detail: '测试桩：正式域名已更新' })

function stepStatus(status) {
  return Object.fromEntries(status.steps.map((step) => [step.id, step.status]))
}

test('发布只提交 content 与 media，保留其他未提交修改并锁定 slug', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  await fsp.writeFile(path.join(sitePath, 'docs', 'guide.md'), '本地未提交修改\n', 'utf8')
  await modifySiteName(sitePath, '发布后的名字')

  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: { deployProbe: okProbe },
  })
  t.after(() => context.close())

  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'published', JSON.stringify(status))
  const steps = stepStatus(status)
  for (const id of ['validate', 'tests', 'preflight', 'stage', 'commit', 'push', 'deploy']) {
    assert.equal(steps[id], 'passed', id + ' 应为 passed：' + JSON.stringify(status))
  }

  const show = await git(sitePath, 'show', '--name-only', '--pretty=format:')
  const files = show.stdout.split(/\r?\n/).filter(Boolean)
  assert.ok(files.length > 0, '提交应包含文件')
  for (const file of files) {
    const allowed = file === 'content' || file.startsWith('content/') || file === 'media' || file.startsWith('media/')
    assert.equal(allowed, true, '提交包含不允许的路径：' + file)
  }
  assert.equal(files.some((file) => file.startsWith('docs/')), false)

  const working = await git(sitePath, 'status', '--porcelain')
  assert.match(working.stdout, /docs\/guide\.md/, 'docs 的未提交修改应保留')

  const remoteHead = await git(remotePath, 'rev-parse', 'main')
  const localHead = await git(sitePath, 'rev-parse', 'main')
  assert.equal(remoteHead.stdout.trim(), localHead.stdout.trim(), '远程 main 应收到推送')

  const session = await request(context, { path: '/api/session' })
  assert.ok(session.json.lockedSlugs.includes('demo'), '发布后 slug 应锁定')

  const log = await git(sitePath, 'log', '-1', '--pretty=%s')
  assert.match(log.stdout, /^content: 工作台内容更新/)
})

test('没有内容变更时发布会跳过提交与推送', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: { deployProbe: okProbe },
  })
  t.after(() => context.close())

  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'no-changes', JSON.stringify(status))
  const steps = stepStatus(status)
  assert.equal(steps.commit, 'skipped')
  assert.equal(steps.push, 'skipped')
  assert.equal(steps.deploy, 'skipped')
})

test('站点测试失败时不会创建提交', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  await fsp.writeFile(
    path.join(sitePath, 'package.json'),
    JSON.stringify({
      name: 'fixture-site',
      private: true,
      type: 'commonjs',
      scripts: { test: 'node -e "process.exit(1)"' },
    }, null, 2) + '\n',
    'utf8'
  )
  await modifySiteName(sitePath, '不该发布的名字')

  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: { deployProbe: okProbe },
  })
  t.after(() => context.close())

  const beforeHead = await git(sitePath, 'rev-parse', 'HEAD')
  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'failed')
  assert.match(status.message, /测试/)
  assert.equal(stepStatus(status).tests, 'failed')
  const afterHead = await git(sitePath, 'rev-parse', 'HEAD')
  assert.equal(afterHead.stdout.trim(), beforeHead.stdout.trim(), '测试失败不应产生提交')
})

test('本地落后远程时停止发布，不覆盖不自动变基', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)

  const other = path.join(root, 'other-clone')
  await git(root, 'clone', '-c', 'core.autocrlf=false', remotePath, other)
  await git(other, 'config', 'user.email', 'other@example.com')
  await git(other, 'config', 'user.name', 'Other')
  await fsp.writeFile(path.join(other, 'notes.txt'), '远程新提交\n', 'utf8')
  await git(other, 'add', 'notes.txt')
  await git(other, 'commit', '-m', 'remote advance')
  await git(other, 'push', 'origin', 'main')

  await modifySiteName(sitePath, '本地名字')

  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: { deployProbe: okProbe },
  })
  t.after(() => context.close())

  const beforeHead = await git(sitePath, 'rev-parse', 'HEAD')
  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'failed')
  assert.match(status.message, /落后或分叉/)
  assert.equal(stepStatus(status).preflight, 'failed')
  const afterHead = await git(sitePath, 'rev-parse', 'HEAD')
  assert.equal(afterHead.stdout.trim(), beforeHead.stdout.trim())
})

test('暂存区有无关文件时停止发布', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  await fsp.writeFile(path.join(sitePath, 'stray.txt'), '无关文件\n', 'utf8')
  await git(sitePath, 'add', 'stray.txt')
  await modifySiteName(sitePath, '名字')

  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: { deployProbe: okProbe },
  })
  t.after(() => context.close())

  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'failed')
  assert.match(status.message, /暂存区/)
  assert.equal(stepStatus(status).preflight, 'failed')
})

test('推送被远程拒绝时给出可操作提示并保留本地提交', async (t) => {
  const root = await makeTempDir()
  const basePath = path.join(root, 'base')
  await createFixtureSite(basePath)
  await initRepo(basePath)

  const remotePath = path.join(root, 'checked-out-remote')
  await git(root, 'clone', basePath, remotePath)

  const sitePath = path.join(root, 'site')
  await git(root, 'clone', basePath, sitePath)
  await git(sitePath, 'config', 'user.email', 'studio-test@example.com')
  await git(sitePath, 'config', 'user.name', 'Studio Test')
  await git(sitePath, 'remote', 'set-url', 'origin', remotePath)
  await modifySiteName(sitePath, '推送失败的名字')

  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: { deployProbe: okProbe },
  })
  t.after(() => context.close())

  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'failed')
  assert.match(status.message, /推送失败/)
  assert.equal(stepStatus(status).push, 'failed')

  const log = await git(sitePath, 'log', '-1', '--pretty=%s')
  assert.match(log.stdout, /^content: 工作台内容更新/, '本地提交应保留')
})

test('部署确认超时时提示已推送待确认', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  await modifySiteName(sitePath, '待确认的名字')

  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: {
      deployProbe: async () => ({ ok: false, timeout: true, detail: '测试桩：部署确认超时' }),
    },
  })
  t.after(() => context.close())

  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'pushed-pending-deploy', JSON.stringify(status))
  assert.equal(stepStatus(status).deploy, 'timeout')
  assert.equal(stepStatus(status).push, 'passed')
})

test('发布进行中再次点击返回 409', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  await fsp.writeFile(
    path.join(sitePath, 'package.json'),
    JSON.stringify({
      name: 'fixture-site',
      private: true,
      type: 'commonjs',
      scripts: { test: 'node -e "setTimeout(() => process.exit(0), 600)"' },
    }, null, 2) + '\n',
    'utf8'
  )
  await modifySiteName(sitePath, '并发测试')

  const context = await startApp({
    root,
    sitePath,
    production: production(remotePath),
    publisher: { deployProbe: okProbe },
  })
  t.after(() => context.close())

  const first = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(first.status, 202)
  const second = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(second.status, 409)
  assert.equal(second.json.error, 'PUBLISH_RUNNING')

  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'published', JSON.stringify(status))
})

test('null 内容也能通过 GET 状态接口读取', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  const context = await startApp({ root, sitePath, production: production(remotePath) })
  t.after(() => context.close())
  const status = await request(context, { path: '/api/publish/status' })
  assert.equal(status.status, 200)
  assert.equal(status.json.running, false)
  assert.equal(status.json.steps.length, 7)
})

test('未配置部署地址时跳过部署确认', async (t) => {
  const root = await makeTempDir()
  const { sitePath, remotePath } = await setupBareOrigin(root)
  await modifySiteName(sitePath, '跳过部署确认')

  const context = await startApp({
    root,
    sitePath,
    production: {
      url: '',
      expectedRemote: remotePath,
      branch: 'main',
      deployCheck: { enabled: false },
    },
  })
  t.after(() => context.close())

  const started = await jsonRequest(context, 'POST', '/api/publish', {})
  assert.equal(started.status, 202)
  const status = await waitForPublish(context)
  assert.equal(status.outcome, 'published', JSON.stringify(status))
  assert.equal(stepStatus(status).push, 'passed')
  assert.equal(stepStatus(status).deploy, 'skipped')
  assert.match(status.message, /部署确认已关闭/)
})
