'use strict'

;(function () {
  const Studio = window.Studio
  const {
    h, button, pageHead, toast, markDirty, getDocument, uploadMedia,
    saveDocument, renderView, state,
  } = Studio

  Studio.registerFieldComponent('color', function renderColorField(context) {
    const input = h('input', { type: 'color', value: context.value || '#f97316' })
    const text = Studio.textInput(context.value || '#f97316', (value) => {
      input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : input.value
      context.onChange(value)
    })
    input.addEventListener('input', () => {
      text.value = input.value
      context.onChange(input.value)
    })
    return h('div', { class: 'field field--wide' },
      h('span', { class: 'field__label', text: context.field.label || '颜色' }),
      h('div', { class: 'media-item__row' }, input, text),
      h('span', { class: 'field__hint', text: '十六进制颜色，例如 #f97316' })
    )
  })

  Studio.registerViewComponent('gallery-editor', function renderGallery(view, root) {
    const documentData = getDocument('landing')
    const capability = (state.capabilities.media || []).find((entry) => entry.id === 'images')
    const images = Array.isArray(documentData.images) ? documentData.images : []
    if (!Array.isArray(documentData.images)) documentData.images = images
    root.appendChild(pageHead('页面图片', '上传图片后写入 landing.json 的 images 数组；替代文本在发布时必填。'))
    if (!capability) {
      root.appendChild(h('p', { class: 'empty-state', text: '适配器没有配置图片集合' }))
      return
    }
    const zone = h('div', { class: 'dropzone' })
    zone.appendChild(h('span', { text: '拖拽或点击上传图片' }))
    zone.appendChild(h('small', { text: 'JPG / PNG / WebP，自动转 WebP（最长边 1600、≤2 MiB）' }))
    const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, style: 'display:none' })
    zone.appendChild(fileInput)
    const status = h('div', { class: 'upload-status' })
    const progress = h('div', { class: 'progress' }, h('span'))
    const bar = progress.firstChild
    zone.addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || [])
      fileInput.value = ''
      if (files.length) upload(files)
    })
    zone.addEventListener('dragover', (event) => event.preventDefault())
    zone.addEventListener('drop', (event) => {
      event.preventDefault()
      const files = Array.from(event.dataTransfer.files || [])
      if (files.length) upload(files)
    })

    async function upload(files) {
      for (const file of files) {
        status.textContent = '上传：' + file.name
        try {
          const result = await uploadMedia({
            collectionId: 'images',
            itemKey: null,
            file,
            onProgress: (ratio) => {
              bar.style.width = Math.round(ratio * 100) + '%'
            },
          })
          images.push(result.media)
          markDirty('landing')
          status.textContent = '已添加：' + file.name
        } catch (error) {
          status.textContent = '失败：' + file.name + ' — ' + error.message
          toast(error.message, 'error')
        }
      }
      renderView(view.id)
    }

    const list = h('div', { class: 'media-list' })
    if (!images.length) list.appendChild(h('p', { class: 'empty-state', text: '还没有图片' }))
    images.forEach((image, index) => {
      const row = h('div', { class: 'media-item' })
      const thumb = h('div', { class: 'media-item__thumb' })
      if (image.src) thumb.appendChild(h('img', { src: '/preview/' + image.src, alt: '' }))
      const fields = h('div', { class: 'media-item__fields' })
      fields.appendChild(h('div', { class: 'media-item__row' }, h('span', { class: 'media-item__id', text: image.id })))
      fields.appendChild(Studio.textInput(image.alt || '', (value) => {
        image.alt = value
        markDirty('landing')
      }, { placeholder: '替代文本（发布必填）' }))
      fields.appendChild(Studio.textInput(image.caption || '', (value) => {
        image.caption = value
        markDirty('landing')
      }, { placeholder: '图片说明' }))
      fields.appendChild(h('div', { class: 'media-item__actions' }, button('移除', () => {
        images.splice(index, 1)
        markDirty('landing')
        renderView(view.id)
      }, 'btn--small btn--danger')))
      row.append(thumb, fields)
      list.appendChild(row)
    })
    root.append(zone, status, progress, list)
    root.appendChild(h('div', { class: 'row-actions' },
      button('保存草稿', () => saveDocument('landing'), 'btn--primary')
    ))
  })
})()
