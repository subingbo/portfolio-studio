'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { runProcess } = require('./util')

function normalizeRemote(value) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase()
}

function directoryHasFiles(directory) {
  const stack = [directory]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (error) {
      continue
    }
    for (const entry of entries) {
      if (!/^[A-Za-z0-9._-]+$/.test(entry.name)) continue
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name))
      } else if (entry.isFile()) {
        return true
      }
    }
  }
  return false
}

function createGit(config) {
  const cwd = config.sitePath
  const branchName = config.production.branch

  function git(args, options = {}) {
    return runProcess('git', args, { cwd, timeoutMs: options.timeoutMs || 60000 })
  }

  return {
    cwd,
    branchName,
    normalizeRemote,
    async branch() {
      const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
      return stdout.trim()
    },
    async remoteUrl() {
      const { stdout } = await git(['remote', 'get-url', 'origin'])
      return stdout.trim()
    },
    async stagedFiles() {
      const { stdout } = await git(['diff', '--cached', '--name-only'])
      return stdout.split(/\r?\n/).filter(Boolean)
    },
    async statusPorcelain() {
      const { stdout } = await git(['status', '--porcelain'])
      return stdout.split(/\r?\n/).filter(Boolean)
    },
    async fetchMain() {
      await git(['fetch', 'origin', branchName], { timeoutMs: 120000 })
    },
    async aheadBehind() {
      const { stdout } = await git(['rev-list', '--left-right', '--count', branchName + '...origin/' + branchName])
      const [ahead, behind] = stdout.trim().split(/\s+/).map(Number)
      return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 }
    },
    async addContent(stagePaths) {
      const targets = []
      for (const relative of stagePaths || []) {
        const absolute = path.join(cwd, relative)
        if (!fs.existsSync(absolute)) continue
        if (fs.statSync(absolute).isFile() || directoryHasFiles(absolute)) {
          targets.push(relative)
        }
      }
      if (!targets.length) return
      await git(['add', '-A', '--', ...targets])
    },
    async commit(message) {
      await git(['commit', '-m', message])
    },
    async push() {
      await git(['push', 'origin', branchName], { timeoutMs: 180000 })
    },
    async head() {
      const { stdout } = await git(['rev-parse', 'HEAD'])
      return stdout.trim()
    },
    async logLine() {
      const { stdout } = await git(['log', '--oneline', '-1'])
      return stdout.trim()
    },
  }
}

module.exports = { createGit, normalizeRemote }

