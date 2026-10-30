'use strict'

;(function () {
  const Studio = window.Studio
  const { h, button, subhead, pageHead, toast } = Studio

  function renderIssues(box, result) {
    box.replaceChildren()
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
  }

  async function runValidation(box) {
    box.replaceChildren(h('p', { class: 'muted', text: '正在校验…' }))
    try {
      const result = await Studio.api('/api/validate', { method: 'POST' })
      box.replaceChildren(subhead('校验结果', null))
      renderIssues(box, result)
    } catch (error) {
      box.replaceChildren(h('p', { class: 'publish-message is-error', text: error.message }))
    }
  }

  async function startPublish() {
    if (!window.confirm('将运行站点测试并推送发布路径到 origin，随后等待部署生效。继续？')) return
    try {
      const status = await Studio.api('/api/publish', { method: 'POST' })
      Studio.state.publishStatus = status
      update(status)
      Studio.ensurePublishStream()
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  function renderStatus(status) {
    const box = document.getElementById('publish-box')
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

  function update(status) {
    renderStatus(status)
  }

  function renderPublishView(view, root) {
    root.append(
      pageHead(view.label || '发布', view.description || '校验 → 运行站点测试 → Git 前置检查 → 暂存发布路径 → 提交 → 推送 → 等待部署生效。'),
      h('div', { class: 'card' },
        h('p', { class: 'muted', text: '发布不会包含发布路径之外的修改；如果暂存区已有文件或本地分支落后，会停止并提示。' }),
        h('div', { class: 'row-actions' },
          button('运行校验', () => runValidation(document.getElementById('validation-box')), 'btn--ghost'),
          button('发布到正式站', startPublish, 'btn--primary')
        )
      ),
      h('div', { id: 'validation-box' }),
      h('div', { id: 'publish-box' })
    )
    Studio.ensurePublishStream()
    if (Studio.state.publishStatus) {
      renderStatus(Studio.state.publishStatus)
    } else {
      Studio.api('/api/publish/status').then((status) => {
        Studio.state.publishStatus = status
        renderStatus(status)
      }).catch(() => {})
    }
  }

  renderPublishView.update = update
  Studio.registerViewType('publish', renderPublishView)
})()
