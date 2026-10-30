'use strict'

;(function () {
  const Studio = window.Studio || (window.Studio = {})
  Studio.renderers = Studio.renderers || {}
  Studio.registerViewType = function registerViewType(type, renderer) {
    Studio.renderers[type] = renderer
  }

  const app = {
    token: '',
    sitePath: '',
    ffmpeg: false,
    lockedSlugs: [],
    adapter: null,
    manifest: null,
    documents: {},
    descriptors: new Map(),
    capabilities: { avatar: null, media: [] },
    dirty: new Set(),
    view: null,
    selections: {},
    stream: null,
    publishStatus: null,
    lastOutcome: null,
  }
  Studio.state = app

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
    for (const option of options || []) {
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
    return h('header', { class: 'page-head' }, h('h1', { text: title }), description ? h('p', { text: description }) : null)
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

  function getPath(target, pathParts) {
    let current = target
    for (const part of pathParts || []) {
      if (current === null || current === undefined || typeof current !== 'object') return undefined
      current = current[part]
    }
    return current
  }

  function setPath(target, pathParts, value) {
    let current = target
    for (let index = 0; index < pathParts.length - 1; index += 1) {
      const part = pathParts[index]
      if (!current[part] || typeof current[part] !== 'object') current[part] = {}
      current = current[part]
    }
    current[pathParts[pathParts.length - 1]] = value
  }

  function pathLabel(pathParts) {
    return (pathParts || []).join('.')
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

  function markDirty(docId) {
    app.dirty.add(docId)
    updateDirtyPill()
  }

  function clearDirty(docId) {
    app.dirty.delete(docId)
    updateDirtyPill()
  }

  function isDirty() {
    return app.dirty.size > 0
  }

  function updateDirtyPill() {
    const pill = $('#dirty-pill')
    if (!pill) return
    pill.hidden = !isDirty()
  }

  function descriptor(id) {
    return app.descriptors.get(id) || null
  }

  function getDocument(id) {
    return app.documents[id]
  }

  function rememberIdentities(id) {
    const doc = descriptor(id)
    const data = getDocument(id)
    if (!doc || doc.kind !== 'collection' || !data) return
    const items = Array.isArray(data[doc.itemsKey]) ? data[doc.itemsKey] : []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      Object.defineProperty(item, '__studioSaved', {
        value: item[doc.identityField],
        writable: true,
        enumerable: false,
        configurable: true,
      })
    }
  }

  function collectRenames(id) {
    const doc = descriptor(id)
    const data = getDocument(id)
    const renames = []
    if (!doc || doc.kind !== 'collection' || !data) return renames
    const items = Array.isArray(data[doc.itemsKey]) ? data[doc.itemsKey] : []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const saved = item.__studioSaved
      const current = item[doc.identityField]
      if (saved && current && saved !== current) renames.push({ from: saved, to: current })
    }
    return renames
  }

  async function reloadDocument(id) {
    const response = await api('/api/content/' + encodeURIComponent(id))
    app.documents[id] = response.data
    rememberIdentities(id)
  }

  async function loadDocuments() {
    for (const doc of app.descriptors.values()) {
      await reloadDocument(doc.id)
    }
  }

  function applyBrand() {
    const mark = $('#brand-mark')
    const name = $('#brand-name')
    const documents = Object.keys(app.documents).map((key) => app.documents[key]).filter(Boolean)
    const first = documents[0] || {}
    const profile = first.profile || first
    const title = typeof profile.name === 'string' && profile.name ? profile.name : ''
    if (mark) mark.textContent = title ? Array.from(title)[0] : 'P'
    if (name) name.textContent = '内容工作台'
  }

  async function refreshSession() {
    const session = await api('/api/session')
    app.token = session.token
    app.sitePath = session.sitePath
    app.ffmpeg = session.ffmpeg
    app.lockedSlugs = session.lockedSlugs || []
    app.adapter = session.adapter
    app.manifest = session.manifest
    app.capabilities = session.capabilities || { avatar: null, media: [] }
    app.descriptors = new Map((session.documents || []).map((doc) => [doc.id, doc]))
    $('#site-path').textContent = session.sitePath
    const pill = $('#session-pill')
    pill.className = 'pill ' + (app.ffmpeg ? 'pill--ok' : 'pill--warn')
    pill.textContent = app.ffmpeg ? '本机已连接 · FFmpeg 可用' : '本机已连接 · 未找到 FFmpeg'
    pill.title = app.ffmpeg ? '视频上传可用' : '视频上传不可用：请安装 FFmpeg 并加入 PATH 后重启工作台'
    applyBrand()
  }

  function views() {
    return (app.manifest && app.manifest.views) || []
  }

  function currentView() {
    return app.view
  }

  function previewPath(view) {
    if (!view) return '/'
    if (view.type === 'collection' && view.itemPreview) {
      const doc = descriptor(view.document)
      const data = getDocument(view.document)
      const key = app.selections[view.id]
      if (doc && data) {
        const items = Array.isArray(data[doc.itemsKey]) ? data[doc.itemsKey] : []
        const item = items.find((entry) => entry && entry[doc.identityField] === key)
        const saved = item && item.__studioSaved
        if (saved) return view.itemPreview.split('{id}').join(encodeURIComponent(saved))
      }
    }
    return view.preview || '/'
  }

  function setPreview(url) {
    const frame = $('#preview-frame')
    frame.src = '/preview' + (url.startsWith('/') ? url : '/' + url) +
      (url.indexOf('?') >= 0 ? '&' : '?') + 'rev=' + Date.now()
  }

  function refreshPreview() {
    if (!app.view) return
    const full = app.view.type === 'media' || app.view.type === 'publish'
    if (full) return
    setPreview(previewPath(app.view))
  }

  function renderTabs() {
    const tabs = $('#tabs')
    tabs.replaceChildren()
    for (const view of views()) {
      const tab = h('button', {
        type: 'button',
        class: view.id === (app.view && app.view.id) ? 'is-active' : '',
        text: view.label || view.id,
      })
      tab.addEventListener('click', () => switchView(view.id))
      tabs.appendChild(tab)
    }
  }

  async function switchView(viewId) {
    if (app.view && app.view.id === viewId) return
    if (isDirty()) {
      const discard = window.confirm('有未保存的修改，切换视图会丢弃这些修改。继续？')
      if (!discard) return
      app.dirty.clear()
      updateDirtyPill()
      await loadDocuments()
    }
    renderView(viewId)
  }

  function renderView(viewId) {
    const view = views().find((entry) => entry.id === viewId) || views()[0]
    if (!view) {
      $('#editor').replaceChildren(h('p', { class: 'empty-state', text: '适配器没有提供任何视图' }))
      return
    }
    app.view = view
    renderTabs()
    const full = view.type === 'media' || view.type === 'publish'
    $('#preview-panel').hidden = full
    $('#workspace').classList.toggle('workspace--full', full)
    const editor = $('#editor')
    editor.replaceChildren()
    const custom = view.type === 'custom' && Studio.viewComponents.get(view.component)
    const renderer = custom || Studio.renderers[view.type]
    if (!renderer) {
      editor.appendChild(h('p', { class: 'empty-state', text: '未知视图类型：' + view.type }))
      return
    }
    try {
      renderer(view, editor)
    } catch (error) {
      console.error(error)
      editor.appendChild(h('p', { class: 'empty-state', text: '视图渲染失败：' + error.message }))
    }
    refreshPreview()
  }

  function showSaveErrors(result) {
    const first = result.errors && result.errors[0]
    toast('保存失败：' + (first ? first.path + ' · ' + first.message : '内容校验未通过'), 'error')
    const editor = $('#editor')
    const existing = editor.querySelector('.save-issues')
    if (existing) existing.remove()
    const box = h('div', { class: 'card save-issues' })
    box.appendChild(h('div', { class: 'card__head' }, h('span', { class: 'card__title', text: '需要修正' })))
    const list = h('ul', { class: 'issue-list' })
    for (const issue of result.errors || []) {
      list.appendChild(h('li', { class: 'issue--error' }, issue.path + '：' + issue.message))
    }
    box.appendChild(list)
    editor.appendChild(box)
  }

  async function saveDocument(id) {
    try {
      const result = await api('/api/content/' + encodeURIComponent(id), {
        method: 'PUT',
        body: { data: getDocument(id), renames: collectRenames(id) },
      })
      if (!result.ok) {
        showSaveErrors(result)
        return false
      }
      clearDirty(id)
      await reloadDocument(id)
      applyBrand()
      toast(result.warnings && result.warnings.length
        ? '草稿已保存（' + result.warnings.length + ' 个发布前提醒）'
        : '草稿已保存')
      renderView(app.view.id)
      return true
    } catch (error) {
      toast(error.message, 'error')
      return false
    }
  }

  function blankFromFields(fields) {
    const item = {}
    for (const spec of fields || []) {
      if (typeof spec.path === 'string') setPath(item, [spec.path], defaultFor(spec))
      else if (Array.isArray(spec.path)) setPath(item, spec.path, defaultFor(spec))
    }
    return item
  }

  function defaultFor(spec) {
    if (spec.type === 'stringList' || spec.type === 'objectList') return []
    if (spec.type === 'keyValue') return {}
    if (spec.type === 'boolean') return false
    if (spec.type === 'number') return 0
    return ''
  }

  function renderField(spec, target, docId, rerender) {
    const pathParts = Array.isArray(spec.path) ? spec.path : [spec.path]
    const value = getPath(target, pathParts)
    const onChange = (next) => {
      setPath(target, pathParts, next)
      markDirty(docId)
    }
    const hint = spec.hint
    if (spec.type === 'textarea') {
      return field(spec.label, textArea(value, onChange, spec.rows || 3, { placeholder: spec.placeholder }), hint, !spec.half)
    }
    if (spec.type === 'select') {
      return field(spec.label, selectInput(value, spec.options || [], onChange), hint, !spec.half)
    }
    if (spec.type === 'boolean') {
      const checkbox = h('input', { type: 'checkbox' })
      checkbox.checked = Boolean(value)
      checkbox.addEventListener('change', () => onChange(checkbox.checked))
      return field(spec.label, checkbox, hint, !spec.half)
    }
    if (spec.type === 'number') {
      return field(spec.label, textInput(value, (next) => onChange(next === '' ? '' : Number(next)), { type: 'number' }), hint, !spec.half)
    }
    if (spec.type === 'email' || spec.type === 'url' || spec.type === 'slug') {
      const attrs = { placeholder: spec.placeholder }
      if (spec.type === 'email') attrs.type = 'email'
      if (spec.disabled) attrs.disabled = true
      return field(spec.label, textInput(value, onChange, attrs), hint, !spec.half)
    }
    if (spec.type === 'stringList') {
      const list = Array.isArray(value) ? value : []
      return field(spec.label, textArea(list.join('\n'), (next) => {
        onChange(next.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
      }, spec.rows || 5, { placeholder: spec.placeholder }), hint, !spec.half)
    }
    if (spec.type === 'objectList') {
      const list = Array.isArray(value) ? value : []
      if (!Array.isArray(value)) onChange(list)
      const wrap = h('div', { class: 'stack-list' })
      wrap.appendChild(subhead(spec.label || spec.itemLabel || '列表', button(spec.addLabel || '添加', () => {
        list.push(blankFromFields(spec.fields || []))
        markDirty(docId)
        rerender()
      }, 'btn--small btn--ghost')))
      if (!list.length) wrap.appendChild(h('p', { class: 'empty-state', text: '还没有条目' }))
      list.forEach((entry, index) => {
        const card = h('div', { class: 'card' })
        card.appendChild(h('div', { class: 'card__head' },
          h('span', { class: 'card__title', text: (spec.itemLabel || '条目') + ' #' + (index + 1) }),
          button('删除', () => {
            list.splice(index, 1)
            markDirty(docId)
            rerender()
          }, 'btn--small btn--danger')
        ))
        card.appendChild(renderFields(spec.fields || [], entry, docId, rerender))
        wrap.appendChild(card)
      })
      return h('div', { class: 'field field--wide' }, wrap)
    }
    if (spec.type === 'keyValue') {
      const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
      if (value === undefined) onChange(object)
      const wrap = h('div', { class: 'stack-list' })
      wrap.appendChild(subhead(spec.label || '键值对', button(spec.addLabel || '添加', () => {
        const base = spec.keyPrefix || 'item'
        let index = Object.keys(object).length + 1
        while (Object.prototype.hasOwnProperty.call(object, base + index)) index += 1
        object[base + index] = ''
        markDirty(docId)
        rerender()
      }, 'btn--small btn--ghost')))
      const keys = Object.keys(object)
      if (!keys.length) wrap.appendChild(h('p', { class: 'empty-state', text: '还没有条目' }))
      keys.forEach((initialKey) => {
        let currentKey = initialKey
        const card = h('div', { class: 'card' })
        card.appendChild(h('div', { class: 'card__head' },
          h('span', { class: 'card__title', text: spec.keyLabel || '键' }),
          button('删除', () => {
            delete object[currentKey]
            markDirty(docId)
            rerender()
          }, 'btn--small btn--danger')
        ))
        const keyInput = textInput(currentKey, (next) => {
          const nextKey = next.trim()
          if (!nextKey || nextKey === currentKey) return
          if (Object.prototype.hasOwnProperty.call(object, nextKey)) {
            toast('键名已存在：' + nextKey, 'warn')
            return
          }
          object[nextKey] = object[currentKey]
          delete object[currentKey]
          currentKey = nextKey
          markDirty(docId)
        })
        const valueInput = textArea(object[currentKey], (next) => {
          object[currentKey] = next
          markDirty(docId)
        }, 3)
        card.appendChild(renderFields([
          { path: ['__key__'], label: spec.keyLabel || '键名', type: 'text' },
        ], {}, docId, rerender, { override: { __key__: keyInput } }))
        card.appendChild(field(spec.valueLabel || '内容', valueInput, null, true))
        wrap.appendChild(card)
      })
      return h('div', { class: 'field field--wide' }, wrap)
    }
    if (spec.type === 'custom') {
      const component = Studio.fieldComponents.get(spec.component)
      if (!component) {
        return field(spec.label || spec.component, h('p', { class: 'empty-state', text: '组件未注册：' + spec.component }), hint, !spec.half)
      }
      return component({ field: spec, value, docId, onChange, rerender, Studio })
    }
    return field(spec.label || pathLabel(pathParts), textInput(value, onChange, {
      placeholder: spec.placeholder,
      disabled: spec.disabled ? true : undefined,
    }), hint, !spec.half)
  }

  // override 仅用于 keyValue 的键名输入（复用统一字段渲染）。
  function renderFields(fields, target, docId, rerender, options = {}) {
    const grid = h('div', { class: 'form-grid' })
    for (const spec of fields || []) {
      if (options.override && options.override[spec.path[0]]) {
        grid.appendChild(field(spec.label, options.override[spec.path[0]], null, !spec.half))
        continue
      }
      const node = renderField(spec, target, docId, rerender)
      if (node) grid.appendChild(node)
    }
    return grid
  }

  function uploadWithProgress(url, file, onProgress) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', url)
      request.setRequestHeader('X-Studio-Token', app.token)
      request.responseType = 'json'
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
      })
      request.addEventListener('load', () => {
        const payload = request.response
        if (request.status >= 200 && request.status < 300) resolve(payload)
        else reject(new Error((payload && payload.message) || '上传失败（HTTP ' + request.status + '）'))
      })
      request.addEventListener('error', () => reject(new Error('上传中断，请重试')))
      request.send(file)
    })
  }

  async function uploadMedia({ collectionId, itemKey, file, onProgress }) {
    const kind = file.type && file.type.startsWith('video/') ? 'video' : 'image'
    const query = '?collection=' + encodeURIComponent(collectionId) +
      '&item=' + encodeURIComponent(itemKey || '') +
      '&kind=' + kind +
      '&name=' + encodeURIComponent(file.name)
    const upload = await uploadWithProgress('/api/media' + query, file, onProgress)
    return api('/api/media/convert', { method: 'POST', body: { token: upload.token } })
  }

  async function uploadAvatar(file, onProgress) {
    const upload = await uploadWithProgress('/api/avatar', file, onProgress)
    return upload
  }

  function openHelp() {
    const modal = $('#help-modal')
    if (!modal) return
    renderHelp()
    modal.hidden = false
  }

  function closeHelp() {
    const modal = $('#help-modal')
    if (!modal) return
    modal.hidden = true
    try {
      localStorage.setItem('studio-help-seen', '1')
    } catch (error) {
      // 隐私模式下 localStorage 可能不可用。
    }
  }

  function renderHelp() {
    const body = $('#help-body')
    body.replaceChildren()
    const help = app.manifest && app.manifest.help
    if (help && Array.isArray(help.sections)) {
      if (help.intro) body.appendChild(h('p', { text: help.intro }))
      for (const section of help.sections) {
        body.appendChild(h('h3', { text: section.title }))
        const list = h(section.ordered ? 'ol' : 'ul')
        for (const item of section.items || []) list.appendChild(h('li', { text: item }))
        body.appendChild(list)
      }
      if (help.tip) body.appendChild(h('p', { class: 'tip', text: help.tip }))
      return
    }
    body.appendChild(h('p', { text: '保存草稿只改本地文件，发布才会上线。' }))
    body.appendChild(h('p', { text: '顶部选择页面 → 修改内容 → 保存草稿 → 右侧预览 → 发布。' }))
  }

  function maybeAutoOpenHelp() {
    let seen = false
    try {
      seen = localStorage.getItem('studio-help-seen') === '1'
    } catch (error) {
      seen = false
    }
    if (!seen) openHelp()
  }

  function bindHelp() {
    const modal = $('#help-modal')
    const button = $('#help-button')
    if (!modal || !button) return
    button.addEventListener('click', openHelp)
    modal.querySelectorAll('[data-close-help]').forEach((node) => node.addEventListener('click', closeHelp))
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closeHelp()
    })
  }

  function ensurePublishStream() {
    if (app.stream) return
    const source = new EventSource('/api/publish/events')
    app.stream = source
    source.addEventListener('status', (event) => {
      try {
        const status = JSON.parse(event.data)
        app.publishStatus = status
        const renderer = Studio.renderers.publish
        if (app.view && app.view.type === 'publish' && renderer && renderer.update) renderer.update(status)
        if (status.outcome === 'published' && status.finishedAt !== app.lastOutcome) {
          app.lastOutcome = status.finishedAt
          refreshSession().then(() => {
            if (app.view && app.view.type === 'publish') renderView(app.view.id)
          }).catch(() => {})
          toast('发布完成，正式站已更新', 'ok')
        }
      } catch (error) {
        // 忽略格式错误的事件。
      }
    })
  }

  async function loadAdapterModule() {
    const moduleName = app.adapter && app.adapter.webModule
    if (!moduleName) return
    await new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = '/adapter-web/' + encodeURIComponent(moduleName)
      script.addEventListener('load', resolve)
      script.addEventListener('error', () => {
        toast('适配器前端模块加载失败：' + moduleName, 'error')
        resolve()
      })
      document.head.appendChild(script)
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

  async function init() {
    bindHelp()
    $('#refresh-preview').addEventListener('click', refreshPreview)
    try {
      await refreshSession()
      await loadAdapterModule()
      await loadDocuments()
      applyBrand()
      renderTabs()
      const first = views().find((view) => view.type !== 'publish') || views()[0]
      if (first) renderView(first.id)
      maybeAutoOpenHelp()
    } catch (error) {
      $('#editor').replaceChildren(h('p', { class: 'empty-state', text: '工作台初始化失败：' + error.message }))
      const pill = $('#session-pill')
      pill.className = 'pill pill--error'
      pill.textContent = '未连接'
    }
  }

  Object.assign(Studio, {
    app,
    $,
    h,
    textInput,
    textArea,
    selectInput,
    button,
    field,
    subhead,
    pageHead,
    toast,
    api,
    getPath,
    setPath,
    pathLabel,
    markDirty,
    clearDirty,
    getDocument,
    descriptor,
    rememberIdentities,
    collectRenames,
    reloadDocument,
    saveDocument,
    showSaveErrors,
    renderFields,
    renderField,
    blankFromFields,
    uploadMedia,
    uploadAvatar,
    openHelp,
    closeHelp,
    renderTabs,
    renderView,
    refreshPreview,
    refreshSession,
    ensurePublishStream,
    currentView,
    views,
    previewPath,
  })

  document.addEventListener('DOMContentLoaded', init)
})()
