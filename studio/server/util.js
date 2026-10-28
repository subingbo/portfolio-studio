'use strict'

const crypto = require('node:crypto')
const dns = require('node:dns/promises')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')

const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/
const SAFE_JSON_NAME = /^[A-Za-z0-9._-]+\.json$/
const SAFE_TMP_NAME = /^\.[A-Za-z0-9._-]+\.tmp$/

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'))
}

async function writeJsonAtomic(file, data) {
  const directory = path.dirname(file)
  await fsp.mkdir(directory, { recursive: true })
  const tempName = '.' + path.basename(file) + '.' + crypto.randomBytes(6).toString('hex') + '.tmp'
  if (!SAFE_TMP_NAME.test(tempName)) {
    throw new Error('非法的临时文件名')
  }
  const tempFile = path.join(directory, tempName)
  await fsp.writeFile(tempFile, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await fsp.rename(tempFile, file)
}

async function backupFile(file, backupsDir) {
  if (!fs.existsSync(file)) return null
  await fsp.mkdir(backupsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = path.basename(file).replace(/\.json$/i, '') + '-' + stamp + '.json'
  if (!SAFE_JSON_NAME.test(name)) {
    throw new Error('非法的备份文件名')
  }
  const target = path.join(backupsDir, name)
  await fsp.copyFile(file, target)
  const entries = (await fsp.readdir(backupsDir))
    .filter((entry) => SAFE_JSON_NAME.test(entry))
    .sort()
  while (entries.length > 50) {
    const oldest = entries.shift()
    if (!SAFE_JSON_NAME.test(oldest)) continue
    await fsp.unlink(path.join(backupsDir, oldest))
  }
  return target
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number)
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (/^fe[89ab]/.test(lower)) return true
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
    return false
  }
  return true
}

async function assertPublicHttpsUrl(rawUrl, allowedHost) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch (error) {
    throw Object.assign(new Error('URL 无法解析：' + rawUrl), { code: 'INVALID_URL' })
  }
  if (parsed.protocol !== 'https:') {
    throw Object.assign(new Error('只允许 https 请求：' + rawUrl), { code: 'INVALID_PROTOCOL' })
  }
  if (parsed.hostname !== allowedHost) {
    throw Object.assign(new Error('域名不在允许列表：' + parsed.hostname), { code: 'HOST_NOT_ALLOWED' })
  }
  const records = await dns.lookup(parsed.hostname, { all: true })
  if (!records.length) {
    throw Object.assign(new Error('域名无法解析：' + parsed.hostname), { code: 'DNS_EMPTY' })
  }
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw Object.assign(new Error('域名解析到内网地址，已拒绝：' + record.address), { code: 'PRIVATE_ADDRESS' })
    }
  }
  return parsed
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs || 10000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
      headers: options.headers || {},
    })
  } finally {
    clearTimeout(timer)
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(Object.assign(new Error('无法启动 ' + command + '：' + error.message), { code: 'SPAWN_FAILED' }))
      return
    }
    let stdout = ''
    let stderr = ''
    const limit = 512 * 1024
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
          reject(Object.assign(new Error(command + ' 执行超时（' + Math.round(options.timeoutMs / 1000) + ' 秒）'), {
            code: 'PROCESS_TIMEOUT',
            stdout,
            stderr,
          }))
        }, options.timeoutMs)
      : null
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-limit)
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-limit)
    })
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(Object.assign(new Error('无法执行 ' + command + '：' + error.message), { code: 'SPAWN_FAILED', stdout, stderr }))
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout, stderr, code })
      } else {
        reject(Object.assign(new Error(command + ' 退出码 ' + code), { code: 'PROCESS_FAILED', exitCode: code, stdout, stderr }))
      }
    })
  })
}

function tailLines(text, lineCount) {
  const lines = String(text || '').trim().split(/\r?\n/)
  return lines.slice(-lineCount).join('\n')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

module.exports = {
  SAFE_FILE_NAME,
  sha256,
  readJson,
  writeJsonAtomic,
  backupFile,
  isPrivateAddress,
  assertPublicHttpsUrl,
  fetchWithTimeout,
  runProcess,
  tailLines,
  canonicalJson,
}
