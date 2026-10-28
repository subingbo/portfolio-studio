'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { writeJsonAtomic } = require('./util')

function createState(config) {
  fs.mkdirSync(config.paths.studioState, { recursive: true })
  fs.mkdirSync(config.paths.backups, { recursive: true })
  fs.mkdirSync(config.paths.temp, { recursive: true })

  const stateFile = path.join(config.paths.studioState, 'state.json')
  let stored = { lockedSlugs: [] }
  if (fs.existsSync(stateFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      if (Array.isArray(parsed.lockedSlugs)) {
        stored.lockedSlugs = parsed.lockedSlugs.filter((slug) => typeof slug === 'string')
      }
    } catch (error) {
      stored = { lockedSlugs: [] }
    }
  }

  // 每次启动重新生成会话令牌，写接口必须携带它。
  const token = crypto.randomBytes(24).toString('hex')
  const lockedSlugs = new Set(stored.lockedSlugs)

  function persist() {
    writeJsonAtomic(stateFile, { lockedSlugs: Array.from(lockedSlugs).sort() }).catch((error) => {
      console.error('保存工作台状态失败：', error.message)
    })
  }

  return {
    token,
    isLocked(slug) {
      return lockedSlugs.has(slug)
    },
    lockSlugs(slugs) {
      let changed = false
      for (const slug of slugs) {
        if (!lockedSlugs.has(slug)) {
          lockedSlugs.add(slug)
          changed = true
        }
      }
      if (changed) persist()
    },
    lockedSlugList() {
      return Array.from(lockedSlugs).sort()
    },
  }
}

module.exports = { createState }
