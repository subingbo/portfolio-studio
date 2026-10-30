'use strict'

;(function () {
  const Studio = window.Studio
  const { h, button, subhead, pageHead, getPath, setPath, markDirty, renderFields, toast } = Studio

  function avatarInitial(documentData, pointer) {
    const name = (documentData && documentData.profile && documentData.profile.name) ||
      (documentData && documentData.name) || 'P'
    const initial = (documentData && documentData.profile && documentData.profile.initial) || ''
    return String(initial || name).slice(0, 1)
  }

  function renderAvatarCard(view, documentData, rerender) {
    const capability = Studio.state.capabilities.avatar
    if (!capability || capability.document !== view.document) return null
    const avatarPath = getPath(documentData, capability.pointer)
    const card = h('div', { class: 'card avatar-card' })
    card.appendChild(h('div', { class: 'card__head' }, h('span', { class: 'card__title', text: '头像' })))
    const row = h('div', { class: 'avatar-row' })
    const preview = h('div', { class: 'avatar-preview' })
    if (avatarPath) {
      preview.appendChild(h('img', { src: '/preview/' + avatarPath + '?rev=' + Date.now(), alt: '当前头像' }))
    } else {
      preview.appendChild(h('span', { class: 'avatar-preview__letter', text: avatarInitial(documentData, capability.pointer) }))
    }
    const info = h('div', { class: 'avatar-info' })
    info.appendChild(h('p', {
      class: 'muted',
      text: avatarPath
        ? '当前使用本地上传的头像：' + avatarPath
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
    if (avatarPath) {
      actions.appendChild(button('恢复默认', async () => {
        try {
          await Studio.api('/api/avatar/remove', { method: 'POST', body: {} })
          setPath(documentData, capability.pointer, '')
          toast('已恢复默认头像；发布后正式站生效')
          rerender()
        } catch (error) {
          toast(error.message, 'error')
        }
      }, 'btn--small btn--danger'))
    }
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0]
      fileInput.value = ''
      if (!file) return
      status.textContent = '上传并裁剪中…'
      try {
        const result = await Studio.uploadAvatar(file, (ratio) => {
          status.textContent = '上传 ' + Math.round(ratio * 100) + '%'
        })
        setPath(documentData, capability.pointer, result.avatar)
        toast('头像已更新并写入站点资料，发布后正式站生效')
        rerender()
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

  function renderDocumentView(view, root) {
    const documentData = Studio.getDocument(view.document)
    if (!documentData) {
      root.appendChild(pageHead(view.label, '找不到文档：' + view.document))
      return
    }
    const rerender = () => Studio.renderView(view.id)
    root.appendChild(pageHead(view.label, view.description))
    const avatar = renderAvatarCard(view, documentData, rerender)
    if (avatar) root.appendChild(avatar)

    const sections = (view.form && view.form.sections) || []
    for (const section of sections) {
      if (section.title) root.appendChild(subhead(section.title, null))
      const grid = renderFields(section.fields || [], documentData, view.document, rerender)
      root.appendChild(grid)
    }

    root.appendChild(h('div', { class: 'row-actions' },
      button('保存草稿', () => Studio.saveDocument(view.document), 'btn--primary')
    ))
  }

  Studio.registerViewType('document', renderDocumentView)
})()
