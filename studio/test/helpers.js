'use strict'

const fsp = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const { createServer } = require('../server/index')
const { runProcess } = require('../server/util')

async function makeTempDir(prefix = 'studio-test-') {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function baseSite() {
  return {
    profile: {
      name: '测试站主',
      initial: '测',
      avatar: '',
      eyebrow: 'TEST · WORKBENCH',
      slogan: '把测试写进发布流程。',
      intro: '这是一个用于自动化测试的站点资料。',
      tags: ['Java 后端'],
      email: 'studio-test@example.com',
      github: 'https://github.com/example',
    },
    about: {
      intro: '关于介绍',
      contactNote: '联系说明',
      education: [{ school: '测试大学', period: '2024—2028', detail: '计算机科学 · 本科' }],
      internships: [{ company: '测试公司', period: '2026—至今', role: '后端实习生', bullets: ['完成接口优化'] }],
      capabilities: [{ title: 'Java', description: '后端开发' }],
    },
  }
}

function baseProjects() {
  return {
    version: 1,
    projects: [
      {
        slug: 'demo',
        status: 'published',
        order: 1,
        category: '个人项目',
        title: '演示项目',
        tagline: '一句话定位',
        role: '独立开发',
        summary: '项目摘要',
        stack: ['Java'],
        proof: [{ value: '1 项', label: '成果' }],
        overview: '项目概览',
        sections: [{ title: '实现', body: '正文内容' }],
        evidence: { deployment: '部署证据' },
        sourceUrl: '',
        coverMediaId: null,
        media: [],
      },
    ],
  }
}

async function createFixtureSite(sitePath, options = {}) {
  await writeJson(path.join(sitePath, 'content', 'site.json'), options.site || baseSite())
  await writeJson(path.join(sitePath, 'content', 'projects.json'), options.projects || baseProjects())
  await fsp.mkdir(path.join(sitePath, 'media', 'projects'), { recursive: true })
  await fsp.writeFile(path.join(sitePath, 'index.html'), '<!doctype html><title>fixture</title>\n', 'utf8')
  await fsp.writeFile(path.join(sitePath, 'about.html'), '<!doctype html><title>fixture about</title>\n', 'utf8')
  await fsp.writeFile(
    path.join(sitePath, 'package.json'),
    JSON.stringify({
      name: 'fixture-site',
      private: true,
      type: 'commonjs',
      scripts: { test: 'node -e "process.exit(0)"' },
    }, null, 2) + '\n',
    'utf8'
  )
  return sitePath
}

async function createLandingFixture(sitePath, options = {}) {
  await writeJson(path.join(sitePath, 'content', 'landing.json'), options.landing || {
    title: 'Landing fixture',
    subtitle: 'Fixture subtitle',
    intro: 'Fixture intro',
    accent: '#f97316',
    sections: [{ heading: 'Section', body: 'Body' }],
    images: [],
  })
  await fsp.mkdir(path.join(sitePath, 'media', 'images'), { recursive: true })
  await fsp.writeFile(path.join(sitePath, 'index.html'), '<!doctype html><title>landing fixture</title>\n', 'utf8')
  await fsp.writeFile(
    path.join(sitePath, 'package.json'),
    JSON.stringify({
      name: 'landing-fixture',
      private: true,
      type: 'commonjs',
      scripts: { test: 'node -e "process.exit(0)"' },
    }, null, 2) + '\n',
    'utf8'
  )
  return sitePath
}

function makePng(width, height, color) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color || { r: 249, g: 115, b: 22 },
    },
  }).png().toBuffer()
}

