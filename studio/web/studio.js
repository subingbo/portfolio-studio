'use strict'

const app = {
  token: '',
  sitePath: '',
  ffmpeg: false,
  lockedSlugs: [],
  site: null,
  projects: null,
  view: 'home',
  selectedSlug: null,
  dragProjectSlug: null,
  dragMediaId: null,
  dirty: { site: false, projects: false },
  publishStatus: null,
  stream: null,
  lastOutcome: null,
}

let toastTimer = null

function $(selector) {
  return document.querySelector(selector)
}

function h(tag, attrs, ...children) {
  const node = document.createElement(tag)
  const attributes = attrs || {}
  for (const key of Object.keys(attributes)) {
    const value = attributes[key]
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'value') node.value = value
    else if (key === 'checked') node.checked = Boolean(value)
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value === true) node.setAttribute(key, '')
    else node.setAttribute(key, String(value))
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

function textInput(value, onInput, attrs = {}) {
  const node = h('input', Object.assign({ value: value == null ? '' : String(value) }, attrs))
  node.addEventListener('input', () => onInput(node.value))
  return node
}

function textArea(value, onInput, rows = 3, attrs = {}) {
  const node = h('textarea', Object.assign({ rows: String(rows) }, attrs))
  node.value = value == null ? '' : String(value)
  node.addEventListener('input', () => onInput(node.value))
  return node
}

function selectInput(value, options, onChange) {
  const node = h('select')
  for (const option of options) {
    const item = h('option', { value: option.value, text: option.label })
    if (option.value === value) item.selected = true
    node.appendChild(item)
  }
  node.addEventListener('change', () => onChange(node.value))
  return node
}

function button(label, onClick, className) {
  const node = h('button', { type: 'button', class: 'btn ' + (className || 'btn--ghost'), text: label })
  node.addEventListener('click', onClick)
  return node
}

function field(label, control, hint, wide) {
  return h(
    'label',
    { class: 'field' + (wide === false ? '' : ' field--wide') },
    h('span', { class: 'field__label', text: label }),
    control,
    hint ? h('span', { class: 'field__hint', text: hint }) : null
  )
}

function subhead(title, action) {
  return h('div', { class: 'subhead' }, h('h2', { text: title }), action || null)
}

function pageHead(title, description) {
  return h('header', { class: 'page-head' }, h('h1', { text: title }), h('p', { text: description }))
}

function toast(message, kind) {
  const node = $('#toast')
  node.textContent = message
  node.className = 'toast' + (kind ? ' toast--' + kind : '')
  node.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    node.hidden = true
  }, kind === 'error' ? 6500 : 4200)
}

function setDirty(kind, value) {
  app.dirty[kind] = value
  $('#dirty-pill').hidden = !(app.dirty.site || app.dirty.projects)
}

function isDirty() {
  return app.dirty.site || app.dirty.projects
}

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

async function api(path, options = {}) {
  const method = options.method || 'GET'
  const headers = {}
  if (method !== 'GET') headers['X-Studio-Token'] = app.token
  if (options.body) headers['Content-Type'] = 'application/json'
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  let payload = null
  try {
    payload = await response.json()
  } catch (error) {
    payload = null
  }
  if (!response.ok) {
    throw new ApiError((payload && payload.message) || '请求失败（HTTP ' + response.status + '）', response.status, payload)
  }
  return payload
}

async function refreshSession() {
  const session = await api('/api/session')
  app.token = session.token
  app.sitePath = session.sitePath
  app.ffmpeg = session.ffmpeg
  app.lockedSlugs = session.lockedSlugs || []
  $('#site-path').textContent = session.sitePath
  const pill = $('#session-pill')
  pill.className = 'pill ' + (app.ffmpeg ? 'pill--ok' : 'pill--warn')
  pill.textContent = app.ffmpeg ? '本机已连接 · FFmpeg 可用' : '本机已连接 · 未找到 FFmpeg'
  pill.title = app.ffmpeg ? '视频上传可用' : '视频上传不可用：请安装 FFmpeg 并加入 PATH 后重启工作台'
}

async function loadContent() {
  const [site, projects] = await Promise.all([
    api('/api/content/site'),
    api('/api/content/projects'),
  ])
  app.site = site.data
  app.projects = projects.data
  app.dirty.site = false
  app.dirty.projects = false
  $('#dirty-pill').hidden = true
  applyBrand()
  if (!selectedProject() && app.projects.projects.length) {
    const sorted = sortedProjects()
    app.selectedSlug = sorted.length ? sorted[0].slug : null
  }
}

function applyBrand() {
  const mark = document.getElementById('brand-mark')
  if (!mark) return
  const profile = app.site && app.site.profile ? app.site.profile : {}
  const initial = String(profile.initial || profile.name || 'P').trim()
  mark.textContent = Array.from(initial)[0] || 'P'
}

function sortedProjects() {
  return app.projects.projects.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
}

function selectedProject() {
  if (!app.projects) return null
  return app.projects.projects.find((project) => project.slug === app.selectedSlug) || null
}

function isPersisted(project) {
  return Boolean(project && project.__savedSlug)
}

function isLocked(project) {
  return Boolean(project && project.__savedSlug && app.lockedSlugs.includes(project.__savedSlug))
}

function statusLabel(status) {
  return { published: '已发布', draft: '草稿', archived: '已归档' }[status] || status
}

function statusBadge(status) {
  return h('span', { class: 'badge badge--' + status, text: statusLabel(status) })
}

function markProjectDirty() {
  setDirty('projects', true)
}

function parseLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

// ---------- 首页资料 ----------

