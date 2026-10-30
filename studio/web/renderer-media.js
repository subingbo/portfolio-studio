'use strict'

;(function () {
  const Studio = window.Studio
  const { h, button, subhead, pageHead, toast } = Studio

  function collectionIdFor(view) {
    const list = Studio.state.capabilities.media || []
    if (!list.length) return ''
    const selected = Studio.state.mediaSelection
    return list.some((entry) => entry.id === selected) ? selected : list[0].id
  }

  function formatSize(bytes) {
    return (bytes / 1024).toFixed(0) + ' KiB'
  }

  async function renderMediaView(view, root) {
    const collections = Studio.state.capabilities.media || []
    const collectionId = collectionIdFor(view)
    root.appendChild(pageHead(view.label, '查看媒体文件与引用关系。删除默认只移除引用；“清理未使用素材”会在确认后删除文件。'))
    if (!collections.length) {
      root.appendChild(h('p', { class: 'empty-state', text: '当前适配器没有配置媒体集合。' }))
      return
    }
    if (collections.length > 1) {
      const selector = h('select')
      for (const entry of collections) {
        const option = h('option', { value: entry.id, text: entry.label || entry.id })
        if (entry.id === collectionId) option.selected = true
        selector.appendChild(option)
      }
      selector.addEventListener('change', () => {
        Studio.state.mediaSelection = selector.value
        Studio.renderView(view.id)
      })
      root.appendChild(h('div', { class: 'summary-bar' }, selector))
    }

    let listing
    try {
      listing = await Studio.api('/api/media?collection=' + encodeURIComponent(collectionId))
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
      button('扫描未使用素材', () => scanCleanup(view, collectionId), 'btn--small btn--ghost'),
      button('刷新', () => Studio.renderView(view.id), 'btn--small btn--ghost')
    ))

    const table = h('table', { class: 'table' })
    table.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: '文件' }),
      h('th', { text: '类型' }),
      h('th', { text: '大小' }),
      h('th', { text: '引用' })
    )))
    const body = h('tbody')
    for (const file of listing.files) {
      const refs = file.references.length
        ? file.references.map((ref) => ref.documentId + ' · ' + ref.mediaId + '（' + ref.field + '）').join('；')
        : '未引用'
      body.appendChild(h('tr', { class: file.references.length ? '' : 'is-unused' },
        h('td', {}, h('code', { text: file.path })),
        h('td', { text: file.type }),
        h('td', { text: formatSize(file.size) }),
        h('td', { text: refs })
      ))
    }
    table.appendChild(body)
    root.appendChild(h('div', { class: 'table-wrap' }, table))
    root.appendChild(h('div', { class: 'cleanup-box' }))
  }

  async function scanCleanup(view, collectionId) {
    const box = document.querySelector('.cleanup-box')
    if (!box) return
    box.replaceChildren()
    try {
      const result = await Studio.api('/api/media/cleanup?collection=' + encodeURIComponent(collectionId), { method: 'POST' })
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
          h('span', { class: 'muted', text: ' ' + formatSize(file.size) })
        ))
      }
      box.appendChild(list)
      box.appendChild(h('div', { class: 'row-actions' }, button('确认删除选中文件', async () => {
        const checked = Array.from(document.querySelectorAll('input[data-cleanup]'))
          .filter((node) => node.checked)
          .map((node) => node.value)
        if (!checked.length) {
          toast('没有选中文件', 'warn')
          return
        }
        if (!window.confirm('将永久删除 ' + checked.length + ' 个未引用文件。内容 JSON 不会受影响。继续？')) return
        try {
          const result = await Studio.api('/api/media/cleanup/confirm', {
            method: 'POST',
            body: { collection: collectionId, files: checked },
          })
          toast('已删除 ' + result.deleted.length + ' 个文件')
          Studio.renderView(view.id)
        } catch (error) {
          toast(error.message, 'error')
        }
      }, 'btn--danger')))
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  Studio.registerViewType('media', renderMediaView)
})()