async function startApp(options = {}) {
  const root = options.root || await makeTempDir()
  const sitePath = options.sitePath || path.join(root, 'site')
  if (!options.sitePath) {
    await createFixtureSite(sitePath, options)
  }
  const app = createServer({
    config: {
      studioRoot: root,
      sitePath,
      port: 0,
      adapter: options.adapter,
      production: options.production || {
        url: '',
        expectedRemote: '',
        branch: 'main',
      },
      limits: Object.assign({
        deployPollTimeoutMs: 1000,
        deployPollIntervalMs: 100,
        testTimeoutMs: 90000,
        videoProcessTimeoutMs: 60000,
      }, options.limits || {}),
    },
    publisher: options.publisher,
  })
  await new Promise((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(0, '127.0.0.1', resolve)
  })
  const port = app.server.address().port
  return {
    app,
    root,
    sitePath,
    port,
    token: app.state.token,
    close: () => new Promise((resolve) => app.server.close(resolve)),
  }
}

function request(context, options = {}) {
  const method = options.method || 'GET'
  const headers = Object.assign({}, options.headers)
  const body = options.body
  if (body !== undefined && body !== null) {
    headers['Content-Length'] = String(body.length)
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: context.port,
      method,
      path: options.path || '/',
      headers,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const buffer = Buffer.concat(chunks)
        let json = null
        try {
          json = JSON.parse(buffer.toString('utf8'))
        } catch (error) {
          json = null
        }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          buffer,
          text: buffer.toString('utf8'),
          json,
        })
      })
    })
    req.on('error', reject)
    if (body !== undefined && body !== null) req.write(body)
    req.end()
  })
}

function adminHeaders(context, overrides = {}) {
  return Object.assign({
    Origin: 'http://127.0.0.1:' + context.port,
    'X-Studio-Token': context.token,
  }, overrides)
}

function jsonRequest(context, method, pathname, payload, overrides = {}) {
  const body = Buffer.from(JSON.stringify(payload === undefined ? {} : payload))
  return request(context, {
    method,
    path: pathname,
    headers: adminHeaders(context, Object.assign({
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
    }, overrides)),
    body,
  })
}

async function uploadRequest(context, { project = 'demo', kind = 'image', name = 'test.png', body, contentType = 'image/png', withToken = true } = {}) {
  const headers = {
    Origin: 'http://127.0.0.1:' + context.port,
    'Content-Type': contentType,
    'Content-Length': String(body.length),
  }
  if (withToken) headers['X-Studio-Token'] = context.token
  const query = '?project=' + encodeURIComponent(project) + '&kind=' + encodeURIComponent(kind) + '&name=' + encodeURIComponent(name)
  const upload = await request(context, { method: 'POST', path: '/api/media' + query, headers, body })
  if (upload.status !== 201 || !upload.json || !upload.json.token) {
    return upload
  }
  return jsonRequest(context, 'POST', '/api/media/convert', { token: upload.json.token })
}

function avatarRequest(context, body, contentType = 'image/png', withToken = true) {
  const headers = {
    Origin: 'http://127.0.0.1:' + context.port,
    'Content-Type': contentType,
    'Content-Length': String(body.length),
  }
  if (withToken) headers['X-Studio-Token'] = context.token
  return request(context, { method: 'POST', path: '/api/avatar', headers, body })
}

async function git(cwd, ...args) {
  return runProcess('git', args, { cwd, timeoutMs: 90000 })
}

async function initRepo(directory) {
  await fsp.mkdir(directory, { recursive: true })
  await git(directory, 'init', '-b', 'main')
  await git(directory, 'config', 'user.email', 'studio-test@example.com')
  await git(directory, 'config', 'user.name', 'Studio Test')
  await git(directory, 'config', 'core.autocrlf', 'false')
  await git(directory, 'add', '-A')
  await git(directory, 'commit', '-m', 'init fixture')
}

async function waitForPublish(context, timeoutMs = 90000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const response = await request(context, { path: '/api/publish/status' })
    if (response.json && response.json.running === false) return response.json
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error('等待发布结束超时')
}

module.exports = {
  makeTempDir,
  writeJson,
  baseSite,
  baseProjects,
  createFixtureSite,
  createLandingFixture,
  makePng,
  startApp,
  request,
  adminHeaders,
  jsonRequest,
  uploadRequest,
  avatarRequest,
  git,
  initRepo,
  waitForPublish,
  sharp,
}