function renderHome() {
  const root = $('#editor')
  root.replaceChildren()
  const profile = app.site.profile
  const form = h('div', { class: 'form-grid' })
  form.append(
    field('姓名', textInput(profile.name, (value) => { profile.name = value; setDirty('site', true) }), null, false),
    field('头像首字', textInput(profile.initial, (value) => { profile.initial = value; setDirty('site', true) }), null, false),
    field('眉题 Eyebrow', textInput(profile.eyebrow, (value) => { profile.eyebrow = value; setDirty('site', true) })),
    field('主标语', textArea(profile.slogan, (value) => { profile.slogan = value; setDirty('site', true) }, 3)),
    field('个人介绍', textArea(profile.intro, (value) => { profile.intro = value; setDirty('site', true) }, 5)),
    field('技术标签（每行一个）', textArea(profile.tags.join('\n'), (value) => { profile.tags = parseLines(value); setDirty('site', true) }, 5)),
    field('邮箱', textInput(profile.email, (value) => { profile.email = value; setDirty('site', true) }), null, false),
    field('GitHub 链接', textInput(profile.github, (value) => { profile.github = value; setDirty('site', true) }), null, false)
  )
  root.append(
    pageHead('首页资料', '这些内容写入 content/site.json，同步到首页 hero、品牌名与联系方式。'),
    renderAvatarSection(),
    form,
    h('div', { class: 'row-actions' }, button('保存草稿', saveSite, 'btn--primary'))
  )
}

function renderAvatarSection() {
  const profile = app.site.profile
  const avatar = typeof profile.avatar === 'string' ? profile.avatar.trim() : ''
  const card = h('div', { class: 'card avatar-card' })
  card.appendChild(h('div', { class: 'card__head' }, h('span', { class: 'card__title', text: '头像' })))
  const row = h('div', { class: 'avatar-row' })
  const preview = h('div', { class: 'avatar-preview' })
  if (avatar) {
    preview.appendChild(h('img', { src: '/preview/' + avatar, alt: '当前头像' }))
  } else {
    preview.appendChild(h('span', {
      class: 'avatar-preview__letter',
      text: String(profile.initial || profile.name || 'P').slice(0, 1),
    }))
  }
  const info = h('div', { class: 'avatar-info' })
  info.appendChild(h('p', {
    class: 'muted',
    text: avatar
      ? '当前使用本地上传的头像：' + avatar
      : '当前没有本地头像：网站会显示姓名首字。',
  }))
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp',
    style: 'display:none',
  })
  const status = h('p', { class: 'muted avatar-status' })
  const actions = h('div', { class: 'media-item__actions' },
    button('上传头像', () => fileInput.click(), 'btn--small btn--primary')
  )
  if (avatar) {
    actions.appendChild(button('恢复默认', resetAvatar, 'btn--small btn--danger'))
  }
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0]
    fileInput.value = ''
    if (!file) return
    status.textContent = '上传并裁剪中…'
    try {
      const result = await uploadAvatar(file, (ratio) => {
        status.textContent = '上传 ' + Math.round(ratio * 100) + '%'
      })
      profile.avatar = result.avatar
      toast('头像已更新并写入 site.json，发布后正式站生效')
      renderHome()
      refreshPreview()
    } catch (error) {
      status.textContent = '上传失败：' + error.message
      toast(error.message, 'error')
    }
  })
  info.append(actions, fileInput, status)
  row.append(preview, info)
  card.appendChild(row)
  return card
}

function uploadAvatar(file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/avatar')
    request.setRequestHeader('X-Studio-Token', app.token)
    request.responseType = 'json'
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
    })
    request.addEventListener('load', () => {
      const payload = request.response
      if (request.status >= 200 && request.status < 300) {
        resolve(payload)
      } else {
        reject(new Error((payload && payload.message) || '上传失败（HTTP ' + request.status + '）'))
      }
    })
    request.addEventListener('error', () => reject(new Error('上传中断，请重试')))
    request.send(file)
  })
}

async function resetAvatar() {
  try {
    await api('/api/avatar/remove', { method: 'POST', body: {} })
    app.site.profile.avatar = ''
    toast('已恢复默认头像；发布后正式站生效')
    renderHome()
    refreshPreview()
  } catch (error) {
    toast(error.message, 'error')
  }
}

async function saveSite() {
  try {
    const result = await api('/api/content/site', { method: 'PUT', body: { data: app.site } })
    if (!result.ok) {
      showSaveErrors(result)
      return
    }
    setDirty('site', false)
    applyBrand()
    toast(result.warnings && result.warnings.length
      ? '草稿已保存（' + result.warnings.length + ' 个发布前提醒）'
      : '草稿已保存')
    refreshPreview()
  } catch (error) {
    toast(error.message, 'error')
  }
}

function showSaveErrors(result) {
  const first = result.errors && result.errors[0]
  toast('保存失败：' + (first ? first.path + ' · ' + first.message : '内容校验未通过'), 'error')
  renderIssuesToEditor(result)
}

function renderIssuesToEditor(result) {
  const root = $('#editor')
  const existing = root.querySelector('.save-issues')
  if (existing) existing.remove()
  const box = h('div', { class: 'card save-issues' })
  box.appendChild(h('div', { class: 'card__head' }, h('span', { class: 'card__title', text: '需要修正' })))
  const list = h('ul', { class: 'issue-list' })
  for (const issue of result.errors || []) {
    list.appendChild(h('li', { class: 'issue--error' }, issue.path + '：' + issue.message))
  }
  box.appendChild(list)
  root.appendChild(box)
}

// ---------- 关于页 ----------

