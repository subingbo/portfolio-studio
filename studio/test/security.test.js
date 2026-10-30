'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { startApp, request, adminHeaders, uploadRequest, makePng } = require('./helpers')

function jsonBody(payload) {
  return Buffer.from(JSON.stringify(payload))
}

test('localhost 主机名同样视为本机访问', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const session = await request(context, {
    path: '/api/session',
    headers: { Host: 'localhost:' + context.port },
  })
  assert.equal(session.status, 200)

  const site = await request(context, { path: '/api/content/site' })
  const body = Buffer.from(JSON.stringify({ data: site.json.data }))
  const write = await request(context, {
    method: 'PUT',
    path: '/api/content/site',
    headers: {
      Host: 'localhost:' + context.port,
      Origin: 'http://localhost:' + context.port,
      'X-Studio-Token': context.token,
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
    },
    body,
  })
  assert.equal(write.status, 200)
  assert.equal(write.json.ok, true)
})

test('无会话令牌的写请求被拒绝', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const body = jsonBody({ data: {} })
  const response = await request(context, {
    method: 'PUT',
    path: '/api/content/site',
    headers: {
      Origin: 'http://127.0.0.1:' + context.port,
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
    },
    body,
  })
  assert.equal(response.status, 401)
  assert.equal(response.json.error, 'INVALID_TOKEN')
})

test('错误 Origin 的写请求被拒绝', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const body = jsonBody({ data: {} })
  const response = await request(context, {
    method: 'PUT',
    path: '/api/content/site',
    headers: adminHeaders(context, {
      Origin: 'http://evil.example',
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
    }),
    body,
  })
  assert.equal(response.status, 403)
  assert.equal(response.json.error, 'INVALID_ORIGIN')
})

test('非本机 Host 的请求被拒绝', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const response = await request(context, {
    path: '/api/session',
    headers: { Host: 'evil.example:3737' },
  })
  assert.equal(response.status, 403)
  assert.equal(response.json.error, 'INVALID_HOST')
})

test('静态服务拒绝路径穿越与点文件', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const attempts = [
    '/preview/%2e%2e/%2e%2e/package.json',
    '/preview/..%2f..%2fpackage.json',
    '/preview/%2e%2e%5cpackage.json',
    '/preview/.git/config',
    '/.env',
  ]
  for (const attempt of attempts) {
    const response = await request(context, { path: attempt })
    assert.ok(
      response.status === 400 || response.status === 403 || response.status === 404,
      attempt + ' 返回了意外状态 ' + response.status
    )
  }
})

test('媒体上传拒绝 SVG、GIF、Git LFS 指针与伪造类型', async (t) => {
  const context = await startApp()
  t.after(() => context.close())

  const svg = await uploadRequest(context, {
    name: 'icon.svg',
    contentType: 'image/svg+xml',
    body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
  })
  assert.equal(svg.status, 415)
  assert.equal(svg.json.error, 'SVG_REJECTED')

  const gif = await uploadRequest(context, {
    name: 'anim.gif',
    contentType: 'image/gif',
    body: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64, 1)]),
  })
  assert.equal(gif.status, 415)
  assert.equal(gif.json.error, 'GIF_REJECTED')

  const lfs = await uploadRequest(context, {
    name: 'photo.png',
    body: Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n'),
  })
  assert.equal(lfs.status, 400)
  assert.equal(lfs.json.error, 'LFS_POINTER')

  const mismatched = await uploadRequest(context, {
    name: 'clip.mp4',
    contentType: 'video/mp4',
    body: Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftypmp42'),
      Buffer.alloc(32, 0),
    ]),
  })
  assert.equal(mismatched.status, 415)
  assert.equal(mismatched.json.error, 'MIME_MISMATCH')
})

test('媒体上传拒绝未知项目与跨目录 slug', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const png = await makePng(16, 16)
  const missing = await uploadRequest(context, { project: 'missing', body: png })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error, 'ITEM_NOT_FOUND')

  const traversal = await uploadRequest(context, { project: '../outside', body: png })
  assert.ok([400, 404].includes(traversal.status))
  assert.notEqual(traversal.status, 201)
})

test('媒体上传需要令牌', async (t) => {
  const context = await startApp()
  t.after(() => context.close())
  const png = await makePng(16, 16)
  const response = await uploadRequest(context, { body: png, withToken: false })
  assert.equal(response.status, 401)
})
