'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MIB = 1024 * 1024
const studioRoot = path.resolve(__dirname, '..')

function resolveInside(rootDir, candidate) {
  const boundary = path.resolve(rootDir)
  const target = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(boundary, candidate)
  if (target !== boundary && !target.startsWith(boundary + path.sep)) {
    throw Object.assign(new Error('路径越界：' + candidate), { code: 'PATH_ESCAPE' })
  }
  return target
}

function loadConfig(overrides = {}) {
  const root = overrides.studioRoot ? path.resolve(overrides.studioRoot) : studioRoot
  const file = path.join(root, 'config.json')
  let fileConfig = {}
  if (root === studioRoot && fs.existsSync(file)) {
    fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  const productionConfig = Object.assign(
    {
      url: '',
      expectedRemote: '',
      branch: 'main',
      deployCheck: { enabled: false },
      testScript: 'test',
    },
    fileConfig.production || {},
    overrides.production || {}
  )
  const production = {
    url: String(process.env.STUDIO_SITE_URL || productionConfig.url || ''),
    expectedRemote: String(process.env.STUDIO_GIT_REMOTE || productionConfig.expectedRemote || ''),
    branch: String(process.env.STUDIO_GIT_BRANCH || productionConfig.branch || 'main'),
    deployCheck: Object.assign({ enabled: false }, productionConfig.deployCheck || {}),
    testScript: String(productionConfig.testScript || 'test'),
  }
  const sitePath = path.resolve(
    root,
    overrides.sitePath || process.env.STUDIO_SITE_PATH || fileConfig.sitePath || '..'
  )
  const adapter = String(overrides.adapter || process.env.STUDIO_ADAPTER || fileConfig.adapter || 'portfolio')
  return {
    studioRoot: root,
    sitePath,
    adapter,
    port: Number(overrides.port || process.env.STUDIO_PORT || fileConfig.port || 3737),
    production,
    limits: Object.assign(
      {
        imageMaxBytes: 2 * MIB,
        videoMaxBytes: 18 * MIB,
        mediaTotalMaxBytes: 80 * MIB,
        imageMaxSide: 1920,
        videoMaxDurationSeconds: 12,
        videoMaxWidth: 1080,
        uploadImageMaxBytes: 30 * MIB,
        uploadVideoMaxBytes: 500 * MIB,
        imageProcessTimeoutMs: 60 * 1000,
        videoProcessTimeoutMs: 120 * 1000,
        deployPollTimeoutMs: 10 * 60 * 1000,
        deployPollIntervalMs: 15 * 1000,
        testTimeoutMs: 3 * 60 * 1000,
      },
      fileConfig.limits || {},
      overrides.limits || {}
    ),
    paths: {
      siteContent: path.join(sitePath, 'content'),
      siteMedia: path.join(sitePath, 'media'),
      siteProjectsFile: path.join(sitePath, 'content', 'projects.json'),
      siteSiteFile: path.join(sitePath, 'content', 'site.json'),
      studioState: path.join(root, '.studio'),
      backups: path.join(root, '.studio', 'backups'),
      temp: path.join(root, '.studio', 'tmp'),
      web: path.join(root, 'web'),
    },
  }
}

module.exports = { loadConfig, resolveInside, studioRoot }