function renderAbout() {
  const root = $('#editor')
  root.replaceChildren()
  const about = app.site.about
  const form = h('div', { class: 'form-grid' })
  form.append(
    field('关于页介绍', textArea(about.intro, (value) => { about.intro = value; setDirty('site', true) }, 3)),
    field('联系区说明', textArea(about.contactNote, (value) => { about.contactNote = value; setDirty('site', true) }, 2))
  )

  const sections = h('div')

  sections.appendChild(subhead('教育经历', button('添加教育经历', () => {
    about.education.push({ school: '', period: '', detail: '' })
    setDirty('site', true)
    renderAbout()
  }, 'btn--small btn--ghost')))
  about.education.forEach((entry, index) => {
    const card = h('div', { class: 'card' })
    card.appendChild(h('div', { class: 'card__head' },
      h('span', { class: 'card__title', text: '教育 · #' + (index + 1) }),
      button('删除', () => {
        about.education.splice(index, 1)
        setDirty('site', true)
        renderAbout()
      }, 'btn--small btn--danger')
    ))
    const grid = h('div', { class: 'form-grid' })
    grid.append(
      field('学校', textInput(entry.school, (value) => { entry.school = value; setDirty('site', true) })),
      field('时间', textInput(entry.period, (value) => { entry.period = value; setDirty('site', true) })),
      field('专业 / 学历', textInput(entry.detail, (value) => { entry.detail = value; setDirty('site', true) }))
    )
    card.appendChild(grid)
    return sections.appendChild(card)
  })

  sections.appendChild(subhead('实习经历', button('添加实习经历', () => {
    about.internships.push({ company: '', period: '', role: '', bullets: [] })
    setDirty('site', true)
    renderAbout()
  }, 'btn--small btn--ghost')))
  about.internships.forEach((entry, index) => {
    const card = h('div', { class: 'card' })
    card.appendChild(h('div', { class: 'card__head' },
      h('span', { class: 'card__title', text: '实习 · #' + (index + 1) }),
      button('删除', () => {
        about.internships.splice(index, 1)
        setDirty('site', true)
        renderAbout()
      }, 'btn--small btn--danger')
    ))
    const grid = h('div', { class: 'form-grid' })
    grid.append(
      field('公司', textInput(entry.company, (value) => { entry.company = value; setDirty('site', true) })),
      field('时间', textInput(entry.period, (value) => { entry.period = value; setDirty('site', true) })),
      field('角色', textInput(entry.role, (value) => { entry.role = value; setDirty('site', true) })),
      field('成果要点（每行一条）', textArea(entry.bullets.join('\n'), (value) => {
        entry.bullets = parseLines(value)
        setDirty('site', true)
      }, 5))
    )
    card.appendChild(grid)
    sections.appendChild(card)
  })

  sections.appendChild(subhead('技术能力', button('添加能力', () => {
    about.capabilities.push({ title: '', description: '' })
    setDirty('site', true)
    renderAbout()
  }, 'btn--small btn--ghost')))
  about.capabilities.forEach((entry, index) => {
    const card = h('div', { class: 'card' })
    card.appendChild(h('div', { class: 'card__head' },
      h('span', { class: 'card__title', text: '能力 · #' + (index + 1) }),
      button('删除', () => {
        about.capabilities.splice(index, 1)
        setDirty('site', true)
        renderAbout()
      }, 'btn--small btn--danger')
    ))
    const grid = h('div', { class: 'form-grid' })
    grid.append(
      field('标题', textInput(entry.title, (value) => { entry.title = value; setDirty('site', true) })),
      field('说明', textArea(entry.description, (value) => { entry.description = value; setDirty('site', true) }, 3))
    )
    card.appendChild(grid)
    sections.appendChild(card)
  })

  root.append(
    pageHead('关于页', '教育、实习、能力与联系说明写入 content/site.json，右侧预览同步显示。'),
    form,
    sections,
    h('div', { class: 'row-actions' }, button('保存草稿', saveSite, 'btn--primary'))
  )
}

// ---------- 作品 ----------

function renderProjects() {
  const root = $('#editor')
  root.replaceChildren()
  const layout = h('div', { class: 'projects-layout' })
  const listColumn = h('div')
  listColumn.appendChild(subhead('项目列表', button('新建项目', () => {
    createProject()
  }, 'btn--small btn--primary')))
  const list = h('div', { class: 'project-list' })
  sortedProjects().forEach((project) => {
    const row = h('div', {
      class: 'project-row' + (project.slug === app.selectedSlug ? ' is-active' : ''),
      draggable: 'true',
    })
    row.append(
      h('span', { class: 'project-row__drag', text: '⋮⋮', 'aria-hidden': 'true' }),
      h('div', { class: 'project-row__body' },
        h('strong', { text: project.title || project.slug }),
        h('span', { text: project.slug })
      ),
      h('span', { class: 'project-row__badge' }, statusBadge(project.status))
    )
    row.addEventListener('click', () => {
      app.selectedSlug = project.slug
      renderProjects()
    })
    row.addEventListener('dragstart', (event) => {
      app.dragProjectSlug = project.slug
      row.classList.add('is-dragging')
      event.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
      app.dragProjectSlug = null
      row.classList.remove('is-dragging')
    })
    row.addEventListener('dragover', (event) => event.preventDefault())
    row.addEventListener('drop', (event) => {
      event.preventDefault()
      reorderProjects(app.dragProjectSlug, project.slug)
    })
    list.appendChild(row)
  })
  if (!sortedProjects().length) {
    list.appendChild(h('p', { class: 'empty-state', text: '还没有项目，点击“新建项目”开始。' }))
  }
  listColumn.appendChild(list)
  listColumn.appendChild(h('p', { class: 'muted', text: '拖动项目可调整首页与作品页顺序。' }))

  const formColumn = h('div')
  const project = selectedProject()
  if (project) {
    formColumn.appendChild(renderProjectForm(project))
  } else {
    formColumn.appendChild(h('p', { class: 'empty-state', text: '选择左侧项目进行编辑。' }))
  }

  layout.append(listColumn, formColumn)
  root.append(
    pageHead('作品', '编辑项目文字、封面、画面与顺序。slug 首次发布后锁定；归档项目保留内容但不再展示。'),
    layout
  )

  if (!project) return
  if (project.__focusMediaId) {
    const target = document.getElementById('media-' + project.__focusMediaId)
    if (target) target.scrollIntoView({ block: 'center' })
    delete project.__focusMediaId
  }
}

