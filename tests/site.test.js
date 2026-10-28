const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const MIB = 1024 * 1024
const STATUSES = ['published', 'draft', 'archived']
const PROJECTS_SCRIPT = require.resolve('../assets/projects.js')
const APP_SCRIPT = require.resolve('../assets/app.js')

function resolveInside(rootDir, candidate) {
  const boundary = path.resolve(rootDir)
  const target = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(boundary, candidate)
  if (target !== boundary && !target.startsWith(boundary + path.sep)) {
    throw new Error('路径越界：' + candidate)
  }
  return target
}

function read(relativePath) {
  return fs.readFileSync(resolveInside(root, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function fakeDocument() {
  const listeners = {}
  const document = {
    addEventListener(type, listener) {
      listeners[type] = listener
    },
    getElementById() {
      return null
    },
    querySelectorAll() {
      return []
    },
    createElement() {
      return {
        className: '',
        textContent: '',
        hidden: false,
        classList: { add() {}, toggle() {} },
        append() {},
        appendChild() {},
        addEventListener() {},
        replaceChildren() {},
        setAttribute() {},
      }
    },
  }
  return { document, listeners }
}

// 站点脚本是浏览器 IIFE：把最小 window/document 放进全局，加载后立即恢复。
function withBrowserGlobals(options, execute) {
  const { document, listeners } = fakeDocument()
  const browserWindow = { document, markdownit: null }
  browserWindow.window = browserWindow
  const fetchStub = options.fetch || (async () => {
    throw new Error('unexpected fetch')
  })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    fetch: globalThis.fetch,
  }
  globalThis.window = browserWindow
  globalThis.document = document
  globalThis.location = { pathname: '/index.html', search: '' }
  globalThis.fetch = fetchStub
  let restored = false
  function restore() {
    if (restored) return
    restored = true
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) {
        delete globalThis[key]
      } else {
        globalThis[key] = previous[key]
      }
    }
  }
  try {
    delete require.cache[PROJECTS_SCRIPT]
    delete require.cache[APP_SCRIPT]
    execute()
  } finally {
    if (!options.keepGlobals) restore()
  }
  return { document, listeners, window: browserWindow, restore }
}

function loadProjectsScript(options = {}) {
  return withBrowserGlobals(options, () => require('../assets/projects.js'))
}

function loadAppScript(options = {}) {
  return withBrowserGlobals(options, () => require('../assets/app.js'))
}

function walkFiles(directory, accumulator = []) {
  const boundary = resolveInside(root, directory)
  if (!fs.existsSync(boundary)) return accumulator
  fs.readdirSync(boundary, { withFileTypes: true }).forEach((entry) => {
    const absolute = resolveInside(boundary, entry.name)
    if (entry.isDirectory()) {
      walkFiles(absolute, accumulator)
    } else {
      accumulator.push(absolute)
    }
  })
  return accumulator
}

function assertMediaItem(project, item) {
  assert.ok(item && typeof item === 'object', project.slug + ' media entries must be objects')
  assert.match(item.id, /^[a-z0-9][a-z0-9-]*$/, project.slug + ' media id must be slug-safe')
  assert.ok(['image', 'video'].includes(item.type), project.slug + ' media type must be image or video')
  assert.ok(
    item.src.startsWith('media/projects/' + project.slug + '/'),
    project.slug + ' media src must stay inside its own project directory: ' + item.src
  )
  assert.equal(typeof item.alt, 'string')
  assert.ok(item.alt.trim().length > 0, project.slug + ' media must carry alt text')
  assert.equal(typeof item.caption, 'string')
  if (item.type === 'video') {
    assert.ok(typeof item.poster === 'string' && item.poster.startsWith('media/projects/' + project.slug + '/'), 'video media needs a poster')
  } else {
    assert.ok(item.poster === null || item.poster === undefined || item.poster === '', 'image media has no poster')
  }
  if (item.tag !== undefined) {
    assert.equal(typeof item.tag, 'string')
  }
}

