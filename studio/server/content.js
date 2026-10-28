'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { backupFile, readJson, writeJsonAtomic, SAFE_FILE_NAME } = require('./util')
const { validateContent, SLUG_PATTERN } = require('./validate')

function contentError(code, message) {
  return Object.assign(new Error(message), { code })
}

function projectDir(config, slug) {
  if (!SLUG_PATTERN.test(slug || '')) {
    throw contentError('INVALID_SLUG', '项目 slug 不合法')
  }
  return path.join(config.paths.siteMedia, 'projects', slug)
}

function createContentStore(config, state) {
  async function readSite() {
    return readJson(config.paths.siteSiteFile)
  }

  async function readProjects() {
    return readJson(config.paths.siteProjectsFile)
  }

  async function currentSlugs() {
    if (!fs.existsSync(config.paths.siteProjectsFile)) return []
    const data = await readProjects()
    return (data.projects || []).map((project) => project.slug)
  }

  function planRenames(currentProjects, incomingProjects, renames) {
    const currentSlugs = new Set(currentProjects.map((project) => project.slug))
    const incomingSlugs = new Set(incomingProjects.map((project) => project.slug))
    const seenFrom = new Set()
    const seenTo = new Set()
    const planned = []
    for (const entry of renames || []) {
      if (!entry || !SLUG_PATTERN.test(entry.from || '') || !SLUG_PATTERN.test(entry.to || '')) {
        throw contentError('INVALID_RENAME', 'slug 改名参数不合法')
      }
      if (entry.from === entry.to) continue
      if (seenFrom.has(entry.from) || seenTo.has(entry.to)) {
        throw contentError('INVALID_RENAME', 'slug 改名请求重复')
      }
      seenFrom.add(entry.from)
      seenTo.add(entry.to)
      if (!currentSlugs.has(entry.from)) {
        throw contentError('INVALID_RENAME', '要改名的项目不存在：' + entry.from)
      }
      if (!incomingSlugs.has(entry.to)) {
        throw contentError('INVALID_RENAME', '改名后的 slug 不在提交内容中：' + entry.to)
      }
      if (incomingSlugs.has(entry.from)) {
        throw contentError('INVALID_RENAME', '旧 slug 仍被其他项目占用：' + entry.from)
      }
      if (state.isLocked(entry.from)) {
        throw contentError('SLUG_LOCKED', '项目已发布，slug 已锁定：' + entry.from)
      }
      if (state.isLocked(entry.to)) {
        throw contentError('SLUG_LOCKED', '目标 slug 属于已发布项目：' + entry.to)
      }
      if (currentSlugs.has(entry.to)) {
        throw contentError('SLUG_TAKEN', '目标 slug 已被其他项目使用：' + entry.to)
      }
      planned.push(entry)
    }
    return planned
  }

  async function renameMediaDirectories(planned) {
    const completed = []
    for (const entry of planned) {
      const oldDir = projectDir(config, entry.from)
      const newDir = projectDir(config, entry.to)
      if (!fs.existsSync(oldDir)) {
        completed.push({ oldDir, newDir, merged: false, moved: false })
        continue
      }
      if (!fs.existsSync(newDir)) {
        await fsp.rename(oldDir, newDir)
        completed.push({ oldDir, newDir, merged: false, moved: true })
        continue
      }
      const names = await fsp.readdir(oldDir)
      for (const name of names) {
        if (!SAFE_FILE_NAME.test(name)) {
          throw contentError('INVALID_MEDIA_NAME', '媒体目录中存在不合法文件名：' + name)
        }
        await fsp.rename(path.join(oldDir, name), path.join(newDir, name))
      }
      await fsp.rmdir(oldDir)
      completed.push({ oldDir, newDir, merged: true, moved: true })
    }
    return completed
  }

  async function rollbackRenames(completed) {
    for (const entry of completed.slice().reverse()) {
      if (!entry.moved) continue
      try {
        if (!fs.existsSync(entry.newDir)) continue
        if (!entry.merged && !fs.existsSync(entry.oldDir)) {
          await fsp.rename(entry.newDir, entry.oldDir)
          continue
        }
        if (entry.merged && !fs.existsSync(entry.oldDir)) {
          await fsp.mkdir(entry.oldDir, { recursive: true })
          const names = await fsp.readdir(entry.newDir)
          for (const name of names) {
            if (!SAFE_FILE_NAME.test(name)) continue
            await fsp.rename(path.join(entry.newDir, name), path.join(entry.oldDir, name))
          }
          await fsp.rmdir(entry.newDir)
        }
      } catch (error) {
        // 回滚尽力而为；失败时保留现状并提示手动检查媒体目录。
      }
    }
  }

  function rewriteMediaPaths(incoming, renames) {
    for (const entry of renames) {
      const project = incoming.find((item) => item.slug === entry.to)
      if (!project || !Array.isArray(project.media)) continue
      const fromPrefix = 'media/projects/' + entry.from + '/'
      const toPrefix = 'media/projects/' + entry.to + '/'
      for (const item of project.media) {
        if (typeof item.src === 'string' && item.src.startsWith(fromPrefix)) {
          item.src = toPrefix + item.src.slice(fromPrefix.length)
        }
        if (typeof item.poster === 'string' && item.poster.startsWith(fromPrefix)) {
          item.poster = toPrefix + item.poster.slice(fromPrefix.length)
        }
      }
    }
  }

  async function saveSite(site) {
    const projects = await readProjects()
    const result = validateContent({ site, projects, config, mode: 'save' })
    if (!result.ok) {
      return { ok: false, errors: result.errors, warnings: result.warnings }
    }
    const backup = await backupFile(config.paths.siteSiteFile, config.paths.backups)
    await writeJsonAtomic(config.paths.siteSiteFile, site)
    return { ok: true, warnings: result.warnings, backup }
  }

  async function saveProjects(data, renames = []) {
    if (!data || !Array.isArray(data.projects)) {
      return { ok: false, errors: [{ level: 'error', code: 'schema', path: 'projects', message: '需要 projects 数组' }], warnings: [] }
    }
    const current = await readProjects()
    const currentProjects = Array.isArray(current.projects) ? current.projects : []
    const incomingProjects = data.projects

    for (const project of currentProjects) {
      if (state.isLocked(project.slug) && !incomingProjects.some((item) => item.slug === project.slug)) {
        return {
          ok: false,
          errors: [{ level: 'error', code: 'SLUG_LOCKED', path: project.slug, message: '已发布项目的 slug 不能修改或删除：' + project.slug }],
          warnings: [],
        }
      }
    }

    let planned
    try {
      planned = planRenames(currentProjects, incomingProjects, renames)
    } catch (error) {
      return { ok: false, errors: [{ level: 'error', code: error.code || 'RENAME', path: 'renames', message: error.message }], warnings: [] }
    }
    rewriteMediaPaths(incomingProjects, planned)

    const result = validateContent({ site: await readSite().catch(() => null), projects: data, config, mode: 'save' })
    if (!result.ok) {
      return { ok: false, errors: result.errors, warnings: result.warnings }
    }

    let completed = []
    try {
      completed = await renameMediaDirectories(planned)
    } catch (error) {
      await rollbackRenames(completed)
      return { ok: false, errors: [{ level: 'error', code: error.code || 'RENAME_FAILED', path: 'renames', message: error.message }], warnings: [] }
    }
    try {
      const backup = await backupFile(config.paths.siteProjectsFile, config.paths.backups)
      await writeJsonAtomic(config.paths.siteProjectsFile, data)
      return { ok: true, warnings: result.warnings, backup, renames: planned }
    } catch (error) {
      await rollbackRenames(completed)
      throw error
    }
  }

  return { readSite, readProjects, saveSite, saveProjects, currentSlugs }
}

module.exports = { createContentStore, contentError }