function createProject() {
  const existing = new Set(app.projects.projects.map((project) => project.slug))
  let base = 'new-project'
  let slug = base
  let index = 2
  while (existing.has(slug)) {
    slug = base + '-' + index
    index += 1
  }
  const project = {
    slug,
    status: 'draft',
    order: app.projects.projects.length + 1,
    category: '个人项目',
    title: '新项目',
    tagline: '',
    role: '',
    summary: '',
    stack: [],
    proof: [{ value: '', label: '' }],
    overview: '',
    sections: [{ title: '', body: '' }],
    evidence: {},
    sourceUrl: '',
    coverMediaId: null,
    media: [],
  }
  Object.defineProperty(project, '__savedSlug', { value: null, writable: true, enumerable: false, configurable: true })
  app.projects.projects.push(project)
  app.selectedSlug = project.slug
  markProjectDirty()
  renderProjects()
}

function reorderProjects(fromSlug, toSlug) {
  if (!fromSlug || !toSlug || fromSlug === toSlug) return
  const ordered = sortedProjects()
  const fromIndex = ordered.findIndex((project) => project.slug === fromSlug)
  const toIndex = ordered.findIndex((project) => project.slug === toSlug)
  if (fromIndex < 0 || toIndex < 0) return
  const [moved] = ordered.splice(fromIndex, 1)
  ordered.splice(toIndex, 0, moved)
  ordered.forEach((project, index) => {
    project.order = index + 1
  })
  app.projects.projects = ordered
  markProjectDirty()
  renderProjects()
}

function renderProjectForm(project) {
  const form = h('div')
  const locked = isLocked(project)

  form.appendChild(h('div', { class: 'card__head' },
    h('span', { class: 'card__title', text: '编辑项目' }),
    h('span', { class: 'muted', text: isPersisted(project) ? (locked ? 'slug 已锁定' : '尚未锁定 slug') : '尚未保存' })
  ))

  const basics = h('div', { class: 'form-grid' })
  basics.append(
    field('项目 slug', textInput(project.slug, (value) => {
      const oldSlug = project.slug
      project.slug = value
      rewriteMediaPrefix(project, oldSlug, value)
      app.selectedSlug = value
    }, { disabled: locked, placeholder: 'lowercase-with-dashes' }),
      locked ? '已发布，slug 已锁定以保持详情地址稳定' : '只能包含小写字母、数字和连字符；发布后锁定', false),
    field('状态', selectInput(project.status, [
      { value: 'draft', label: '草稿（不展示）' },
      { value: 'published', label: '已发布（展示）' },
      { value: 'archived', label: '已归档（不展示）' },
    ], (value) => {
      project.status = value
      markProjectDirty()
      renderProjects()
    }), null, false),
    field('分类', textInput(project.category, (value) => { project.category = value; markProjectDirty() })),
    field('角色', textInput(project.role, (value) => { project.role = value; markProjectDirty() })),
    field('标题', textInput(project.title, (value) => { project.title = value; markProjectDirty() })),
    field('一句话定位', textInput(project.tagline, (value) => { project.tagline = value; markProjectDirty() })),
    field('摘要', textArea(project.summary, (value) => { project.summary = value; markProjectDirty() }, 3)),
    field('技术栈（每行一个）', textArea(project.stack.join('\n'), (value) => { project.stack = parseLines(value); markProjectDirty() }, 4))
  )
  form.appendChild(basics)

  form.appendChild(field('项目概览', textArea(project.overview, (value) => { project.overview = value; markProjectDirty() }, 4), null, true))
  form.appendChild(field('源码链接（可留空）', textInput(project.sourceUrl, (value) => { project.sourceUrl = value; markProjectDirty() })))

  const coverOptions = [{ value: '', label: '无封面（使用工程占位）' }].concat(
    project.media.map((item) => ({
      value: item.id,
      label: (item.tag || item.caption || item.id) + ' · ' + (item.type === 'video' ? '视频' : '图片'),
    }))
  )
  form.appendChild(field('封面', selectInput(project.coverMediaId || '', coverOptions, (value) => {
    project.coverMediaId = value || null
    markProjectDirty()
    renderProjects()
  }), '没有封面时，站点会渲染橙色工程占位画面。'))

  form.appendChild(subhead('工程成果（proof）', button('添加成果', () => {
    project.proof.push({ value: '', label: '' })
    markProjectDirty()
    renderProjects()
  }, 'btn--small btn--ghost')))
  project.proof.forEach((item, index) => {
    form.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card__head' },
        h('span', { class: 'card__title', text: '成果 · #' + (index + 1) }),
        button('删除', () => {
          project.proof.splice(index, 1)
          markProjectDirty()
          renderProjects()
        }, 'btn--small btn--danger')
      ),
      h('div', { class: 'form-grid' },
        field('数值', textInput(item.value, (value) => { item.value = value; markProjectDirty() })),
        field('说明', textInput(item.label, (value) => { item.label = value; markProjectDirty() }))
      )
    ))
  })

  form.appendChild(subhead('详情段落', button('添加段落', () => {
    project.sections.push({ title: '', body: '' })
    markProjectDirty()
    renderProjects()
  }, 'btn--small btn--ghost')))
  project.sections.forEach((section, index) => {
    form.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card__head' },
        h('span', { class: 'card__title', text: '段落 · #' + (index + 1) }),
        button('删除', () => {
          project.sections.splice(index, 1)
          markProjectDirty()
          renderProjects()
        }, 'btn--small btn--danger')
      ),
      field('标题', textInput(section.title, (value) => { section.title = value; markProjectDirty() })),
      field('正文', textArea(section.body, (value) => { section.body = value; markProjectDirty() }, 4))
    ))
  })

  form.appendChild(subhead('工程证据（evidence）', button('添加证据', () => {
    const key = 'evidence' + (Object.keys(project.evidence).length + 1)
    project.evidence[key] = ''
    markProjectDirty()
    renderProjects()
  }, 'btn--small btn--ghost')))
  Object.keys(project.evidence).forEach((key) => {
    let currentKey = key
    form.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card__head' },
        h('span', { class: 'card__title', text: '证据' }),
        button('删除', () => {
          delete project.evidence[currentKey]
          markProjectDirty()
          renderProjects()
        }, 'btn--small btn--danger')
      ),
      field('键名（deployment / modelEvaluation / offlineVerification 会显示中文标签）', textInput(currentKey, (value) => {
        const nextKey = value.trim()
        if (!nextKey || nextKey === currentKey) return
        if (Object.prototype.hasOwnProperty.call(project.evidence, nextKey)) {
          toast('证据键名已存在：' + nextKey, 'warn')
          return
        }
        project.evidence[nextKey] = project.evidence[currentKey]
        delete project.evidence[currentKey]
        currentKey = nextKey
        markProjectDirty()
      })),
      field('内容', textArea(project.evidence[currentKey], (value) => { project.evidence[currentKey] = value; markProjectDirty() }, 3))
    ))
  })

  form.appendChild(renderMediaManager(project))

  form.appendChild(h('div', { class: 'row-actions' },
    button('保存草稿', saveProjects, 'btn--primary')
  ))
  return form
}