test('content/site.json carries the profile and about sections used by the pages', () => {
  const site = readJson('content/site.json')
  assert.ok(site.profile, 'profile is required')
  for (const field of ['name', 'slogan', 'intro', 'email']) {
    assert.ok(typeof site.profile[field] === 'string' && site.profile[field].trim(), 'profile.' + field + ' is required')
  }
  assert.match(site.profile.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  assert.match(site.profile.github, /^https:\/\//)
  assert.ok(Array.isArray(site.profile.tags) && site.profile.tags.length > 0)
  site.profile.tags.forEach((tag) => assert.ok(typeof tag === 'string' && tag.trim()))
  if (site.profile.avatar !== undefined) {
    assert.equal(typeof site.profile.avatar, 'string')
    if (site.profile.avatar) {
      assert.equal(site.profile.avatar, 'media/profile/avatar.webp')
      const absolute = resolveInside(root, site.profile.avatar)
      assert.equal(fs.existsSync(absolute), true, 'avatar file must exist')
      assert.ok(fs.statSync(absolute).size <= 2 * MIB, 'avatar must stay under 2 MiB')
    }
  }
  if (site.integrations !== undefined) {
    assert.equal(typeof site.integrations, 'object')
    if (site.integrations.postsApiBase !== undefined) {
      assert.equal(typeof site.integrations.postsApiBase, 'string')
      if (site.integrations.postsApiBase) {
        assert.match(site.integrations.postsApiBase, /^https:\/\//)
      }
    }
  }

  assert.ok(site.about, 'about is required')
  assert.ok(Array.isArray(site.about.education) && site.about.education.length > 0)
  site.about.education.forEach((entry) => {
    assert.ok(typeof entry.school === 'string' && entry.school.trim())
    assert.ok(typeof entry.period === 'string' && entry.period.trim())
    assert.ok(typeof entry.detail === 'string')
  })
  assert.ok(Array.isArray(site.about.internships) && site.about.internships.length > 0)
  site.about.internships.forEach((entry) => {
    assert.ok(typeof entry.company === 'string' && entry.company.trim())
    assert.ok(typeof entry.period === 'string' && entry.period.trim())
    assert.ok(typeof entry.role === 'string' && entry.role.trim())
    assert.ok(Array.isArray(entry.bullets))
    entry.bullets.forEach((bullet) => assert.ok(typeof bullet === 'string' && bullet.trim()))
  })
  assert.ok(Array.isArray(site.about.capabilities) && site.about.capabilities.length > 0)
  site.about.capabilities.forEach((entry) => {
    assert.ok(typeof entry.title === 'string' && entry.title.trim())
    assert.ok(typeof entry.description === 'string' && entry.description.trim())
  })
  assert.equal(typeof site.about.contactNote, 'string')
})

test('content/projects.json keeps every project and media entry structurally valid', () => {
  const data = readJson('content/projects.json')
  assert.ok(Array.isArray(data.projects) && data.projects.length > 0)
  const slugs = new Set()
  data.projects.forEach((project) => {
    assert.match(project.slug, /^[a-z0-9][a-z0-9-]*$/, 'project slug must be URL safe')
    assert.equal(slugs.has(project.slug), false, 'project slug must be unique: ' + project.slug)
    slugs.add(project.slug)
    assert.ok(STATUSES.includes(project.status), 'project status must be published, draft or archived')
    assert.equal(Number.isInteger(project.order), true, 'project order must be an integer')
    for (const field of ['category', 'title', 'tagline', 'role', 'summary', 'overview']) {
      assert.ok(typeof project[field] === 'string' && project[field].trim(), project.slug + '.' + field + ' is required')
    }
    assert.ok(Array.isArray(project.stack) && project.stack.length > 0)
    assert.ok(Array.isArray(project.proof))
    project.proof.forEach((item) => {
      assert.ok(typeof item.value === 'string' && item.value.trim())
      assert.ok(typeof item.label === 'string' && item.label.trim())
    })
    assert.ok(Array.isArray(project.sections))
    project.sections.forEach((section) => {
      assert.ok(typeof section.title === 'string' && section.title.trim())
      assert.ok(typeof section.body === 'string' && section.body.trim())
    })
    assert.equal(typeof project.evidence, 'object')
    Object.values(project.evidence || {}).forEach((value) => {
      assert.ok(typeof value === 'string' && value.trim())
    })
    assert.ok(project.sourceUrl === '' || /^https:\/\//.test(project.sourceUrl), 'source links must be empty or https')
    assert.ok(Array.isArray(project.media))
    const mediaIds = new Set()
    project.media.forEach((item) => {
      assertMediaItem(project, item)
      assert.equal(mediaIds.has(item.id), false, project.slug + ' media ids must be unique')
      mediaIds.add(item.id)
      if (item.type === 'image' && !/\.webp$/.test(item.src)) {
        assert.fail(project.slug + ' image media must be published as WebP: ' + item.src)
      }
    })
    if (project.coverMediaId !== null && project.coverMediaId !== undefined) {
      assert.ok(mediaIds.has(project.coverMediaId), project.slug + ' coverMediaId must reference existing media')
    }
  })
})

test('every referenced media file exists, stays inside media/ and respects size limits', () => {
  const data = readJson('content/projects.json')
  const mediaRoot = path.resolve(root, 'media')
  let totalBytes = 0
  const counted = new Set()
  data.projects.forEach((project) => {
    project.media.forEach((item) => {
      const paths = [item.src, item.poster].filter(Boolean)
      paths.forEach((relativePath) => {
        const absolute = resolveInside(mediaRoot, path.resolve(root, relativePath))
        assert.equal(fs.existsSync(absolute), true, relativePath + ' must be published')
        const size = fs.statSync(absolute).size
        if (item.type === 'video' && relativePath === item.src) {
          assert.ok(size <= 18 * MIB, relativePath + ' exceeds the 18 MiB video limit')
        } else {
          assert.ok(size <= 2 * MIB, relativePath + ' exceeds the 2 MiB image limit')
        }
        if (!counted.has(absolute)) {
          totalBytes += size
          counted.add(absolute)
        }
      })
    })
  })
  assert.ok(totalBytes <= 80 * MIB, 'published media must stay under 80 MiB, found ' + Math.round(totalBytes / MIB) + ' MiB')

  walkFiles(mediaRoot).forEach((absolute) => {
    const head = fs.readFileSync(resolveInside(mediaRoot, absolute)).subarray(0, 128).toString('utf8')
    assert.equal(head.startsWith('version https://git-lfs'), false, absolute + ' looks like a Git LFS pointer')
  })
})

test('projects.js keeps a loadable fallback snapshot for same-origin fetch failures', () => {
  const { window } = loadProjectsScript()
  const projects = window.PortfolioData.all
  assert.ok(Array.isArray(projects) && projects.length > 0)
  projects.forEach((project) => {
    assert.match(project.slug, /^[a-z0-9][a-z0-9-]*$/)
    assert.ok(Array.isArray(project.media))
    project.media.forEach((item) => assertMediaItem(project, item))
  })
  assert.equal(window.PortfolioData.get('missing'), null)
  assert.equal(window.PortfolioData.get(projects[0].slug), projects[0])
})

test('application helpers keep explicit request errors and neutral identity defaults', () => {
  const { window } = loadAppScript()
  assert.equal(window.PortfolioSite.identity.name, 'Your Name')
  assert.equal(window.PortfolioSite.identity.email, 'you@example.com')
  assert.equal(window.PortfolioSite.requestErrorMessage(429), '请求过于频繁，请稍后再试')
  assert.equal(window.PortfolioSite.requestErrorMessage(503), '内容服务暂时不可用，请稍后再试')
})

test('pages load JSON content without cache and support an optional posts API', () => {
  const app = read('assets/app.js')
  assert.match(app, /content\/site\.json/)
  assert.match(app, /content\/projects\.json/)
  assert.match(app, /cache:\s*'no-cache'/)
  assert.match(app, /content-notice/)
  assert.match(app, /preload\s*=\s*'metadata'/)
  assert.doesNotMatch(app, /autoplay/i)
  assert.match(app, /integrations\.postsApiBase/)
  assert.match(app, /normalizePostsApiBase/)
  assert.match(app, /protocol !== 'https:'/)
  assert.match(app, /文章功能未配置/)
  assert.doesNotMatch(app, /const API_BASE/)
  assert.doesNotMatch(app, /fetchApi\('\/profile'\)/)
  for (const page of ['index.html', 'about.html', 'projects.html', 'project.html']) {
    assert.match(read(page), /assets\/projects\.js/)
    assert.match(read(page), /assets\/app\.js/)
  }
})

test('posts API requests are rejected with a configuration hint when unset', async () => {
  let requested = false
  const { window, restore } = loadAppScript({
    keepGlobals: true,
    fetch: async () => {
      requested = true
      return { ok: true, status: 200, json: async () => ({ data: { items: [] } }) }
    },
  })
  try {
    await assert.rejects(
      () => window.PortfolioSite.fetchApi('/posts?pageNum=1&pageSize=6'),
      /文章接口未配置/
    )
    assert.equal(requested, false)
  } finally {
    restore()
  }
})

test('every public page uses the four-item navigation and omits private identifiers', () => {
  const pages = ['index.html', 'blog.html', 'article.html', 'projects.html', 'project.html', 'about.html']
  for (const page of pages) {
    const html = read(page)
    for (const label of ['首页', '文章', '作品', '关于']) {
      assert.match(html, new RegExp('>' + label + '<'), page + ' is missing ' + label)
    }
  }
  const shared = pages.map(read).join('\n') + '\n' + read('content/site.json') + '\n' + read('content/projects.json')
  assert.doesNotMatch(shared, /1[3-9]\d{9}/)
  assert.doesNotMatch(shared, /学号/)
  assert.doesNotMatch(shared, /\b20\d{9}\b/)
  assert.doesNotMatch(shared, /\.docx/i)
  assert.doesNotMatch(shared, /javascript:/i)
  assert.doesNotMatch(shared, /data:text\//i)
})

test('project and article routes keep distinct query parameters and vendor assets', () => {
  const app = read('assets/app.js')
  const article = read('article.html')
  assert.match(app, /project\.html\?id=/)
  assert.match(app, /article\.html\?id=/)
  assert.match(article, /vendor\/markdown-it\.min\.js/)
  assert.equal(fs.existsSync(resolveInside(root, 'vendor/markdown-it.min.js')), true)
})

test('hidden controls remain hidden after component display styles apply', () => {
  const css = read('assets/styles.css')
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
})
