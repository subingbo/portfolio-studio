'use strict'

// 适配器接口版本：破坏性变更时递增，加载器会拒绝不兼容的适配器。
const API_VERSION = 1

class BaseAdapter {
  static apiVersion = API_VERSION

  get apiVersion() {
    return API_VERSION
  }

  get id() {
    return 'base'
  }

  get name() {
    return 'Base adapter'
  }

  get version() {
    return '1.0.0'
  }

  // 内容文档：[{ id, file, kind: 'object'|'collection', label, itemsKey, identityField, orderField, statusField, statuses }]
  get documents() {
    return []
  }

  // 媒体集合：[{ id, label, mode: 'collection'|'path', root, document, itemsKey, mediaField, dirKey, path, cover, itemDefaults, limits, formats }]
  get mediaCollections() {
    return []
  }

  // 头像：null 或 { document, pointer: [...], file, size, maxBytes }
  get avatar() {
    return null
  }

  // 发布：{ stagePaths, commitPrefix, lockFrom, deployTargets, stepLabels }
  get publish() {
    return { stagePaths: [], commitPrefix: 'content:', lockFrom: [], deployTargets: [] }
  }

  // UI 清单：{ views: [...], help?: {...} }
  get manifest() {
    return { views: [] }
  }

  // 可选：适配器目录下的浏览器模块文件名（自定义组件）
  get webModule() {
    return null
  }

  validate() {
    return { errors: [], warnings: [] }
  }
}

function isRelativeSafe(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false
  return !value.split('/').some((part) => part === '..' || part === '')
}