function rewriteMediaPrefix(project, oldSlug, newSlug) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return
  const fromPrefix = 'media/projects/' + oldSlug + '/'
  const toPrefix = 'media/projects/' + newSlug + '/'
  for (const item of project.media) {
    if (typeof item.src === 'string' && item.src.startsWith(fromPrefix)) {
      item.src = toPrefix + item.src.slice(fromPrefix.length)
    }
    if (typeof item.poster === 'string' && item.poster.startsWith(fromPrefix)) {
      item.poster = toPrefix + item.poster.slice(fromPrefix.length)
    }
  }
  markProjectDirty()
}

function renderMediaManager(project) {
  const section = h('div')
  section.appendChild(subhead('项目画面（工程胶片）', null))
  section.appendChild(h('p', { class: 'muted', text: '拖拽上传图片或视频。图片自动转 WebP（最长边 1920、≤2 MiB）；视频压成 MP4（≤1080p、≤12 秒、≤18 MiB）并生成封面。' }))

  const persisted = isPersisted(project)
  const zone = h('div', {
    class: 'dropzone' + (persisted ? '' : ' is-busy'),
    role: 'button',
    tabindex: '0',
  })
  zone.appendChild(h('span', { text: persisted ? '拖拽文件到这里，或点击选择' : '先保存项目，再上传媒体' }))
  zone.appendChild(h('small', { text: 'JPG / PNG / WebP · MP4 / MOV / WebM' }))
  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    accept: 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm',
    style: 'display:none',
  })
  zone.appendChild(fileInput)
  const statusSlot = h('div', { class: 'upload-status' })
  const progress = h('div', { class: 'progress' }, h('span'))
  const progressBar = progress.firstChild

  function openPicker() {
    if (!persisted) {
      toast('请先保存项目，再上传媒体', 'warn')
      return
    }
    fileInput.click()
  }

  zone.addEventListener('click', openPicker)
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') openPicker()
  })
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || [])
    fileInput.value = ''
    if (files.length) uploadSequentially(project, files, zone, statusSlot, progress, progressBar)
  })
  zone.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (persisted) zone.classList.add('is-over')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'))
  zone.addEventListener('drop', (event) => {
    event.preventDefault()
    zone.classList.remove('is-over')
    if (!persisted) {
      toast('请先保存项目，再上传媒体', 'warn')
      return
    }
    const files = Array.from(event.dataTransfer.files || [])
    if (files.length) uploadSequentially(project, files, zone, statusSlot, progress, progressBar)
  })

  section.appendChild(zone)
  section.appendChild(statusSlot)
  section.appendChild(progress)

  const list = h('div', { class: 'media-list' })
  if (!project.media.length) {
    list.appendChild(h('p', { class: 'empty-state', text: '还没有画面。上传图片或视频后会出现在这里，可拖拽排序。' }))
  }
  project.media.forEach((item, index) => {
    const row = h('div', { class: 'media-item', id: 'media-' + item.id, draggable: 'true' })
    row.addEventListener('dragstart', (event) => {
      app.dragMediaId = item.id
      row.classList.add('is-dragging')
      event.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
      app.dragMediaId = null
      row.classList.remove('is-dragging')
    })
    row.addEventListener('dragover', (event) => event.preventDefault())
    row.addEventListener('drop', (event) => {
      event.preventDefault()
      reorderMedia(project, app.dragMediaId, item.id)
    })

    const thumb = h('div', { class: 'media-item__thumb' })
    const previewSrc = item.type === 'video' ? item.poster : item.src
    if (previewSrc) {
      thumb.appendChild(h('img', { src: '/preview/' + previewSrc, alt: '', loading: 'lazy' }))
    } else {
      thumb.textContent = item.type === 'video' ? '视频（无封面）' : '图片'
    }

    const fields = h('div', { class: 'media-item__fields' })
    fields.appendChild(h('div', { class: 'media-item__row' },
      h('span', { class: 'media-item__id', text: String(index + 1).padStart(2, '0') + ' · ' + item.id }),
      item.id === project.coverMediaId ? h('span', { class: 'badge badge--published', text: '封面' }) : null
    ))
    fields.appendChild(textInput(item.alt || '', (value) => {
      item.alt = value
      markProjectDirty()
    }, { placeholder: '替代文本（发布必填，描述画面内容）' }))
    fields.appendChild(textInput(item.caption || '', (value) => {
      item.caption = value
      markProjectDirty()
    }, { placeholder: '画面说明（显示在胶片条下方）' }))
    fields.appendChild(textInput(item.tag || '', (value) => {
      item.tag = value
      markProjectDirty()
    }, { placeholder: '功能标签（显示在胶片条头部）' }))
    fields.appendChild(h('div', { class: 'media-item__actions' },
      button('设为封面', () => {
        project.coverMediaId = item.id
        markProjectDirty()
        renderProjects()
      }, 'btn--small btn--ghost'),
      button('移除引用', () => {
        removeMediaReference(project, item)
      }, 'btn--small btn--danger')
    ))
    row.append(thumb, fields)
    list.appendChild(row)
  })
  section.appendChild(list)
  return section
}

