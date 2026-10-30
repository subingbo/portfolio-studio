'use strict'

;(function () {
  const Studio = window.Studio
  const {
    h, button, subhead, pageHead, field, selectInput, markDirty, toast, renderFields,
  } = Studio

  const STATUS_LABELS = { published: '已发布', draft: '草稿', archived: '已归档' }

  function descriptorFor(view) {
    return Studio.descriptor(view.document)
  }

  function itemsOf(view) {
    const documentData = Studio.getDocument(view.document)
    const desc = descriptorFor(view)
    if (!desc || !documentData) return []
    return Array.isArray(documentData[desc.itemsKey]) ? documentData[desc.itemsKey] : []
  }

  function sortedItems(view) {
    const desc = descriptorFor(view)
    return itemsOf(view).slice().sort((left, right) => {
      return (left[desc.orderField] || 0) - (right[desc.orderField] || 0)
    })
  }

  function selectedItem(view) {
    const desc = descriptorFor(view)
    const key = Studio.state.selections[view.id]
    return itemsOf(view).find((item) => item[desc.identityField] === key) || null
  }

  function mediaCapability(view) {
    const collectionId = view.media && view.media.collection
    const list = Studio.state.capabilities.media || []
    return list.find((entry) => entry.id === collectionId) || list[0] || null
  }

  function statusBadge(status) {
    const known = Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)
    return h('span', { class: 'badge badge--' + (known ? status : 'archived'), text: STATUS_LABELS[status] || String(status || '') })
  }

  function createItem(view) {
    const desc = descriptorFor(view)
    const documentData = Studio.getDocument(view.document)
    const items = itemsOf(view)
    const base = JSON.parse(JSON.stringify((view.item && view.item.defaults) || {}))
    const identityField = desc.identityField
    let identity = String(base[identityField] || 'new-item')
    const used = new Set(items.map((item) => item[identityField]))
    if (used.has(identity)) {
      let index = 2
      while (used.has(identity + '-' + index)) index += 1
      identity = identity + '-' + index
    }
    base[identityField] = identity
    const maxOrder = items.reduce((max, item) => Math.max(max, Number(item[desc.orderField]) || 0), 0)
    base[desc.orderField] = maxOrder + 1
    Object.defineProperty(base, '__studioSaved', {
      value: null,
      writable: true,
      enumerable: false,
      configurable: true,
    })
    items.push(base)
    Studio.state.selections[view.id] = identity
    markDirty(view.document)
    Studio.renderView(view.id)
  }

  function reorderItems(view, fromIdentity, toIdentity) {
    if (!fromIdentity || !toIdentity || fromIdentity === toIdentity) return
    const desc = descriptorFor(view)
    const ordered = sortedItems(view)
    const fromIndex = ordered.findIndex((item) => item[desc.identityField] === fromIdentity)
    const toIndex = ordered.findIndex((item) => item[desc.identityField] === toIdentity)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = ordered.splice(fromIndex, 1)
    ordered.splice(toIndex, 0, moved)
    ordered.forEach((item, index) => {
      item[desc.orderField] = index + 1
    })
    const documentData = Studio.getDocument(view.document)
    documentData[desc.itemsKey] = ordered
    markDirty(view.document)
    Studio.renderView(view.id)
  }

  function renderListRow(view, desc, item) {
    const list = view.list || {}
    const identity = item[desc.identityField]
    const status = list.statusField ? item[list.statusField] : null
    const row = h('div', {
      class: 'project-row' + (identity === Studio.state.selections[view.id] ? ' is-active' : ''),
      draggable: 'true',
    })
    row.append(
      h('span', { class: 'project-row__drag', text: '⋮⋮', 'aria-hidden': 'true' }),
      h('div', { class: 'project-row__body' },
        h('strong', { text: String(item[list.titleField] || identity || '') }),
        h('span', { text: String(item[list.subtitleField] || identity || '') })
      ),
      status ? h('span', { class: 'project-row__badge' }, statusBadge(status)) : null
    )
    row.addEventListener('click', () => {
      Studio.state.selections[view.id] = identity
      Studio.renderView(view.id)
    })
    row.addEventListener('dragstart', (event) => {
      Studio.state.dragIdentity = identity
      row.classList.add('is-dragging')
      event.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
      Studio.state.dragIdentity = null
      row.classList.remove('is-dragging')
    })
    row.addEventListener('dragover', (event) => event.preventDefault())
    row.addEventListener('drop', (event) => {
      event.preventDefault()
      reorderItems(view, Studio.state.dragIdentity, identity)
    })
    return row
  }

  function identityLocked(item, identityField) {
    const saved = item.__studioSaved
    return Boolean(saved && Studio.state.lockedSlugs.includes(saved))
  }

  function formSectionsFor(view, item) {
    const sections = (view.item && view.item.form && view.item.form.sections) || []
    const identityField = view.item.identityField
    const locked = identityLocked(item, identityField)
    return sections.map((section) => ({
      title: section.title,
      fields: (section.fields || []).map((spec) => {
        const specPath = Array.isArray(spec.path) ? spec.path : [spec.path]
        if (specPath.length === 1 && specPath[0] === identityField) {
          return Object.assign({}, spec, {
            disabled: locked,
            hint: locked ? (view.item.lockedHint || '已发布，标识已锁定') : spec.hint,
          })
        }
        return spec
      }),
    }))
  }

  function renderItemEditor(view, desc, item) {
    const form = h('div')
    form.appendChild(h('div', { class: 'card__head' },
      h('span', { class: 'card__title', text: '编辑条目' }),
      h('span', {
        class: 'muted',
        text: item.__studioSaved
          ? (identityLocked(item, desc.identityField) ? '标识已锁定' : '尚未锁定标识')
          : '尚未保存',
      })
    ))
    const rerender = () => Studio.renderView(view.id)
    for (const section of formSectionsFor(view, item)) {
      if (section.title) form.appendChild(subhead(section.title, null))
      form.appendChild(renderFields(section.fields, item, view.document, rerender))
    }
    const media = renderMediaManager(view, desc, item)
    if (media) form.appendChild(media)
    form.appendChild(h('div', { class: 'row-actions' }, button('保存草稿', async () => {
      const identity = item[desc.identityField]
      const ok = await Studio.saveDocument(view.document)
      if (ok) {
        Studio.state.selections[view.id] = identity
        Studio.renderView(view.id)
      }
    }, 'btn--primary')))
    return form
  }

  function renderMediaManager(view, desc, item) {
    if (!view.media) return null
    const capability = mediaCapability(view)
    if (!capability) return null
    const mediaField = capability.mediaField || 'media'
    const list = Array.isArray(item[mediaField]) ? item[mediaField] : []
    const savedIdentity = item.__studioSaved
    const labels = view.media.labels || {}
    const section = h('div', { class: 'media-manager' })
    section.appendChild(subhead(labels.title || '媒体', null))
    section.appendChild(h('p', { class: 'muted', text: labels.hint || '拖拽上传图片或视频。' }))

    const zone = h('div', {
      class: 'dropzone' + (savedIdentity ? '' : ' is-busy'),
      role: 'button',
      tabindex: '0',
    })
    zone.appendChild(h('span', { text: savedIdentity ? '拖拽文件到这里，或点击选择' : '先保存条目，再上传媒体' }))
    zone.appendChild(h('small', { text: 'JPG / PNG / WebP · MP4 / MOV / WebM' }))
    const fileInput = h('input', {
      type: 'file',
      multiple: true,
      accept: 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm',
      style: 'display:none',
    })
    zone.appendChild(fileInput)
    const status = h('div', { class: 'upload-status' })
    const progress = h('div', { class: 'progress' }, h('span'))
    const progressBar = progress.firstChild

    function openPicker() {
      if (!savedIdentity) {
        toast('请先保存条目，再上传媒体', 'warn')
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
      if (files.length) uploadFiles(files)
    })
    zone.addEventListener('dragover', (event) => {
      event.preventDefault()
      if (savedIdentity) zone.classList.add('is-over')
    })
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'))
    zone.addEventListener('drop', (event) => {
      event.preventDefault()
      zone.classList.remove('is-over')
      if (!savedIdentity) {
        toast('请先保存条目，再上传媒体', 'warn')
        return
      }
      const files = Array.from(event.dataTransfer.files || [])
      if (files.length) uploadFiles(files)
    })

    async function uploadFiles(files) {
      zone.classList.add('is-busy')
      progress.hidden = false
      for (const file of files) {
        status.textContent = '上传并处理：' + file.name
        progressBar.style.width = '0%'
        try {
          const result = await Studio.uploadMedia({
            collectionId: capability.id,
            itemKey: savedIdentity,
            file,
            onProgress: (ratio) => {
              progressBar.style.width = Math.round(ratio * 100) + '%'
              status.textContent = '上传 ' + file.name + '：' + Math.round(ratio * 100) + '%'
            },
          })
          list.push(result.media)
          markDirty(view.document)
          status.textContent = '已处理：' + file.name
        } catch (error) {
          status.textContent = '失败：' + file.name + ' — ' + error.message
          toast(file.name + '：' + error.message, 'error')
        }
      }
      zone.classList.remove('is-busy')
      progress.hidden = true
      Studio.renderView(view.id)
    }

    section.append(zone, status, progress)

    const mediaList = h('div', { class: 'media-list' })
    if (!list.length) mediaList.appendChild(h('p', { class: 'empty-state', text: labels.empty || '还没有媒体' }))
    list.forEach((media, index) => {
      const row = h('div', { class: 'media-item', draggable: 'true' })
      row.addEventListener('dragstart', (event) => {
        Studio.state.dragMediaId = media.id
        row.classList.add('is-dragging')
        event.dataTransfer.effectAllowed = 'move'
      })
      row.addEventListener('dragend', () => {
        Studio.state.dragMediaId = null
        row.classList.remove('is-dragging')
      })
      row.addEventListener('dragover', (event) => event.preventDefault())
      row.addEventListener('drop', (event) => {
        event.preventDefault()
        reorderMedia(list, view, Studio.state.dragMediaId, media.id)
      })
      const thumb = h('div', { class: 'media-item__thumb' })
      const previewSrc = media.type === 'video' ? media.poster : media.src
      if (previewSrc) {
        thumb.appendChild(h('img', { src: '/preview/' + previewSrc, alt: '', loading: 'lazy' }))
      } else {
        thumb.textContent = media.type === 'video' ? '视频' : '图片'
      }
      const fields = h('div', { class: 'media-item__fields' })
      fields.appendChild(h('div', { class: 'media-item__row' },
        h('span', { class: 'media-item__id', text: String(index + 1).padStart(2, '0') + ' · ' + media.id }),
        capability.coverField && item[capability.coverField] === media.id
          ? h('span', { class: 'badge badge--published', text: '封面' })
          : null
      ))
      for (const spec of view.media.fields || []) {
        const input = Studio.textInput(media[spec.key] || '', (value) => {
          media[spec.key] = value
          markDirty(view.document)
        }, { placeholder: spec.placeholder || '' })
        fields.appendChild(input)
      }
      const actions = h('div', { class: 'media-item__actions' })
      if (capability.coverField) {
        actions.appendChild(button('设为封面', () => {
          item[capability.coverField] = media.id
          markDirty(view.document)
          Studio.renderView(view.id)
        }, 'btn--small btn--ghost'))
      }
      actions.appendChild(button('移除引用', () => {
        list.splice(index, 1)
        if (capability.coverField && item[capability.coverField] === media.id) item[capability.coverField] = null
        markDirty(view.document)
        Studio.renderView(view.id)
      }, 'btn--small btn--danger'))
      fields.appendChild(actions)
      row.append(thumb, fields)
      mediaList.appendChild(row)
    })
    section.appendChild(mediaList)

    if (capability.coverField && list.length) {
      const options = [{ value: '', label: '无封面（使用工程占位）' }].concat(list.map((media) => ({
        value: media.id,
        label: (media.tag || media.caption || media.id) + ' · ' + (media.type === 'video' ? '视频' : '图片'),
      })))
      section.appendChild(field('封面', selectInput(item[capability.coverField] || '', options, (value) => {
        item[capability.coverField] = value || null
        markDirty(view.document)
        Studio.renderView(view.id)
      }), '没有封面时，站点会渲染工程占位画面。'))
    }
    return section
  }

  function reorderMedia(list, view, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return
    const fromIndex = list.findIndex((media) => media.id === fromId)
    const toIndex = list.findIndex((media) => media.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [moved] = list.splice(fromIndex, 1)
    list.splice(toIndex, 0, moved)
    markDirty(view.document)
    Studio.renderView(view.id)
  }

  function renderCollectionView(view, root) {
    const desc = descriptorFor(view)
    if (!desc || desc.kind !== 'collection') {
      root.appendChild(pageHead(view.label, '该视图引用的文档不是集合类型'))
      return
    }
    const items = sortedItems(view)
    if (!items.some((item) => item[desc.identityField] === Studio.state.selections[view.id])) {
      Studio.state.selections[view.id] = items.length ? items[0][desc.identityField] : null
    }
    const layout = h('div', { class: 'projects-layout' })
    const listColumn = h('div')
    listColumn.appendChild(subhead('列表', button((view.item && view.item.addLabel) || '新建', () => createItem(view), 'btn--small btn--primary')))
    const list = h('div', { class: 'project-list' })
    if (!items.length) list.appendChild(h('p', { class: 'empty-state', text: '还没有条目' }))
    for (const item of items) list.appendChild(renderListRow(view, desc, item))
    listColumn.appendChild(list)
    const editorColumn = h('div')
    const selected = selectedItem(view)
    if (selected) editorColumn.appendChild(renderItemEditor(view, desc, selected))
    else editorColumn.appendChild(h('p', { class: 'empty-state', text: '选择左侧条目进行编辑' }))
    layout.append(listColumn, editorColumn)
    root.append(pageHead(view.label, view.description), layout)
  }

  Studio.registerViewType('collection', renderCollectionView)
})()
