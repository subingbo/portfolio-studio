'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { runProcess, tailLines, canonicalJson, assertPublicHttpsUrl, fetchWithTimeout } = require('./util')
const { validateDocuments } = require('./validate')
const { getByPath } = require('./adapters/base')
const { createGit } = require('./git')

function resolveNpmCli() {
  const candidate = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  return fs.existsSync(candidate) ? candidate : null
}

function publishError(code, message, status) {
  return Object.assign(new Error(message), { code, status: status || 409 })
}

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())
}

function formatIssues(issues) {
  return issues
    .slice(0, 40)
    .map((issue) => '[' + issue.level + '] ' + issue.path + '：' + issue.message)
    .join('\n')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 从适配器的 lockFrom 规则中提取发布后应锁定的标识。
function collectLockKeys(adapter, documents) {
  const keys = []
  for (const rule of adapter.publish.lockFrom || []) {
    const documentData = documents[rule.document]
    if (!documentData) continue
    if (rule.via === 'collection') {
      const items = Array.isArray(documentData[rule.itemsKey]) ? documentData[rule.itemsKey] : []
      for (const item of items) {
        if (item && typeof item[rule.field] === 'string' && item[rule.field]) keys.push(item[rule.field])
      }
    } else if (Array.isArray(rule.path)) {
      const value = getByPath(documentData, rule.path)
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (typeof entry === 'string' && entry) keys.push(entry)
        }
      }
    }
  }
  return keys
}

