'use strict'

// 本地内容工作台：适配器驱动的 HTTP 服务。

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { loadConfig, resolveInside } = require('./config')
const { createState } = require('./state')
const { loadAdapter } = require('./adapters/loader')
const { createDocumentStore } = require('./content')
const { createMediaStore } = require('./media')
const { createAvatarStore } = require('./avatar')
const { createPublisher } = require('./publish')
const { validateDocuments } = require('./validate')
const { checkFfmpeg } = require('./videos')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const STUDIO_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const MAX_JSON_BYTES = 4 * 1024 * 1024

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(payload)
}

function readJsonBody(req, maxBytes = MAX_JSON_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(Object.assign(new Error('请求体过大'), { status: 413, code: 'BODY_TOO_LARGE' }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400, code: 'INVALID_JSON' }))
      }
    })
    req.on('error', (error) => {
      reject(Object.assign(new Error('读取请求体失败：' + error.message), { status: 400, code: 'BODY_ERROR' }))
    })
  })
}

// 上传请求体写入媒体模块创建的文件句柄，避免在 HTTP 层拼接任何路径。
function writeStreamToHandle(stream, handle, maxBytes) {
  return new Promise((resolve, reject) => {
    let settled = false
    let ended = false
    let bytes = 0
    let pending = Promise.resolve()
    function fail(error) {
      if (settled) return
      settled = true
      stream.destroy()
      reject(error)
    }
    stream.on('data', (chunk) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        fail(Object.assign(new Error('上传内容超过大小上限'), { status: 413, code: 'UPLOAD_TOO_LARGE' }))
        return
      }
      stream.pause()
      pending = pending.then(
        () => handle.write(chunk),
        fail
      ).then(() => {
        if (!settled) stream.resume()
      }, fail)
    })
    stream.on('end', () => {
      ended = true
      pending.then(() => {
        if (settled) return
        settled = true
        resolve(bytes)
      }, fail)
    })
    stream.on('error', fail)
    stream.on('close', () => {
      if (settled || ended) return
      fail(Object.assign(new Error('上传连接中断'), { status: 400, code: 'UPLOAD_ABORTED' }))
    })
  })
}

// 预览目录的 URL → 绝对路径索引。请求路径只作为 Map 键使用，不参与路径拼接。
function buildFileIndex(rootDir) {
  const boundary = path.resolve(rootDir)
  const index = new Map()
  const stack = [{ absolute: boundary, url: '' }]
  while (stack.length) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true })
    } catch (error) {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !/^[A-Za-z0-9._-]+$/.test(entry.name)) continue
      const absolute = path.join(current.absolute, entry.name)
      if (!absolute.startsWith(boundary + path.sep)) continue
      const url = current.url + '/' + entry.name
      if (entry.isDirectory()) {
        stack.push({ absolute, url })
      } else if (entry.isFile()) {
        index.set(url, absolute)
      }
    }
  }
  return index
}

function lookupIndexedFile(index, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch (error) {
    return undefined
  }
  if (decoded.includes('\0')) return undefined
  const normalized = decoded.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const forbidden = segments.some((segment) => segment === '..' || segment.startsWith('.'))
  if (forbidden) return undefined
  const key = '/' + segments.join('/')
  return index.get(key === '/' ? '/index.html' : key)
}