function reorderMedia(project, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return
  const fromIndex = project.media.findIndex((item) => item.id === fromId)
  const toIndex = project.media.findIndex((item) => item.id === toId)
  if (fromIndex < 0 || toIndex < 0) return
  const [moved] = project.media.splice(fromIndex, 1)
  project.media.splice(toIndex, 0, moved)
  markProjectDirty()
  renderProjects()
}

function removeMediaReference(project, item) {
  const index = project.media.indexOf(item)
  if (index < 0) return
  project.media.splice(index, 1)
  if (project.coverMediaId === item.id) project.coverMediaId = null
  markProjectDirty()
  toast('已从页面引用中移除；文件仍保留在素材库，可在“清理未使用素材”中处理', 'warn')
  renderProjects()
}

async function uploadSequentially(project, files, zone, statusSlot, progress, progressBar) {
  zone.classList.add('is-busy')
  statusSlot.textContent = '准备上传…'
  progress.hidden = false
  for (const file of files) {
    statusSlot.textContent = '上传并处理：' + file.name
    progressBar.style.width = '0%'
    try {
      const result = await uploadFile(project, file, (ratio) => {
        progressBar.style.width = Math.round(ratio * 100) + '%'
        statusSlot.textContent = '上传 ' + file.name + '：' + Math.round(ratio * 100) + '%'
      })
      project.media.push(result.media)
      markProjectDirty()
      statusSlot.textContent = '已处理：' + file.name
    } catch (error) {
      statusSlot.textContent = '失败：' + file.name + ' — ' + error.message
      toast(file.name + '：' + error.message, 'error')
    }
  }
  zone.classList.remove('is-busy')
  progress.hidden = true
  app.selectedSlug = project.slug
  renderProjects()
}

function uploadFile(project, file, onProgress) {
  return new Promise((resolve, reject) => {
    const kind = file.type && file.type.startsWith('video/') ? 'video' : 'image'
    if (!['image', 'video'].includes(kind)) {
      reject(new Error('不支持的文件类型'))
      return
    }
    const query = '?project=' + encodeURIComponent(project.slug) +
      '&kind=' + kind +
      '&name=' + encodeURIComponent(file.name)
    const request = new XMLHttpRequest()
    request.open('POST', '/api/media' + query)
    request.setRequestHeader('X-Studio-Token', app.token)
    request.responseType = 'json'
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
    })
    request.addEventListener('load', () => {
      const payload = request.response
      if (request.status >= 200 && request.status < 300 && payload && payload.token) {
        api('/api/media/convert', { method: 'POST', body: { token: payload.token } })
          .then(resolve, reject)
      } else {
        reject(new Error((payload && payload.message) || '上传失败（HTTP ' + request.status + '）'))
      }
    })
    request.addEventListener('error', () => reject(new Error('上传中断，请重试')))
    request.send(file)
  })
}

function serializeProjects() {
  const ordered = sortedProjects().map((project) => project)
  return {
    version: app.projects.version || 1,
    projects: JSON.parse(JSON.stringify(ordered)),
  }
}

async function saveProjects() {
  const projects = app.projects.projects
  for (const project of projects) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(project.slug || '')) {
      toast('slug 不合法：' + project.slug + '（只能包含小写字母、数字和连字符）', 'error')
      return false
    }
  }
  const renames = []
  for (const project of projects) {
    if (project.__savedSlug && project.__savedSlug !== project.slug) {
      renames.push({ from: project.__savedSlug, to: project.slug })
    }
  }
  try {
    const result = await api('/api/content/projects', {
      method: 'PUT',
      body: { data: serializeProjects(), renames },
    })
    if (!result.ok) {
      showSaveErrors(result)
      return false
    }
    for (const project of projects) {
      project.__savedSlug = project.slug
    }
    setDirty('projects', false)
    toast(result.warnings && result.warnings.length
      ? '草稿已保存（' + result.warnings.length + ' 个发布前提醒）'
      : '草稿已保存')
    refreshPreview()
    return true
  } catch (error) {
    toast(error.message, 'error')
    return false
  }
}

// ---------- 素材库 ----------

