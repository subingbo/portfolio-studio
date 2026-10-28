(function () {
  'use strict'

  let postsApiBase = ''
  const PAGE_SIZE = 20
  const CONTENT_PATHS = {
    site: 'content/site.json',
    projects: 'content/projects.json',
  }
  const identity = {
    name: 'Your Name',
    initial: 'Y',
    role: 'Software Engineer',
    email: 'you@example.com',
  }
  // content.site / content.projects 为 null 时，页面保留内置静态内容（projects.js 快照）。
  const content = { site: null, projects: null }

  const md = window.markdownit
    ? window.markdownit({ html: false, linkify: true })
    : null

  function formatDate(value) {
    return value ? String(value).slice(0, 10) : ''
  }

  function displayName(comment) {
    return (comment.authorNickname || '访客').trim() || '访客'
  }

  function requestErrorMessage(status, payload) {
    if (status === 429) return '请求过于频繁，请稍后再试'
    if (status >= 500) return '内容服务暂时不可用，请稍后再试'
    if (payload && payload.msg) return payload.msg
    return '请求失败（HTTP ' + status + '）'
  }

  function normalizePostsApiBase(value) {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim().replace(/\/+$/, '')
    if (!trimmed) return ''
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'https:') return ''
      return parsed.origin + parsed.pathname.replace(/\/+$/, '')
    } catch (error) {
      return ''
    }
  }

  async function fetchApi(path) {
    if (!postsApiBase) {
      throw new Error('文章接口未配置（content/site.json → integrations.postsApiBase）')
    }
    const target = new URL(postsApiBase + path)
    if (target.protocol !== 'https:') {
      throw new Error('文章接口必须是 https 地址')
    }
    let response
    try {
      response = await fetch(target.toString(), { credentials: 'omit' })
    } catch (error) {
      throw new Error('网络连接失败，请检查连接后重试')
    }
    let payload = null
    try {
      payload = await response.json()
    } catch (error) {
      payload = null
    }
    if (!response.ok) {
      const failure = new Error(requestErrorMessage(response.status, payload))
      failure.status = response.status
      throw failure
    }
    return payload ? payload.data : null
  }

  async function loadJson(path) {
    const response = await fetch(path, { cache: 'no-cache' })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return response.json()
  }

  function showStatus(target, message, isError) {
    if (!target) return
    target.textContent = message
    target.classList.toggle('status--error', Boolean(isError))
  }

  function showContentNotice(message) {
    if (!document.querySelector || document.querySelector('.content-notice')) return
    const header = document.querySelector('.site-header')
    if (!header || !header.parentNode) return
    const notice = document.createElement('p')
    notice.className = 'content-notice'
    notice.setAttribute('role', 'status')
    notice.textContent = message
    header.parentNode.insertBefore(notice, header.nextSibling)
  }

  function setText(id, value) {
    if (!value) return
    const target = document.getElementById(id)
    if (target) target.textContent = value
  }

  function renderMarkdown(source) {
    if (md) return md.render(source || '')
    const pre = document.createElement('pre')
    pre.textContent = source || ''
    return pre.outerHTML
  }

  function letterAvatar(name, className) {
    const fallback = document.createElement('span')
    fallback.className = className + ' avatar--letter'
    fallback.textContent = Array.from(name || identity.initial)[0] || identity.initial
    fallback.setAttribute('aria-hidden', 'true')
    return fallback
  }

  function createCommentAvatar(comment) {
    const name = displayName(comment)
    if (!comment.authorAvatar) return letterAvatar(name, 'comment__avatar')
    const image = document.createElement('img')
    image.className = 'comment__avatar'
    image.src = comment.authorAvatar
    image.alt = name
    image.loading = 'lazy'
    image.addEventListener('error', function () {
      image.replaceWith(letterAvatar(name, 'comment__avatar'))
    })
    return image
  }

  async function initProfileAvatar() {
    const slots = document.querySelectorAll('[data-profile-avatar]')
    if (!slots.length) return
    function showFallback() {
      slots.forEach(function (slot) {
        slot.setAttribute('aria-label', identity.name + '的头像')
        slot.replaceChildren(letterAvatar(identity.name, 'profile-avatar'))
      })
    }
    const localAvatar = content.site && content.site.profile && typeof content.site.profile.avatar === 'string'
      ? content.site.profile.avatar.trim()
      : ''
    if (localAvatar) {
      slots.forEach(function (slot) {
        slot.setAttribute('aria-label', identity.name + '的头像')
        const image = document.createElement('img')
        image.className = 'profile-avatar'
        image.src = localAvatar
        image.alt = identity.name
        image.loading = 'eager'
        image.addEventListener('error', function () {
          image.replaceWith(letterAvatar(identity.name, 'profile-avatar'))
        })
        slot.replaceChildren(image)
      })
      return
    }
    showFallback()
  }

  function categoryLabel(category) {
    return { TECH: '技术', PROJECT: '项目', LIFE: '生活' }[category] || category || '文章'
  }

  function articleUrl(postId) {
    return 'article.html?id=' + encodeURIComponent(postId)
  }

  function projectUrl(project) {
    const key = project && (project.slug || project.id)
    return 'project.html?id=' + encodeURIComponent(key || '')
  }

  function renderPostCard(post) {
    const card = document.createElement('a')
    card.className = 'post-card'
    card.href = articleUrl(post.postId)
    const meta = document.createElement('div')
    meta.className = 'post-card__meta'
    const category = document.createElement('span')
    category.className = 'post-card__category'
    category.textContent = categoryLabel(post.category)
    const date = document.createElement('span')
    date.textContent = formatDate(post.createdAt)
    const comments = document.createElement('span')
    comments.textContent = (post.commentCount || 0) + ' 条留言'
    meta.append(category, date, comments)
    const title = document.createElement('h3')
    title.textContent = post.title
    const excerpt = document.createElement('p')
    excerpt.textContent = post.excerpt || ''
    card.append(meta, title, excerpt)
    return card
  }

  function renderPostRow(post) {
    const row = document.createElement('a')
    row.className = 'post-row'
    row.href = articleUrl(post.postId)
    const time = document.createElement('time')
    time.dateTime = post.createdAt
    time.textContent = formatDate(post.createdAt)
    const body = document.createElement('div')
    const title = document.createElement('h3')
    title.textContent = post.title
    const excerpt = document.createElement('p')
    excerpt.textContent = post.excerpt || ''
    body.append(title, excerpt)
    row.append(time, body)
    return row
  }

  function allProjects() {
    if (content.projects) return content.projects
    return window.PortfolioData ? window.PortfolioData.all : []
  }

  function visibleProjects() {
    return allProjects()
      .filter(function (project) {
        return !project.status || project.status === 'published'
      })
      .sort(function (a, b) {
        return (a.order || 0) - (b.order || 0)
      })
  }

  function findProject(key) {
    if (!key) return null
    return allProjects().find(function (project) {
      return project.slug === key || project.id === key
    }) || null
  }

  function coverMediaItem(project) {
    const media = Array.isArray(project.media) ? project.media : []
    if (!media.length) return null
    const chosen = project.coverMediaId
      ? media.find(function (item) { return item.id === project.coverMediaId })
      : null
    if (chosen) return chosen
    return media.find(function (item) { return item.type !== 'video' }) || media[0]
  }

  function coverImageSrc(project) {
    const item = coverMediaItem(project)
    if (!item) return ''
    return item.type === 'video' ? (item.poster || '') : (item.src || '')
  }

  function createCoverPlaceholder(project) {
    const placeholder = document.createElement('div')
    placeholder.className = 'cover cover--placeholder'
    const grid = document.createElement('span')
    grid.className = 'cover__grid'
    grid.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span')
    label.className = 'cover__label'
    label.textContent = project.title || ''
    const tag = document.createElement('span')
    tag.className = 'cover__tag'
    tag.textContent = project.category || 'PROJECT'
    placeholder.append(grid, label, tag)
    return placeholder
  }

  function createCover(project, href, className) {
    const src = coverImageSrc(project)
    let node
    if (src) {
      const image = document.createElement('img')
      image.className = 'cover__img'
      image.src = src
      image.alt = ''
      image.loading = 'lazy'
      node = image
    } else {
      node = createCoverPlaceholder(project)
    }
    if (!href) {
      const wrap = document.createElement('div')
      wrap.className = className || 'cover'
      wrap.appendChild(node)
      return wrap
    }
    const link = document.createElement('a')
    link.className = className || 'cover'
    link.href = href
    link.setAttribute('tabindex', '-1')
    link.setAttribute('aria-hidden', 'true')
    link.appendChild(node)
    return link
  }

  function renderProjectCard(project) {
    const card = document.createElement('article')
    card.className = 'project-card'
    const href = projectUrl(project)
    card.appendChild(createCover(project, href, 'project-card__cover cover'))
    const top = document.createElement('div')
    top.className = 'project-card__top'
    const category = document.createElement('span')
    category.className = 'eyebrow'
    category.textContent = project.category
    const role = document.createElement('span')
    role.className = 'project-card__role'
    role.textContent = project.role
    top.append(category, role)
    const title = document.createElement('h3')
    const link = document.createElement('a')
    link.href = href
    link.textContent = project.title
    title.appendChild(link)
    const summary = document.createElement('p')
    summary.className = 'project-card__summary'
    summary.textContent = project.summary
    const stack = document.createElement('ul')
    stack.className = 'chip-list'
    project.stack.slice(0, 5).forEach(function (name) {
      const item = document.createElement('li')
      item.className = 'chip'
      item.textContent = name
      stack.appendChild(item)
    })
    const proof = document.createElement('div')
    proof.className = 'project-card__proof'
    const firstProof = project.proof && project.proof[0]
    const proofValue = document.createElement('strong')
    proofValue.textContent = firstProof ? firstProof.value : '进行中'
    const proofLabel = document.createElement('span')
    proofLabel.textContent = firstProof ? firstProof.label : '项目状态'
    const detail = document.createElement('a')
    detail.href = href
    detail.textContent = '查看项目 →'
    proof.append(proofValue, proofLabel, detail)
    card.append(top, title, summary, stack, proof)
    return card
  }

  function renderProjectList(target, projects) {
    if (!target) return
    target.replaceChildren()
    if (!projects.length) {
      showStatus(target, '还没有公开的作品')
      return
    }
    projects.forEach(function (project) {
      target.appendChild(renderProjectCard(project))
    })
  }

  function initFeaturedProjects() {
    const target = document.getElementById('featured-projects')
    if (!target) return
    renderProjectList(target, visibleProjects())
  }

  function initProjects() {
    const target = document.getElementById('project-list')
    if (!target) return
    renderProjectList(target, visibleProjects())
  }

  function renderProofStrip(project) {
    const strip = document.createElement('div')
    strip.className = 'proof-strip'
    if (!project.proof || !project.proof.length) return strip
    project.proof.forEach(function (item) {
      const cell = document.createElement('div')
      cell.className = 'proof-strip__item'
      const value = document.createElement('strong')
      value.textContent = item.value
      const label = document.createElement('span')
      label.textContent = item.label
      cell.append(value, label)
      strip.appendChild(cell)
    })
    return strip
  }

  function renderMediaVisual(entry) {
    if (entry.type === 'video') {
      const video = document.createElement('video')
      video.className = 'media-video'
      video.controls = true
      video.preload = 'metadata'
      video.playsInline = true
      video.setAttribute('playsinline', '')
      if (entry.poster) video.poster = entry.poster
      const source = document.createElement('source')
      source.src = entry.src
      source.type = 'video/mp4'
      video.appendChild(source)
      return video
    }
    const image = document.createElement('img')
    image.src = entry.src
    image.alt = entry.alt || ''
    image.loading = 'lazy'
    return image
  }

  function renderMediaFrame(entry, index) {
    const figure = document.createElement('figure')
    figure.className = 'filmstrip__frame'
    const head = document.createElement('div')
    head.className = 'filmstrip__head'
    const number = document.createElement('span')
    number.className = 'filmstrip__index'
    number.textContent = String(index + 1).padStart(2, '0')
    const tag = document.createElement('span')
    tag.className = 'filmstrip__tag'
    tag.textContent = entry.tag || (entry.type === 'video' ? 'VIDEO' : 'FRAME')
    head.append(number, tag)
    const visual = document.createElement('div')
    visual.className = 'filmstrip__visual'
    visual.appendChild(renderMediaVisual(entry))
    const caption = document.createElement('figcaption')
    caption.textContent = entry.caption || entry.alt || ''
    figure.append(head, visual, caption)
    return figure
  }

  function renderMediaFilmstrip(project) {
    if (!Array.isArray(project.media) || !project.media.length) return null
    const section = document.createElement('section')
    section.className = 'project-section'
    const heading = document.createElement('h2')
    heading.textContent = '工程胶片'
    const hint = document.createElement('p')
    hint.className = 'filmstrip__hint'
    hint.textContent = '画面编号、功能标签与对应工程成果。视频需手动播放。'
    const strip = document.createElement('div')
    strip.className = 'filmstrip'
    project.media.forEach(function (entry, index) {
      strip.appendChild(renderMediaFrame(entry, index))
    })
    section.append(heading, hint, strip)
    return section
  }

  function renderProjectDetail(target, project) {
    target.replaceChildren()
    if (!project) {
      const empty = document.createElement('section')
      empty.className = 'not-found'
      const eyebrow = document.createElement('p')
      eyebrow.className = 'eyebrow'
      eyebrow.textContent = 'PROJECT NOT FOUND'
      const title = document.createElement('h1')
      title.textContent = '没有找到这个作品'
      const message = document.createElement('p')
      message.textContent = '链接可能已失效，请返回作品列表重新选择。'
      const back = document.createElement('a')
      back.className = 'button button--primary'
      back.href = 'projects.html'
      back.textContent = '返回作品列表'
      empty.append(eyebrow, title, message, back)
      target.appendChild(empty)
      return
    }
    document.title = project.title + ' · ' + identity.name + '的作品'
    const hero = document.createElement('header')
    hero.className = 'project-hero'
    const eyebrow = document.createElement('p')
    eyebrow.className = 'eyebrow'
    eyebrow.textContent = project.category
    const title = document.createElement('h1')
    title.textContent = project.title
    const tagline = document.createElement('p')
    tagline.className = 'project-hero__tagline'
    tagline.textContent = project.tagline
    const role = document.createElement('p')
    role.className = 'project-hero__role'
    role.textContent = project.role
    hero.append(eyebrow, title, tagline, role)
    const actions = document.createElement('div')
    actions.className = 'actions'
    if (project.sourceUrl) {
      const source = document.createElement('a')
      source.className = 'button button--primary'
      source.href = project.sourceUrl
      source.target = '_blank'
      source.rel = 'noopener noreferrer'
      source.textContent = '查看源码 ↗'
      actions.appendChild(source)
    }
    const all = document.createElement('a')
    all.className = 'button button--ghost'
    all.href = 'projects.html'
    all.textContent = '全部作品'
    actions.appendChild(all)
    hero.appendChild(actions)
    const cover = createCover(project, '', 'project-cover')
    const overview = document.createElement('section')
    overview.className = 'project-section'
    const overviewTitle = document.createElement('h2')
    overviewTitle.textContent = '项目概览'
    const overviewText = document.createElement('p')
    overviewText.textContent = project.overview
    const stack = document.createElement('ul')
    stack.className = 'chip-list'
    project.stack.forEach(function (name) {
      const item = document.createElement('li')
      item.className = 'chip'
      item.textContent = name
      stack.appendChild(item)
    })
    overview.append(overviewTitle, overviewText, stack)
    target.append(hero, cover, renderProofStrip(project), overview)
    project.sections.forEach(function (section) {
      const block = document.createElement('section')
      block.className = 'project-section'
      const heading = document.createElement('h2')
      heading.textContent = section.title
      const body = document.createElement('p')
      body.textContent = section.body
      block.append(heading, body)
      target.appendChild(block)
    })
    Object.keys(project.evidence || {}).forEach(function (key) {
      const note = document.createElement('aside')
      note.className = 'evidence-note'
      const label = document.createElement('strong')
      label.textContent = key === 'modelEvaluation' ? '真实模型评测' : key === 'offlineVerification' ? '后续离线验证' : '工程证据'
      const body = document.createElement('p')
      body.textContent = project.evidence[key]
      note.append(label, body)
      target.appendChild(note)
    })
    const filmstrip = renderMediaFilmstrip(project)
    if (filmstrip) target.appendChild(filmstrip)
  }

  function initProjectDetail() {
    const target = document.getElementById('project-detail')
    if (!target) return
    const params = new URLSearchParams(location.search)
    const key = params.get('id') || params.get('slug')
    renderProjectDetail(target, findProject(key))
  }

  function markActiveNav() {
    const current = location.pathname.split('/').pop() || 'index.html'
    document.querySelectorAll('[data-nav]').forEach(function (link) {
      const nav = link.getAttribute('data-nav')
      const active = (nav === 'home' && current === 'index.html')
        || (nav === 'blog' && (current === 'blog.html' || current === 'article.html'))
        || (nav === 'projects' && (current === 'projects.html' || current === 'project.html'))
        || (nav === 'about' && current === 'about.html')
      link.classList.toggle('is-active', active)
    })
  }

  function applyProfile(profile) {
    if (!profile) return
    if (profile.name) {
      identity.name = profile.name
      identity.initial = profile.initial || Array.from(profile.name)[0] || identity.initial
    }
    if (profile.email) identity.email = profile.email
  }

  function renderExperienceCard(entry, withRole) {
    const card = document.createElement('article')
    card.className = 'experience-card'
    const top = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = entry.school || entry.company || ''
    const period = document.createElement('span')
    period.textContent = entry.period || ''
    top.append(name, period)
    card.appendChild(top)
    if (withRole) {
      const role = document.createElement('p')
      role.className = 'experience-card__role'
      role.textContent = entry.role || ''
      card.appendChild(role)
    } else if (entry.detail) {
      const detail = document.createElement('p')
      detail.textContent = entry.detail
      card.appendChild(detail)
    }
    if (Array.isArray(entry.bullets) && entry.bullets.length) {
      const list = document.createElement('ul')
      entry.bullets.forEach(function (bullet) {
        const item = document.createElement('li')
        item.textContent = bullet
        list.appendChild(item)
      })
      card.appendChild(list)
    }
    return card
  }

  function applyAboutContent(about) {
    if (!about) return
    setText('about-intro', about.intro)
    const education = document.getElementById('education-list')
    if (education && Array.isArray(about.education)) {
      education.replaceChildren()
      about.education.forEach(function (entry) {
        education.appendChild(renderExperienceCard(entry, false))
      })
    }
    const internships = document.getElementById('internship-list')
    if (internships && Array.isArray(about.internships)) {
      internships.replaceChildren()
      about.internships.forEach(function (entry) {
        internships.appendChild(renderExperienceCard(entry, true))
      })
    }
    const capabilities = document.getElementById('capability-grid')
    if (capabilities && Array.isArray(about.capabilities)) {
      capabilities.replaceChildren()
      about.capabilities.forEach(function (capability) {
        const card = document.createElement('article')
        const heading = document.createElement('h3')
        heading.textContent = capability.title
        const body = document.createElement('p')
        body.textContent = capability.description
        card.append(heading, body)
        capabilities.appendChild(card)
      })
    }
    setText('about-contact-note', about.contactNote)
  }

  function applySiteContent() {
    const site = content.site
    const profile = site ? site.profile : null
    if (profile) {
      applyProfile(profile)
      document.querySelectorAll('[data-brand-mark]').forEach(function (node) {
        node.textContent = identity.initial
      })
      document.querySelectorAll('[data-brand-name]').forEach(function (node) {
        node.textContent = identity.name
      })
      setText('hero-eyebrow', profile.eyebrow)
      setText('hero-slogan', profile.slogan)
      setText('hero-intro', profile.intro)
      setText('about-name', profile.name)
      const tags = document.getElementById('hero-tags')
      if (tags && Array.isArray(profile.tags)) {
        tags.replaceChildren()
        profile.tags.forEach(function (tag) {
          const item = document.createElement('li')
          item.className = 'chip'
          item.textContent = tag
          tags.appendChild(item)
        })
      }
      if (profile.github) {
        document.querySelectorAll('[data-github-link]').forEach(function (link) {
          link.href = profile.github
        })
      }
      if (site.about) applyAboutContent(site.about)
    }
    document.querySelectorAll('[data-email-link]').forEach(function (link) {
      link.href = 'mailto:' + identity.email
    })
    document.querySelectorAll('[data-email-label]').forEach(function (node) {
      node.textContent = identity.email
    })
  }

  async function loadContent() {
    const results = await Promise.allSettled([
      loadJson(CONTENT_PATHS.site),
      loadJson(CONTENT_PATHS.projects),
    ])
    const siteResult = results[0]
    const projectsResult = results[1]
    if (siteResult.status === 'fulfilled' && siteResult.value && siteResult.value.profile) {
      content.site = siteResult.value
      const integrations = siteResult.value.integrations
      postsApiBase = integrations ? normalizePostsApiBase(integrations.postsApiBase) : ''
    }
    if (projectsResult.status === 'fulfilled' && projectsResult.value && Array.isArray(projectsResult.value.projects)) {
      content.projects = projectsResult.value.projects
    }
    if (!content.site || !content.projects) {
      const missing = []
      if (!content.site) missing.push('站点资料')
      if (!content.projects) missing.push('作品数据')
      showContentNotice(missing.join('与') + '加载失败，正在显示内置备份内容。')
    }
    applySiteContent()
  }

  async function initIndex() {
    const container = document.getElementById('latest')
    if (!container) return
    if (!postsApiBase) {
      container.replaceChildren()
      showStatus(container, '文章功能未配置：在 content/site.json 的 integrations.postsApiBase 填入接口地址。')
      return
    }
    try {
      const page = await fetchApi('/posts?pageNum=1&pageSize=6')
      container.replaceChildren()
      if (!page || !page.items || !page.items.length) {
        showStatus(container, '还没有公开文章')
        return
      }
      page.items.forEach(function (post) {
        container.appendChild(renderPostCard(post))
      })
    } catch (error) {
      container.replaceChildren()
      showStatus(container, error.message, true)
    }
  }

  async function fetchAllPosts() {
    const all = []
    for (let pageNum = 1; pageNum <= 20; pageNum += 1) {
      const page = await fetchApi('/posts?pageNum=' + pageNum + '&pageSize=50')
      const items = page && page.items ? page.items : []
      all.push.apply(all, items)
      if (!items.length || all.length >= (page.total || 0)) break
    }
    return all
  }

  async function initBlog() {
    const list = document.getElementById('post-list')
    const status = document.getElementById('list-status')
    const more = document.getElementById('load-more')
    const filters = document.getElementById('category-filters')
    if (!list) return
    if (!postsApiBase) {
      showStatus(status, '文章功能未配置：在 content/site.json 的 integrations.postsApiBase 填入接口地址。')
      if (more) more.hidden = true
      return
    }
    const state = { all: [], filtered: [], visible: PAGE_SIZE, category: '' }
    function render() {
      list.replaceChildren()
      const visiblePosts = state.filtered.slice(0, state.visible)
      visiblePosts.forEach(function (post) {
        list.appendChild(renderPostRow(post))
      })
      if (!visiblePosts.length) showStatus(list, '这个分类下还没有文章')
      showStatus(status, '共 ' + state.filtered.length + ' 篇文章')
      if (more) more.hidden = state.visible >= state.filtered.length
    }
    function applyFilter() {
      state.filtered = state.category
        ? state.all.filter(function (post) { return post.category === state.category })
        : state.all.slice()
      state.visible = PAGE_SIZE
      render()
    }
    try {
      showStatus(status, '加载中…')
      state.all = await fetchAllPosts()
      applyFilter()
    } catch (error) {
      showStatus(status, error.message, true)
      if (more) more.hidden = true
      return
    }
    if (filters) {
      filters.addEventListener('click', function (event) {
        const button = event.target.closest('button[data-category]')
        if (!button) return
        filters.querySelectorAll('button').forEach(function (item) {
          item.classList.toggle('is-active', item === button)
        })
        state.category = button.getAttribute('data-category') || ''
        applyFilter()
      })
    }
    if (more) {
      more.addEventListener('click', function () {
        state.visible += PAGE_SIZE
        render()
      })
    }
  }

  function renderComment(comment) {
    const name = displayName(comment)
    const item = document.createElement('div')
    item.className = 'comment'
    const content = document.createElement('div')
    content.className = 'comment__body'
    const meta = document.createElement('div')
    meta.className = 'comment__meta'
    meta.textContent = name + (comment.replyToNickname ? ' 回复 ' + comment.replyToNickname : '') + ' · ' + formatDate(comment.createdAt)
    const body = document.createElement('p')
    body.textContent = comment.content
    content.append(meta, body)
    item.append(createCommentAvatar(comment), content)
    return item
  }

  async function loadComments(postId, commentsEl) {
    if (!commentsEl) return
    try {
      const page = await fetchApi('/posts/' + postId + '/comments?pageNum=1&pageSize=50')
      commentsEl.replaceChildren()
      if (!page || !page.items || !page.items.length) {
        showStatus(commentsEl, '还没有留言')
        return
      }
      page.items.forEach(function (comment) {
        commentsEl.appendChild(renderComment(comment))
      })
    } catch (error) {
      commentsEl.replaceChildren()
      showStatus(commentsEl, '留言加载失败：' + error.message, true)
    }
  }

  async function initArticle() {
    const contentEl = document.getElementById('article-content')
    if (!contentEl) return
    const titleEl = document.getElementById('article-title')
    const metaEl = document.getElementById('article-meta')
    const commentsEl = document.getElementById('comments-list')
    const status = document.getElementById('article-status')
    const id = new URLSearchParams(location.search).get('id')
    if (!postsApiBase) {
      showStatus(status, '文章功能未配置：在 content/site.json 的 integrations.postsApiBase 填入接口地址。', true)
      if (titleEl) titleEl.textContent = '文章功能未配置'
      if (commentsEl) commentsEl.replaceChildren()
      return
    }
    if (!id || !/^\d+$/.test(id)) {
      showStatus(status, '文章不存在或未公开', true)
      if (titleEl) titleEl.textContent = '文章不存在'
      if (commentsEl) commentsEl.replaceChildren()
      return
    }
    try {
      const post = await fetchApi('/posts/' + id)
      document.title = post.title + ' · ' + identity.name + '的个人网站'
      if (titleEl) titleEl.textContent = post.title
      if (metaEl) {
        metaEl.replaceChildren()
        const category = document.createElement('span')
        category.className = 'chip chip--orange'
        category.textContent = categoryLabel(post.category)
        const date = document.createElement('span')
        date.textContent = formatDate(post.createdAt)
        const count = document.createElement('span')
        count.textContent = (post.commentCount || 0) + ' 条留言'
        metaEl.append(category, date, count)
      }
      contentEl.innerHTML = renderMarkdown(post.content)
      showStatus(status, '')
      await loadComments(id, commentsEl)
    } catch (error) {
      if (titleEl) titleEl.textContent = '文章不存在'
      contentEl.replaceChildren()
      if (commentsEl) commentsEl.replaceChildren()
      showStatus(status, error.status === 404 ? '文章不存在或未公开' : error.message, true)
    }
  }

  window.PortfolioSite = {
    identity,
    requestErrorMessage,
    fetchApi,
    projectUrl,
    articleUrl,
    formatDate,
    categoryLabel,
    renderProjectDetail,
    loadContent,
  }

  document.addEventListener('DOMContentLoaded', async function () {
    markActiveNav()
    await loadContent()
    initProfileAvatar()
    initFeaturedProjects()
    initProjects()
    initProjectDetail()
    initIndex()
    initBlog()
    initArticle()
  })
})()