function sendFile(response, absolutePath, options = {}) {
  let stat
  try {
    stat = fs.statSync(absolutePath)
  } catch (error) {
    stat = null
  }
  if (!stat || !stat.isFile()) {
    sendJson(response, 404, { error: 'NOT_FOUND', message: '文件不存在' })
    return
  }
  const headers = {
    'Content-Type': MIME_TYPES[path.extname(absolutePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (options.csp) headers['Content-Security-Policy'] = STUDIO_CSP
  response.writeHead(200, headers)
  if (options.head) {
    response.end()
    return
  }
  fs.createReadStream(absolutePath).pipe(response)
}

function createServer(options = {}) {
  const config = loadConfig(options.config || {})
  const { adapter, directory: adapterDirectory } = loadAdapter(config)
  for (const doc of adapter.documents) {
    const file = resolveInside(config.sitePath, doc.file)
    if (!fs.existsSync(file)) {
      throw new Error(
        '找不到内容文件：' + doc.file +
        '（请检查适配器 ' + adapter.id + ' 与 config.json 的 sitePath）'
      )
    }
  }
  const state = createState(config)
  const contentStore = createDocumentStore(config, state, adapter)
  const mediaStore = createMediaStore(config, contentStore, adapter)
  const avatarStore = createAvatarStore(config, contentStore, adapter)
  const publisher = createPublisher(config, state, contentStore, adapter, options.publisher || {})
  const webRoot = config.paths.web
  const siteRoot = config.sitePath
  const studioFiles = new Map([
    ['/index.html', path.join(webRoot, 'index.html')],
    ['/studio.css', path.join(webRoot, 'studio.css')],
    ['/core.js', path.join(webRoot, 'core.js')],
    ['/components.js', path.join(webRoot, 'components.js')],
    ['/renderer-document.js', path.join(webRoot, 'renderer-document.js')],
    ['/renderer-collection.js', path.join(webRoot, 'renderer-collection.js')],
    ['/renderer-media.js', path.join(webRoot, 'renderer-media.js')],
    ['/renderer-publish.js', path.join(webRoot, 'renderer-publish.js')],
  ])
  let activePort = config.port

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      const status = error.status || 500
      if (status >= 500) console.error(error)
      const message = status >= 500 ? '服务器内部错误：' + error.message : error.message
      if (!response.headersSent) {
        sendJson(response, status, { error: error.code || 'INTERNAL_ERROR', message })
      } else {
        response.end()
      }
    })
  })

  server.on('listening', () => {
    const address = server.address()
    if (address && typeof address === 'object') activePort = address.port
  })

  function allowedHosts() {
    return ['127.0.0.1:' + activePort, 'localhost:' + activePort]
  }

  function isAllowedHost(value) {
    return allowedHosts().includes(value)
  }

  async function handle(request, response) {
    const host = String(request.headers.host || '').toLowerCase()
    if (!isAllowedHost(host)) {
      sendJson(response, 403, { error: 'INVALID_HOST', message: '请通过 http://127.0.0.1:' + activePort + ' 访问工作台' })
      return
    }
    const method = request.method || 'GET'
    const isWrite = method !== 'GET' && method !== 'HEAD'
    if (isWrite) {
      const origin = String(request.headers.origin || '').toLowerCase()
      const originAllowed = allowedHosts().some((value) => origin === 'http://' + value)
      if (!originAllowed) {
        sendJson(response, 403, { error: 'INVALID_ORIGIN', message: '请求来源不被允许' })
        return
      }
      if (request.headers['x-studio-token'] !== state.token) {
        sendJson(response, 401, { error: 'INVALID_TOKEN', message: '会话令牌无效，请刷新工作台页面' })
        return
      }
    }

    const url = new URL(request.url || '/', 'http://' + host)
    const pathname = url.pathname

    if (pathname === '/api/session' && method === 'GET') {
      sendJson(response, 200, {
        token: state.token,
        sitePath: config.sitePath,
        port: activePort,
        ffmpeg: await checkFfmpeg(),
        lockedSlugs: state.lockedSlugList(),
        production: {
          url: config.production.url,
          branch: config.production.branch,
        },
        adapter: {
          id: adapter.id,
          name: adapter.name,
          version: adapter.version,
          apiVersion: adapter.apiVersion,
          webModule: adapter.webModule || null,
        },
        manifest: adapter.manifest,
        capabilities: {
          avatar: adapter.avatar
            ? {
              document: adapter.avatar.document,
              pointer: adapter.avatar.pointer,
              file: adapter.avatar.file,
              size: adapter.avatar.size,
              maxBytes: adapter.avatar.maxBytes,
            }
            : null,
          media: adapter.mediaCollections.map((collection) => ({
            id: collection.id,
            label: collection.label,
            mode: collection.mode,
            dirKey: collection.dirKey || null,
            root: collection.root,
            mediaField: collection.mediaField || null,
            coverField: collection.cover ? collection.cover.field : null,
          })),
        },
        documents: adapter.documents.map((doc) => ({
          id: doc.id,
          kind: doc.kind,
          label: doc.label,
          itemsKey: doc.itemsKey || null,
          identityField: doc.identityField || null,
          orderField: doc.orderField || null,
          statusField: doc.statusField || null,
          statuses: doc.statuses || [],
        })),
      })
      return
    }

    const contentMatch = pathname.match(/^\/api\/content\/([a-z0-9-]+)$/)
    if (contentMatch && (method === 'GET' || method === 'PUT')) {
      const documentId = contentMatch[1]
      if (!adapter.documents.some((doc) => doc.id === documentId)) {
        sendJson(response, 404, { error: 'UNKNOWN_DOCUMENT', message: '未知内容文档：' + documentId })
        return
      }
      if (method === 'GET') {
        sendJson(response, 200, { data: await contentStore.readDocument(documentId) })
        return
      }
      const body = await readJsonBody(request)
      const data = body && body.data ? body.data : body
      const renames = Array.isArray(body.renames) ? body.renames : []
      const result = await contentStore.saveDocument(documentId, data, { renames })
      sendJson(response, result.ok ? 200 : 400, result)
      return
    }

    if (pathname === '/api/media' && method === 'POST') {
      // 第一步：建立绑定媒体集合/条目的会话，把请求体写入会话文件句柄（不拼接路径）。
      const requestedCollection = String(url.searchParams.get('collection') || '')
      const requestedItem = String(url.searchParams.get('item') || url.searchParams.get('project') || '')
      const requestedKind = String(url.searchParams.get('kind') || '')
      const contentLength = Number(request.headers['content-length'] || 0)
      let session = null
      try {
        session = await mediaStore.createUploadSession({
          collectionId: requestedCollection,
          itemKey: requestedItem,
          kind: requestedKind,
          contentLength,
        })
        try {
          await writeStreamToHandle(request, session.handle, session.cap)
        } finally {
          await session.handle.close().catch(() => {})
        }
        sendJson(response, 201, { token: session.token })
      } catch (error) {
        if (session) await mediaStore.abortUpload(session.token)
        const statusByCode = {
          FFMPEG_MISSING: 503,
          VIDEO_TIMEOUT: 504,
          VIDEO_TOO_LONG: 422,
          MEDIA_TOO_LARGE: 413,
          INVALID_VIDEO: 415,
          POSTER_FAILED: 500,
        }
        const status = error.status || statusByCode[error.code] || 500
        if (status >= 500) console.error(error)
        if (!response.headersSent) {
          sendJson(response, status, { error: error.code || 'MEDIA_ERROR', message: error.message })
        } else {
          response.end()
        }
      }
      return
    }

    if (pathname === '/api/media/convert' && method === 'POST') {
      // 第二步：按会话令牌转换临时文件并写入项目媒体目录。
      const body = await readJsonBody(request)
      const uploadToken = String(body.token || '')
      if (!/^[a-f0-9]{32}$/.test(uploadToken)) {
        sendJson(response, 400, { error: 'INVALID_UPLOAD_TOKEN', message: '上传会话令牌不合法' })
        return
      }
      try {
        const result = await mediaStore.convertUpload({ token: uploadToken })
        sendJson(response, 201, result)
      } catch (error) {
        const statusByCode = {
          FFMPEG_MISSING: 503,
          VIDEO_TIMEOUT: 504,
          VIDEO_TOO_LONG: 422,
          MEDIA_TOO_LARGE: 413,
          INVALID_VIDEO: 415,
          POSTER_FAILED: 500,
        }
        const status = error.status || statusByCode[error.code] || 500
        if (status >= 500) console.error(error)
        sendJson(response, status, { error: error.code || 'MEDIA_ERROR', message: error.message })
      }
      return
    }

    if (pathname === '/api/media' && method === 'GET') {
      sendJson(response, 200, await mediaStore.list(url.searchParams.get('collection') || ''))
      return
    }

    if (pathname === '/api/media/remove' && method === 'POST') {
      const body = await readJsonBody(request)
      const result = await mediaStore.removeReference({
        collectionId: String(body.collection || ''),
        itemKey: String(body.item || body.project || ''),
        mediaId: String(body.mediaId || ''),
      })
      sendJson(response, result.ok ? 200 : 400, result)
      return
    }

    if (pathname === '/api/media/cleanup' && method === 'POST') {
      sendJson(response, 200, await mediaStore.cleanupCandidates(url.searchParams.get('collection') || ''))
      return
    }

    if (pathname === '/api/media/cleanup/confirm' && method === 'POST') {
      const body = await readJsonBody(request)
      sendJson(response, 200, await mediaStore.deleteFiles(String(body.collection || ''), body.files))
      return
    }

    if (pathname === '/api/avatar' && method === 'POST') {
      const contentLength = Number(request.headers['content-length'] || 0)
      let upload = null
      try {
        upload = await avatarStore.beginUpload(contentLength)
        try {
          await writeStreamToHandle(request, upload.handle, upload.cap)
        } finally {
          await upload.handle.close().catch(() => {})
        }
        sendJson(response, 201, await avatarStore.finishUpload())
      } catch (error) {
        const status = error.status || 500
        if (status >= 500) console.error(error)
        if (!response.headersSent) {
          sendJson(response, status, { error: error.code || 'AVATAR_ERROR', message: error.message })
        } else {
          response.end()
        }
      }
      return
    }

    if (pathname === '/api/avatar/remove' && method === 'POST') {
      try {
        sendJson(response, 200, await avatarStore.removeAvatar())
      } catch (error) {
        const status = error.status || 500
        if (status >= 500) console.error(error)
        sendJson(response, status, { error: error.code || 'AVATAR_ERROR', message: error.message })
      }
      return
    }

    if (pathname === '/api/validate' && method === 'POST') {
      const result = validateDocuments({
        adapter,
        documents: await contentStore.readAll(),
        config,
        mode: 'publish',
      })
      sendJson(response, 200, result)
      return
    }

    if (pathname === '/api/publish' && method === 'POST') {
      sendJson(response, 202, await publisher.start())
      return
    }

    if (pathname === '/api/publish/status' && method === 'GET') {
      sendJson(response, 200, publisher.snapshot())
      return
    }

    if (pathname === '/api/publish/events' && method === 'GET') {
      publisher.subscribe(request, response)
      return
    }

    if (pathname.startsWith('/adapter-web/')) {
      const name = pathname.slice('/adapter-web/'.length)
      if (!adapter.webModule || name !== adapter.webModule) {
        sendJson(response, 404, { error: 'NOT_FOUND', message: '适配器没有提供该前端模块' })
        return
      }
      sendFile(response, resolveInside(adapterDirectory, name), { head: method === 'HEAD', csp: true })
      return
    }

    if (pathname === '/preview' || pathname.startsWith('/preview/')) {
      const relative = pathname === '/preview' ? '/' : pathname.slice('/preview'.length)
      const previewFile = lookupIndexedFile(buildFileIndex(siteRoot), relative)
      if (!previewFile) {
        sendJson(response, 404, { error: 'NOT_FOUND', message: '文件不存在' })
        return
      }
      sendFile(response, previewFile, { head: method === 'HEAD' })
      return
    }

    const studioFile = studioFiles.get(pathname === '/' ? '/index.html' : pathname)
    if (!studioFile) {
      sendJson(response, 404, { error: 'NOT_FOUND', message: '文件不存在' })
      return
    }
    sendFile(response, studioFile, { head: method === 'HEAD', csp: true })
  }

  return { server, config, state, adapter, publisher, contentStore, mediaStore, avatarStore }
}

function start() {
  const app = createServer()
  app.server.listen(app.config.port, '127.0.0.1', () => {
    const address = app.server.address()
    const port = address && typeof address === 'object' ? address.port : app.config.port
    console.log('内容工作台已启动')
    console.log('  地址：http://127.0.0.1:' + port + '（或 http://localhost:' + port + '）')
    console.log('  适配器：' + app.adapter.name + '（' + app.adapter.id + '）')
    console.log('  站点：' + app.config.sitePath)
    console.log('  发布目标：' + (app.config.production.url || '未配置部署地址（部署确认关闭）'))
    if (!fs.existsSync(path.join(app.config.studioRoot, 'config.json'))) {
      console.log('  提示：未找到 config.json，正在使用默认配置；可复制 config.example.json 后按需修改。')
    }
    console.log('  按 Ctrl+C 停止。写操作需要页面会话令牌，仅本机可访问。')
  })
  app.server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error('端口 ' + app.config.port + ' 已被占用，请在 config.json 中修改端口后重试。')
    } else {
      console.error('工作台启动失败：' + error.message)
    }
    process.exit(1)
  })
  return app
}

if (require.main === module) {
  start()
}

module.exports = { createServer, start }