async function renderMediaLibrary() {
  const root = $('#editor')
  root.replaceChildren()
  root.appendChild(pageHead('素材库', '查看 media/projects/ 下的所有文件。删除默认只移除页面引用；“清理未使用素材”会在确认后删除文件。'))

  let listing
  try {
    listing = await api('/api/media')
  } catch (error) {
    root.appendChild(h('p', { class: 'empty-state', text: '读取素材库失败：' + error.message }))
    return
  }

  const total = (listing.totalBytes / 1024 / 1024).toFixed(1)
  const limit = (listing.totalLimit / 1024 / 1024).toFixed(0)
  const unused = listing.files.filter((file) => file.references.length === 0)
  root.appendChild(h('div', { class: 'summary-bar' },
    h('span', { text: '文件 ' + listing.files.length + ' 个' }),
    h('span', { text: '总大小 ' + total + ' MiB / ' + limit + ' MiB' }),
    h('span', { text: '未引用 ' + unused.length + ' 个' }),
    button('扫描未使用素材', scanCleanup, 'btn--small btn--ghost'),
    button('刷新', renderMediaLibrary, 'btn--small btn--ghost')
  ))

  const table = h('table', { class: 'table' })
  table.appendChild(h('thead', {}, h('tr', {},
    h('th', { text: '文件' }),
    h('th', { text: '类型' }),
    h('th', { text: '大小' }),
    h('th', { text: '引用' })
  )))
  const tbody = h('tbody')
  for (const file of listing.files) {
    const refs = file.references.length
      ? file.references.map((ref) => ref.project + ' · ' + ref.mediaId + '（' + ref.field + '）').join('；')
      : '未引用'
    tbody.appendChild(h('tr', { class: refs === '未引用' ? 'is-unused' : '' },
      h('td', {}, h('code', { text: file.path })),
      h('td', { text: file.type }),
      h('td', { text: (file.size / 1024).toFixed(0) + ' KiB' }),
      h('td', { text: refs })
    ))
  }
  table.appendChild(tbody)
  root.appendChild(h('div', { class: 'table-wrap' }, table))

  const cleanupBox = h('div', { class: 'cleanup-box' })
  root.appendChild(cleanupBox)
}

async function scanCleanup() {
  const box = $('.cleanup-box')
  if (!box) return
  box.replaceChildren()
  try {
    const result = await api('/api/media/cleanup', { method: 'POST' })
    const candidates = result.candidates || []
    if (!candidates.length) {
      box.appendChild(h('p', { class: 'muted', text: '没有未使用的素材文件。' }))
      return
    }
    box.appendChild(subhead('待删除文件（' + candidates.length + ' 个）', null))
    const list = h('div')
    for (const file of candidates) {
      list.appendChild(h('label', { class: 'cleanup-row' },
        h('input', { type: 'checkbox', value: file.path, 'data-cleanup': 'true', checked: true }),
        h('code', { text: file.path }),
        h('span', { class: 'muted', text: ' ' + (file.size / 1024).toFixed(0) + ' KiB' })
      ))
    }
    box.appendChild(list)
    box.appendChild(h('div', { class: 'row-actions' },
      button('确认删除选中文件', confirmCleanup, 'btn--danger')
    ))
  } catch (error) {
    toast(error.message, 'error')
  }
}

async function confirmCleanup() {
  const checked = Array.from(document.querySelectorAll('input[data-cleanup]'))
    .filter((node) => node.checked)
    .map((node) => node.value)
  if (!checked.length) {
    toast('没有选中文件', 'warn')
    return
  }
  if (!window.confirm('将永久删除 ' + checked.length + ' 个未引用文件（本地 Docker 外的 media/ 目录）。内容 JSON 不会受影响。继续？')) return
  try {
    const result = await api('/api/media/cleanup/confirm', { method: 'POST', body: { files: checked } })
    toast('已删除 ' + result.deleted.length + ' 个文件')
    await renderMediaLibrary()
  } catch (error) {
    toast(error.message, 'error')
  }
}

// ---------- 发布 ----------

function renderPublish() {
  const root = $('#editor')
  root.replaceChildren()
  root.append(
    pageHead('发布', '校验 → 运行站点测试 → Git 前置检查 → 只暂存 content/ 与 media/ → 提交 → 推送 → 等待正式域名更新。'),
    h('div', { class: 'card' },
      h('p', { class: 'muted', text: '发布不会包含 docs/open-api-guide.md 等无关修改；如果暂存区已有文件或本地分支落后，会停止并提示。' }),
      h('div', { class: 'row-actions' },
        button('运行校验', runValidation, 'btn--ghost'),
        button('发布到正式站', startPublish, 'btn--primary')
      )
    ),
    h('div', { id: 'validation-box' }),
    h('div', { id: 'publish-box' })
  )
  if (app.publishStatus) renderPublishStatus(app.publishStatus)
}

async function runValidation() {
  const box = $('#validation-box')
  box.replaceChildren(h('p', { class: 'muted', text: '正在校验…' }))
  try {
    const result = await api('/api/validate', { method: 'POST' })
    box.replaceChildren()
    box.appendChild(subhead('校验结果', null))
    if (!result.errors.length && !result.warnings.length) {
      box.appendChild(h('p', { class: 'publish-message is-ok', text: '校验通过，可以发布。' }))
      return
    }
    const list = h('ul', { class: 'issue-list' })
    for (const issue of result.errors) {
      list.appendChild(h('li', { class: 'issue--error' }, issue.path + '：' + issue.message))
    }
    for (const issue of result.warnings) {
      list.appendChild(h('li', { class: 'issue--warning' }, issue.path + '：' + issue.message))
    }
    box.appendChild(list)
    box.appendChild(h('p', { class: 'muted', text: '错误会阻止发布；提醒不会阻止，但建议处理。' }))
  } catch (error) {
    box.replaceChildren(h('p', { class: 'publish-message is-error', text: error.message }))
  }
}

async function startPublish() {
  const confirmed = window.confirm('将运行站点测试并推送 content/ 与 media/ 到 origin/main，随后等待正式域名更新。继续？')
  if (!confirmed) return
  try {
    const status = await api('/api/publish', { method: 'POST' })
    app.publishStatus = status
    renderPublishStatus(status)
    ensurePublishStream()
  } catch (error) {
    toast(error.message, 'error')
  }
}