function createPublisher(config, state, contentStore, adapter, options = {}) {
  const git = createGit(config)
  const clients = new Set()
  const publishSpec = adapter.publish || {}
  const stagePaths = Array.isArray(publishSpec.stagePaths) && publishSpec.stagePaths.length
    ? publishSpec.stagePaths
    : ['content', 'media']
  const deployTargets = Array.isArray(publishSpec.deployTargets) ? publishSpec.deployTargets : []
  const commitPrefix = publishSpec.commitPrefix || 'content:'
  const stepLabels = publishSpec.stepLabels || {}
  const deployCheckEnabled = Boolean(config.production.url) &&
    config.production.deployCheck.enabled !== false &&
    deployTargets.length > 0
  const productionHost = config.production.url ? new URL(config.production.url).hostname : ''

  const stepDefinitions = [
    { id: 'validate', label: '校验内容与媒体' },
    { id: 'tests', label: '运行站点测试' },
    { id: 'preflight', label: '检查 Git 状态与远程分支' },
    { id: 'stage', label: stepLabels.stage || '暂存内容与媒体' },
    { id: 'commit', label: '创建提交' },
    { id: 'push', label: '推送到 ' + config.production.branch },
    { id: 'deploy', label: '等待部署生效' },
  ]

  let status = freshStatus()

  function freshStatus() {
    return {
      running: false,
      outcome: 'idle',
      message: '',
      startedAt: null,
      finishedAt: null,
      steps: stepDefinitions.map((step) => Object.assign({}, step, { status: 'pending', detail: '', log: '' })),
    }
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(status))
  }

  function broadcast() {
    if (!clients.size) return
    const payload = 'event: status\ndata: ' + JSON.stringify(snapshot()) + '\n\n'
    for (const response of clients) {
      try {
        response.write(payload)
      } catch (error) {
        clients.delete(response)
      }
    }
  }

  function step(id) {
    return status.steps.find((entry) => entry.id === id)
  }

  function setStep(id, stepStatus, detail, log) {
    const entry = step(id)
    if (!entry) return
    entry.status = stepStatus
    if (detail !== undefined) entry.detail = detail
    if (log !== undefined) entry.log = log
    broadcast()
  }

  function finish(outcome, message) {
    status.running = false
    status.outcome = outcome
    status.message = message
    status.finishedAt = new Date().toISOString()
    broadcast()
  }

  async function waitForDeploy(documents) {
    if (options.deployProbe) {
      return options.deployProbe({ documents })
    }
    if (!deployCheckEnabled) {
      return { ok: true, skipped: true, detail: '部署确认已关闭（在 config.json 的 production.deployCheck 中启用）' }
    }
    const targets = deployTargets.map((target) => ({
      url: config.production.url + target.urlPath,
      value: documents[target.document],
      documentId: target.document,
    }))
    const startedAt = Date.now()
    let attempt = 0
    let lastError = '尚未收到响应'
    while (Date.now() - startedAt < config.limits.deployPollTimeoutMs) {
      attempt += 1
      let matched = true
      for (const target of targets) {
        try {
          await assertPublicHttpsUrl(target.url, productionHost)
          const response = await fetchWithTimeout(target.url + '?rev=' + Date.now(), { timeoutMs: 15000 })
          if (!response.ok) {
            matched = false
            lastError = 'HTTP ' + response.status
            continue
          }
          const body = await response.text()
          let remote
          try {
            remote = JSON.parse(body)
          } catch (error) {
            matched = false
            lastError = '返回内容不是 JSON'
            continue
          }
          if (canonicalJson(remote) !== canonicalJson(target.value)) {
            matched = false
            lastError = '站点内容尚未更新'
          }
        } catch (error) {
          matched = false
          lastError = error.message
        }
      }
      if (matched) {
        return { ok: true, detail: '正式域名已返回最新内容（第 ' + attempt + ' 次检查）' }
      }
      setStep('deploy', 'running', '第 ' + attempt + ' 次检查未完成：' + lastError + '，继续轮询…')
      await sleep(config.limits.deployPollIntervalMs)
    }
    return {
      ok: false,
      timeout: true,
      detail: '已推送，但 ' + Math.round(config.limits.deployPollTimeoutMs / 60000) + ' 分钟内未确认部署完成（' +
        lastError + '）。静态托管通常几分钟内完成，可稍后刷新 ' + config.production.url + ' 确认。',
    }
  }

  async function run() {
    const documents = await contentStore.readAll()

    setStep('validate', 'running')
    const validation = validateDocuments({ adapter, documents, config, mode: 'publish' })
    if (!validation.ok) {
      setStep('validate', 'failed', validation.errors.length + ' 个错误', formatIssues(validation.errors))
      finish('failed', '内容校验未通过：' + validation.errors[0].message)
      return
    }
    setStep('validate', 'passed', validation.warnings.length ? validation.warnings.length + ' 个提醒' : '通过', formatIssues(validation.warnings))

    setStep('tests', 'running')
    const npmCli = resolveNpmCli()
    if (!npmCli) {
      setStep('tests', 'failed', '找不到 npm-cli.js', '')
      finish('failed', '未找到当前 Node 自带的 npm-cli.js，请使用标准 Node 安装运行工作台。')
      return
    }
    const scriptName = String(config.production.testScript || 'test')
    if (!/^[A-Za-z0-9:_-]+$/.test(scriptName)) {
      setStep('tests', 'failed', '测试脚本名不合法', scriptName)
      finish('failed', '站点测试脚本名不合法：' + scriptName)
      return
    }
    try {
      const tests = await runProcess(process.execPath, [npmCli, scriptName], {
        cwd: config.sitePath,
        timeoutMs: config.limits.testTimeoutMs,
      })
      setStep('tests', 'passed', '站点测试通过', tailLines(tests.stdout, 20))
    } catch (error) {
      setStep('tests', 'failed', '站点测试未通过', tailLines((error.stdout || '') + '\n' + (error.stderr || ''), 40))
      finish('failed', '站点验收测试未通过，未创建任何提交。请修复后重试。')
      return
    }

    setStep('preflight', 'running')
    let ahead = 0
    try {
      const branch = await git.branch()
      if (branch !== config.production.branch) {
        throw new Error('当前分支是 ' + branch + '，不是 ' + config.production.branch)
      }
      let remote = ''
      try {
        remote = await git.remoteUrl()
      } catch (error) {
        remote = ''
      }
      const expectedRemote = config.production.expectedRemote
      if (expectedRemote && git.normalizeRemote(remote) !== git.normalizeRemote(expectedRemote)) {
        throw new Error('origin 地址不符合预期：' + (remote || '未配置'))
      }
      const staged = await git.stagedFiles()
      if (staged.length) {
        throw new Error('暂存区已有未提交文件，请先处理：' + staged.join('、'))
      }
      if (!remote) {
        setStep('preflight', 'passed', '未配置 origin，跳过远程同步检查')
      } else {
        await git.fetchMain()
        const counts = await git.aheadBehind()
        ahead = counts.ahead
        if (counts.behind > 0) {
          throw new Error(
            '本地 ' + config.production.branch + ' 落后或分叉于 origin/' + config.production.branch +
            '（落后 ' + counts.behind + ' 个提交）。请先手动同步，工作台不会自动覆盖或变基。'
          )
        }
        setStep('preflight', 'passed', ahead > 0 ? '本地领先远程 ' + ahead + ' 个提交' : '本地与远程一致')
      }
    } catch (error) {
      setStep('preflight', 'failed', 'Git 检查未通过', error.message)
      finish('failed', 'Git 前置检查未通过：' + error.message)
      return
    }

    setStep('stage', 'running')
    let staged
    try {
      await git.addContent(stagePaths)
      staged = await git.stagedFiles()
      const unexpected = staged.filter((file) => {
        return !stagePaths.some((root) => file === root || file.startsWith(root + '/'))
      })
      if (unexpected.length) {
        throw new Error('暂存区包含发布路径之外的文件：' + unexpected.join('、'))
      }
      setStep('stage', 'passed', staged.length ? staged.length + ' 个文件' : '没有变更')
    } catch (error) {
      setStep('stage', 'failed', '暂存失败', error.message)
      finish('failed', '暂存内容失败：' + error.message)
      return
    }

    if (staged.length === 0) {
      setStep('commit', 'skipped', '没有内容变更')
      setStep('push', 'skipped', '没有内容变更')
      setStep('deploy', 'skipped', '没有内容变更')
      finish('no-changes', '发布路径下没有变更，无需发布。')
      return
    }

    setStep('commit', 'running')
    const message = commitPrefix + ' 工作台内容更新 ' + timestamp()
    try {
      await git.commit(message)
      setStep('commit', 'passed', message, await git.logLine())
    } catch (error) {
      setStep('commit', 'failed', '提交失败', error.message)
      finish('failed', '创建提交失败：' + error.message)
      return
    }

    setStep('push', 'running')
    try {
      await git.push()
      setStep('push', 'passed', '已推送到 origin/' + config.production.branch)
    } catch (error) {
      setStep('push', 'failed', '推送失败', tailLines((error.stdout || '') + '\n' + (error.stderr || ''), 20))
      finish('failed', '推送失败。本地提交已保留，检查本机 GitHub 凭据或网络后可再次点击发布（若已手动推送，可忽略）。')
      return
    }

    const lockKeys = collectLockKeys(adapter, documents)
    if (lockKeys.length) state.lockSlugs(lockKeys)

    setStep('deploy', 'running', deployCheckEnabled ? '等待正式域名返回最新内容…' : '部署确认已关闭…')
    const deploy = await waitForDeploy(documents)
    if (deploy.ok) {
      if (deploy.skipped) {
        setStep('deploy', 'skipped', deploy.detail)
        finish('published', '发布完成：已推送，部署确认已关闭。')
      } else {
        setStep('deploy', 'passed', deploy.detail)
        finish('published', '发布完成：' + deploy.detail)
      }
    } else {
      setStep('deploy', 'timeout', deploy.detail)
      finish('pushed-pending-deploy', deploy.detail)
    }
  }

  async function start() {
    if (status.running) {
      throw publishError('PUBLISH_RUNNING', '已有发布任务在进行中')
    }
    status = freshStatus()
    status.running = true
    status.startedAt = new Date().toISOString()
    status.outcome = 'running'
    status.message = '正在发布…'
    broadcast()
    run().catch((error) => {
      const running = status.steps.find((entry) => entry.status === 'running')
      if (running) {
        running.status = 'failed'
        running.detail = '异常中断'
        running.log = error.message
      }
      finish('failed', '发布过程出现异常：' + error.message)
    })
    return snapshot()
  }

  function subscribe(request, response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    response.write('event: status\ndata: ' + JSON.stringify(snapshot()) + '\n\n')
    clients.add(response)
    const heartbeat = setInterval(() => {
      try {
        response.write(': heartbeat\n\n')
      } catch (error) {
        clients.delete(response)
      }
    }, 20000)
    request.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(response)
    })
    return heartbeat
  }

  return { start, subscribe, snapshot }
}

module.exports = { createPublisher, collectLockKeys }
