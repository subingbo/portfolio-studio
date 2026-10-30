'use strict'

const { resolveInside } = require('./config')
const { getByPath } = require('./adapters/base')

function itemsOf(collection, documents) {
  const document = documents[collection.document]
  if (!document) return []
  if (collection.mode === 'collection') {
    const items = Array.isArray(document[collection.itemsKey]) ? document[collection.itemsKey] : []
    return items.map((item, index) => ({
      item,
      index,
      itemKey: collection.dirKey ? item[collection.dirKey] : null,
    }))
  }
  const list = getByPath(document, collection.path)
  return Array.isArray(list) ? [{ item: null, index: null, itemKey: null, list }] : []
}

// 展开集合中的每个媒体项，附带它所在的数组与所属条目。
function mediaEntries(collection, documents) {
  const entries = []
  for (const entry of itemsOf(collection, documents)) {
    let list = []
    if (collection.mode === 'collection') {
      list = entry.item && Array.isArray(entry.item[collection.mediaField]) ? entry.item[collection.mediaField] : []
    } else {
      list = entry.list
    }
    list.forEach((media, mediaIndex) => {
      entries.push({
        collection,
        documentId: collection.document,
        item: entry.item,
        itemIndex: entry.index,
        itemKey: entry.itemKey,
        media,
        mediaIndex,
        list,
      })
    })
  }
  return entries
}

function dirRelative(collection, itemKey) {
  if (collection.mode === 'collection' && collection.dirKey) {
    if (typeof itemKey !== 'string' || !itemKey) return null
    return collection.root + '/' + itemKey
  }
  return collection.root
}

function absoluteDir(config, collection, itemKey) {
  const relative = dirRelative(collection, itemKey)
  if (!relative) return null
  return resolveInside(config.sitePath, relative)
}

function fileRelative(collection, itemKey, fileName) {
  const directory = dirRelative(collection, itemKey)
  if (!directory) return null
  return directory + '/' + fileName
}

function findItemByKey(collection, documents, itemKey) {
  if (collection.mode !== 'collection' || !collection.dirKey) return null
  const document = documents[collection.document]
  const items = document && Array.isArray(document[collection.itemsKey]) ? document[collection.itemsKey] : []
  return items.find((item) => item[collection.dirKey] === itemKey) || null
}

// 所有媒体集合中当前被引用的文件路径 → 引用信息。
function referenceMap(adapter, documents) {
  const map = new Map()
  for (const collection of adapter.mediaCollections) {
    for (const entry of mediaEntries(collection, documents)) {
      const base = {
        collectionId: collection.id,
        mediaId: entry.media.id,
        documentId: collection.document,
        itemKey: entry.itemKey,
      }
      if (typeof entry.media.src === 'string' && entry.media.src) {
        push(map, entry.media.src, Object.assign({ field: 'src' }, base))
      }
      if (typeof entry.media.poster === 'string' && entry.media.poster) {
        push(map, entry.media.poster, Object.assign({ field: 'poster' }, base))
      }
    }
  }
  return map
}

function push(map, key, value) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(value)
}

function limitsFor(collection, config) {
  // 配置文件的 limits 优先于适配器默认值，便于按机器/项目调参。
  return Object.assign({}, collection.limits || {}, config.limits)
}

function itemDefaults(collection) {
  return Object.assign({}, collection.itemDefaults || {})
}

module.exports = {
  itemsOf,
  mediaEntries,
  dirRelative,
  absoluteDir,
  fileRelative,
  findItemByKey,
  referenceMap,
  limitsFor,
  itemDefaults,
}