function ensurePublishStream() {
  if (app.stream) return
  const source = new EventSource('/api/publish/events')
  app.stream = source
  source.addEventListener('status', (event) => {
    try {
      const status = JSON.parse(event.data)
      app.publishStatus = status
      if (app.view === 'publish') renderPublishStatus(status)
      if (status.outcome === 'published' && status.finishedAt !== app.lastOutcome) {
        app.lastOutcome = status.finishedAt
        refreshSession().catch(() => {})
        toast('发布完成，正式站已更新', 'ok')
      }
    } catch (error) {
      // 忽略格式错误的事件
    }
  })
}

function renderPublishStatus(status) {
  const box = $('#publish-box')
  if (!box) return
  box.replaceChildren()
  const steps = h('ul', { class: 'steps' })
  for (const step of status.steps || []) {
    const icon = {
      pending: '·',
      running: '…',
      passed: '✓',
      failed: '✕',
      skipped: '—',
      timeout: '!',
    }[step.status] || '·'
    const details = h('div', { class: 'step__title' },
      h('span', { text: step.label }),
      h('span', { class: 'step__detail', text: step.detail || '' })
    )
    if (step.log) details.appendChild(h('pre', { class: 'step__log', text: step.log }))
    steps.appendChild(h('li', { class: 'step step--' + step.status },
      h('span', { class: 'step__icon', text: icon }),
      details
    ))
  }
  box.appendChild(steps)
  if (status.message) {
    const kind = status.outcome === 'failed'
      ? 'is-error'
      : status.outcome === 'published'
        ? 'is-ok'
        : status.outcome === 'pushed-pending-deploy' || status.outcome === 'no-changes'
          ? 'is-warn'
          : ''
    box.appendChild(h('p', { class: 'publish-message ' + kind, text: status.message }))
  }
}

// ---------- 视图与预览 ----------

function previewUrlForView() {
  if (app.view === 'projects') {
    const project = selectedProject()
    if (project && project.__savedSlug) {
      return '/preview/project.html?id=' + encodeURIComponent(project.__savedSlug)
    }
    return '/preview/projects.html'
  }
  return {
    home: '/preview/index.html',
    about: '/preview/about.html',
    media: '/preview/projects.html',
    publish: '/preview/index.html',
  }[app.view] || '/preview/index.html'
}

function setPreview(url) {
  const frame = $('#preview-frame')
  frame.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'rev=' + Date.now()
}

function refreshPreview() {
  setPreview(previewUrlForView())
}

function updateTabs() {
  document.querySelectorAll('#tabs button').forEach((buttonNode) => {
    buttonNode.classList.toggle('is-active', buttonNode.dataset.view === app.view)
  })
}

async function renderView(view) {
  app.view = view
  updateTabs()
  const panel = $('#preview-panel')
  const full = view === 'media' || view === 'publish'
  panel.hidden = full
  $('#workspace').classList.toggle('workspace--full', full)
  if (view === 'home') {
    renderHome()
    setPreview(previewUrlForView())
  } else if (view === 'about') {
    renderAbout()
    setPreview(previewUrlForView())
  } else if (view === 'projects') {
    renderProjects()
    setPreview(previewUrlForView())
  } else if (view === 'media') {
    await renderMediaLibrary()
  } else if (view === 'publish') {
    renderPublish()
    ensurePublishStream()
    try {
      app.publishStatus = await api('/api/publish/status')
      renderPublishStatus(app.publishStatus)
    } catch (error) {
      // 忽略，SSE 会继续推送
    }
  }
}

async function switchView(view) {
  if (view === app.view) return
  if (isDirty()) {
    const discard = window.confirm('有未保存的修改，切换视图会丢弃这些修改。继续？')
    if (!discard) return
    await loadContent()
  }
  await renderView(view)
}

function bindTabs() {
  document.querySelectorAll('#tabs button').forEach((buttonNode) => {
    buttonNode.addEventListener('click', () => {
      switchView(buttonNode.dataset.view)
    })
  })
}

window.addEventListener('beforeunload', (event) => {
  if (!isDirty()) return
  event.preventDefault()
  event.returnValue = ''
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason && event.reason.message ? event.reason.message : '未知错误'
  toast('操作失败：' + reason, 'error')
})

function openHelp() {
  const modal = $('#help-modal')
  if (!modal) return
  modal.hidden = false
  const closeButton = modal.querySelector('[data-close-help]')
  if (closeButton) closeButton.focus()
}

function closeHelp() {
  const modal = $('#help-modal')
  if (!modal) return
  modal.hidden = true
  try {
    localStorage.setItem('studio-help-seen', '1')
  } catch (error) {
    // 隐私模式下 localStorage 可能不可用，忽略即可。
  }
}

function bindHelp() {
  const modal = $('#help-modal')
  const button = $('#help-button')
  if (!modal || !button) return
  button.addEventListener('click', openHelp)
  modal.querySelectorAll('[data-close-help]').forEach((node) => {
    node.addEventListener('click', closeHelp)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeHelp()
  })
  let seen = false
  try {
    seen = localStorage.getItem('studio-help-seen') === '1'
  } catch (error) {
    seen = false
  }
  if (!seen) modal.hidden = false
}

async function init() {
  bindTabs()
  bindHelp()
  $('#refresh-preview').addEventListener('click', refreshPreview)
  try {
    await refreshSession()
    await loadContent()
    await renderView('home')
  } catch (error) {
    const editor = $('#editor')
    editor.replaceChildren(h('p', { class: 'empty-state', text: '工作台初始化失败：' + error.message }))
    const pill = $('#session-pill')
    pill.className = 'pill pill--error'
    pill.textContent = '未连接'
  }
}

init()
