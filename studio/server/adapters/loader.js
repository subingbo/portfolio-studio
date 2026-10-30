'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { validateAdapter } = require('./base')

const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const STUDIO_ROOT = path.resolve(__dirname, '..', '..')

// 适配器用字面量分支加载：新增适配器时在这里加一个 case。
function createAdapter(spec) {
  switch (spec) {
    case 'portfolio':
      return require('../../adapters/portfolio')
    case 'landing':
      return require('../../adapters/landing')
    default:
      return null
  }
}

function loadAdapter(config) {
  const spec = String(config.adapter || 'portfolio')
  if (!ADAPTER_ID_PATTERN.test(spec)) {
    throw new Error('适配器 id 不合法：' + spec + '（只能包含小写字母、数字和连字符）')
  }
  const exported = createAdapter(spec)
  if (!exported) {
    throw new Error('未知适配器：' + spec + '（请在 studio/server/adapters/loader.js 中登记）')
  }
  const AdapterClass = exported && (exported.default || exported)
  const adapter = typeof AdapterClass === 'function' ? new AdapterClass() : AdapterClass
  validateAdapter(adapter)
  const directory = path.join(STUDIO_ROOT, 'adapters', spec)
  if (!fs.existsSync(directory)) {
    throw new Error('找不到适配器目录：studio/adapters/' + spec)
  }
  return { adapter, directory }
}

module.exports = { loadAdapter, ADAPTER_ID_PATTERN }
