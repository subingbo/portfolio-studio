'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { backupFile, readJson, writeJsonAtomic, SAFE_FILE_NAME } = require('./util')
const { resolveInside } = require('./config')
const { validateDocuments, SLUG_PATTERN } = require('./validate')

function contentError(code, message) {
  return Object.assign(new Error(message), { code })
}

function createDocumentStore(config, state, adapter) {
  const descriptors = new Map(adapter.documents.map((doc) => [doc.id, doc]))

  function descriptor(id) {
    const found = descriptors.get(id)
    if (!found) throw contentError('UNKNOWN_DOCUMENT', '未知内容文档：' + id)
    return found
  }

  function fileFor(doc) {
    return resolveInside(config.sitePath, doc.file)
  }

  function identityPattern(doc) {
    return doc.identityPattern || SLUG_PATTERN
  }

  function itemsOf(doc, data) {
    if (!data || !Array.isArray(data[doc.itemsKey])) return []
    return data[doc.itemsKey]
  }

  function identityOf(doc, item) {
    return item && typeof item === 'object' ? item[doc.identityField] : undefined
  }

  async function readDocument(id) {
    return readJson(fileFor(descriptor(id)))
  }

  async function readAll() {
    const documents = {}
    for (const doc of adapter.documents) {
      documents[doc.id] = await readJson(fileFor(doc))
    }
    return documents
  }

  function mediaCollectionsFor(doc) {
    return adapter.mediaCollections.filter((collection) => {
      return collection.mode === 'collection' && collection.document === doc.id && collection.dirKey === doc.identityField
    })
  }

  function planRenames(doc, current, incoming, renames) {
    if (doc.kind !== 'collection') {
      throw contentError('INVALID_RENAME', '只有集合文档支持改名')
    }
    const currentIds = new Set(itemsOf(doc, current).map((item) => identityOf(doc, item)))
    const incomingIds = new Set(itemsOf(doc, incoming).map((item) => identityOf(doc, item)))
    const planned = []
    const seenFrom = new Set()
    const seenTo = new Set()
    for (const entry of renames || []) {
      if (!entry || typeof entry.from !== 'string' || typeof entry.to !== 'string') {
        throw contentError('INVALID_RENAME', '改名参数不合法')
      }
      if (entry.from === entry.to) continue
      if (!identityPattern(doc).test(entry.from) || !identityPattern(doc).test(entry.to)) {
        throw contentError('INVALID_RENAME', 'slug 不合法：' + entry.from + ' → ' + entry.to)
      }
      if (seenFrom.has(entry.from) || seenTo.has(entry.to)) {
        throw contentError('INVALID_RENAME', '改名请求重复')
      }
      seenFrom.add(entry.from)
      seenTo.add(entry.to)
      if (!currentIds.has(entry.from)) {
        throw contentError('INVALID_RENAME', '要改名的项目不存在：' + entry.from)
      }
      if (!incomingIds.has(entry.to)) {
        throw contentError('INVALID_RENAME', '改名后的 slug 不在提交内容中：' + entry.to)
      }
      if (incomingIds.has(entry.from)) {
        throw contentError('INVALID_RENAME', '旧 slug 仍被占用：' + entry.from)
      }
      if (state.isLocked(entry.from)) {
        throw contentError('SLUG_LOCKED', '项目已发布，slug 已锁定：' + entry.from)
      }
      if (state.isLocked(entry.to)) {
        throw contentError('SLUG_LOCKED', '目标 slug 属于已发布项目：' + entry.to)
      }
      if (currentIds.has(entry.to)) {
        throw contentError('SLUG_TAKEN', '目标 slug 已被其他项目使用：' + entry.to)
      }
      planned.push(entry)
    }
    return planned
  }

  function rewriteMediaPaths(doc, incoming, planned) {
    for (const entry of planned) {
      const item = itemsOf(doc, incoming).find((candidate) => identityOf(doc, candidate) === entry.to)
      if (!item) continue
      for (const collection of mediaCollectionsFor(doc)) {
        const list = Array.isArray(item[collection.mediaField]) ? item[collection.mediaField] : []
        const fromPrefix = collection.root + '/' + entry.from + '/'
        const toPrefix = collection.root + '/' + entry.to + '/'
        for (const media of list) {
          if (!media || typeof media !== 'object') continue
          for (const field of ['src', 'poster']) {
            const value = media[field]
            if (typeof value === 'string' && value.startsWith(fromPrefix)) {
              media[field] = toPrefix + value.slice(fromPrefix.length)
            }
          }
        }
      }
    }
  }

  async function moveDirectories(doc, planned) {
    const completed = []
    for (const collection of mediaCollectionsFor(doc)) {
      for (const entry of planned) {
        const oldDir = resolveInside(config.sitePath, collection.root + '/' + entry.from)
        const newDir = resolveInside(config.sitePath, collection.root + '/' + entry.to)
        if (!fs.existsSync(oldDir)) {
          completed.push({ oldDir, newDir, moved: false, merged: false })
          continue
        }
        if (!fs.existsSync(newDir)) {
          await fsp.rename(oldDir, newDir)
          completed.push({ oldDir, newDir, moved: true, merged: false })
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
        completed.push({ oldDir, newDir, moved: true, merged: true })
      }
    }
    return completed
  }

  async function rollbackDirectories(completed) {
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

  function validationFailure(error) {
    return {
      ok: false,
      errors: [{ level: 'error', code: error.code || 'INVALID', path: 'content', message: error.message }],
      warnings: [],
    }
  }

  async function saveDocument(id, data, options = {}) {
    const doc = descriptor(id)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        ok: false,
        errors: [{ level: 'error', code: 'schema', path: id, message: '文档必须是 JSON 对象' }],
        warnings: [],
      }
    }
    const current = await readDocument(id)
    const renames = Array.isArray(options.renames) ? options.renames : []

    if (doc.kind === 'collection') {
      const incomingIds = new Set(itemsOf(doc, data).map((item) => identityOf(doc, item)))
      for (const item of itemsOf(doc, current)) {
        const value = identityOf(doc, item)
        if (state.isLocked(value) && !incomingIds.has(value)) {
          return {
            ok: false,
            errors: [{ level: 'error', code: 'SLUG_LOCKED', path: String(value), message: '已发布项目的 slug 不能修改或删除：' + value }],
            warnings: [],
          }
        }
      }
    }

    let planned = []
    if (doc.kind === 'collection' && renames.length) {
      try {
        planned = planRenames(doc, current, data, renames)
      } catch (error) {
        return validationFailure(error)
      }
    }
    rewriteMediaPaths(doc, data, planned)

    const documents = await readAll()
    documents[id] = data
    const result = validateDocuments({ adapter, documents, config, mode: 'save' })
    if (!result.ok) {
      return { ok: false, errors: result.errors, warnings: result.warnings }
    }

    let completed = []
    try {
      completed = await moveDirectories(doc, planned)
    } catch (error) {
      await rollbackDirectories(completed)
      return validationFailure(error)
    }
    try {
      const backup = await backupFile(fileFor(doc), config.paths.backups)
      await writeJsonAtomic(fileFor(doc), data)
      return { ok: true, warnings: result.warnings, backup, renames: planned }
    } catch (error) {
      await rollbackDirectories(completed)
      throw error
    }
  }

  async function identityValues(id) {
    const doc = descriptor(id)
    if (doc.kind !== 'collection') return []
    const data = await readDocument(id)
    return itemsOf(doc, data).map((item) => identityOf(doc, item)).filter(Boolean)
  }

  return {
    descriptors: adapter.documents,
    descriptor,
    fileFor,
    readDocument,
    readAll,
    saveDocument,
    identityValues,
  }
}

module.exports = { createDocumentStore, contentError }