function validateAdapter(adapter) {
  const problems = []
  if (!adapter || typeof adapter !== 'object') {
    throw new Error('适配器无效：需要导出 BaseAdapter 实例或类')
  }
  if (adapter.apiVersion !== API_VERSION) {
    problems.push('apiVersion 必须是 ' + API_VERSION + '，实际为 ' + adapter.apiVersion)
  }
  for (const field of ['id', 'name', 'version']) {
    const value = adapter[field]
    if (typeof value !== 'string' || !value.trim()) problems.push('缺少 ' + field)
  }
  const documents = adapter.documents
  if (!Array.isArray(documents) || documents.length === 0) {
    problems.push('documents 必须是非空数组')
  } else {
    const ids = new Set()
    const files = new Set()
    for (const doc of documents) {
      if (!doc || typeof doc !== 'object') {
        problems.push('documents 中存在无效条目')
        continue
      }
      if (typeof doc.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(doc.id)) problems.push('文档 id 不合法：' + doc.id)
      if (ids.has(doc.id)) problems.push('文档 id 重复：' + doc.id)
      ids.add(doc.id)
      if (!isRelativeSafe(doc.file)) problems.push('文档路径不合法：' + doc.file)
      if (files.has(doc.file)) problems.push('文档路径重复：' + doc.file)
      files.add(doc.file)
      if (!['object', 'collection'].includes(doc.kind)) problems.push('文档 ' + doc.id + ' 的 kind 必须是 object 或 collection')
      if (doc.kind === 'collection') {
        if (typeof doc.itemsKey !== 'string' || !doc.itemsKey) problems.push('文档 ' + doc.id + ' 需要 itemsKey')
        if (typeof doc.identityField !== 'string' || !doc.identityField) problems.push('文档 ' + doc.id + ' 需要 identityField')
      }
      if (doc.identityPattern !== undefined && !(doc.identityPattern instanceof RegExp)) {
        problems.push('文档 ' + doc.id + ' 的 identityPattern 必须是正则')
      }
    }
  }

  const documentIds = new Set((Array.isArray(documents) ? documents : []).map((doc) => doc && doc.id))
  const media = adapter.mediaCollections
  if (!Array.isArray(media)) {
    problems.push('mediaCollections 必须是数组')
  } else {
    const mediaIds = new Set()
    for (const collection of media) {
      if (!collection || typeof collection !== 'object') {
        problems.push('mediaCollections 中存在无效条目')
        continue
      }
      if (typeof collection.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(collection.id)) problems.push('媒体集合 id 不合法：' + collection.id)
      if (mediaIds.has(collection.id)) problems.push('媒体集合 id 重复：' + collection.id)
      mediaIds.add(collection.id)
      if (!isRelativeSafe(collection.root)) problems.push('媒体目录不合法：' + collection.root)
      if (!documentIds.has(collection.document)) problems.push('媒体集合 ' + collection.id + ' 引用了不存在的文档')
      if (!['collection', 'path'].includes(collection.mode)) problems.push('媒体集合 ' + collection.id + ' 的 mode 必须是 collection 或 path')
      if (collection.mode === 'collection') {
        if (typeof collection.itemsKey !== 'string' || !collection.itemsKey) problems.push('媒体集合 ' + collection.id + ' 需要 itemsKey')
        if (typeof collection.mediaField !== 'string' || !collection.mediaField) problems.push('媒体集合 ' + collection.id + ' 需要 mediaField')
      } else if (!Array.isArray(collection.path) || collection.path.length === 0) {
        problems.push('媒体集合 ' + collection.id + ' 需要 path 数组')
      }
      if (collection.dirKey !== undefined && collection.dirKey !== null && typeof collection.dirKey !== 'string') {
        problems.push('媒体集合 ' + collection.id + ' 的 dirKey 必须是字符串或 null')
      }
      if (collection.formats !== undefined) {
        if (!collection.formats || typeof collection.formats !== 'object') problems.push('媒体集合 ' + collection.id + ' 的 formats 必须是对象')
      }
    }
  }

  const avatar = adapter.avatar
  if (avatar !== null && avatar !== undefined) {
    if (typeof avatar !== 'object') {
      problems.push('avatar 必须是 null 或对象')
    } else {
      if (!documentIds.has(avatar.document)) problems.push('avatar 引用了不存在的文档')
      if (!Array.isArray(avatar.pointer) || avatar.pointer.length === 0) problems.push('avatar.pointer 必须是非空数组')
      if (!isRelativeSafe(avatar.file)) problems.push('avatar.file 路径不合法')
      if (!Number.isFinite(avatar.size) || avatar.size <= 0) problems.push('avatar.size 必须是正数')
      if (!Number.isFinite(avatar.maxBytes) || avatar.maxBytes <= 0) problems.push('avatar.maxBytes 必须是正数')
    }
  }

  const publish = adapter.publish
  if (!publish || typeof publish !== 'object') {
    problems.push('publish 必须是对象')
  } else {
    if (!Array.isArray(publish.stagePaths)) {
      problems.push('publish.stagePaths 必须是数组')
    } else {
      publish.stagePaths.forEach((entry) => {
        if (!isRelativeSafe(entry)) problems.push('发布暂存路径不合法：' + entry)
      })
    }
    if (!Array.isArray(publish.lockFrom)) problems.push('publish.lockFrom 必须是数组')
    if (!Array.isArray(publish.deployTargets)) {
      problems.push('publish.deployTargets 必须是数组')
    } else {
      publish.deployTargets.forEach((target) => {
        if (!target || !documentIds.has(target.document)) problems.push('部署探测目标引用了不存在的文档')
        if (!target || typeof target.urlPath !== 'string' || !target.urlPath.startsWith('/')) {
          problems.push('部署探测目标需要以 / 开头的 urlPath')
        }
      })
    }
  }

  const manifest = adapter.manifest
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.views)) {
    problems.push('manifest.views 必须是数组')
  } else {
    const viewIds = new Set()
    for (const view of manifest.views) {
      if (!view || typeof view.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(view.id)) problems.push('视图 id 不合法：' + (view && view.id))
      if (viewIds.has(view.id)) problems.push('视图 id 重复：' + view.id)
      viewIds.add(view.id)
      if (!['document', 'collection', 'media', 'publish', 'custom'].includes(view.type)) {
        problems.push('视图 ' + view.id + ' 的 type 不受支持：' + view.type)
      }
      if ((view.type === 'document' || view.type === 'collection') && !documentIds.has(view.document)) {
        problems.push('视图 ' + view.id + ' 引用了不存在的文档')
      }
    }
  }

  if (adapter.webModule !== null && adapter.webModule !== undefined) {
    if (typeof adapter.webModule !== 'string' || !/^[A-Za-z0-9._-]+$/.test(adapter.webModule)) {
      problems.push('webModule 必须是适配器目录下的文件名')
    }
  }

  if (typeof adapter.validate !== 'function') problems.push('缺少 validate() 方法')

  if (problems.length) {
    throw new Error('适配器不符合接口：\n- ' + problems.join('\n- '))
  }
  return adapter
}

function getByPath(target, pathParts) {
  let current = target
  for (const part of pathParts || []) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = current[part]
  }
  return current
}

function setByPath(target, pathParts, value) {
  let current = target
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    const part = pathParts[index]
    if (!current[part] || typeof current[part] !== 'object') {
      current[part] = {}
    }
    current = current[part]
  }
  current[pathParts[pathParts.length - 1]] = value
  return target
}

module.exports = { API_VERSION, BaseAdapter, validateAdapter, getByPath, setByPath, isRelativeSafe }
