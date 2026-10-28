'use strict'

const fs = require('node:fs')

const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'

function readHead(file, length = 512) {
  const descriptor = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const bytesRead = fs.readSync(descriptor, buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    fs.closeSync(descriptor)
  }
}

function isGitLfsPointer(head) {
  return head.subarray(0, LFS_POINTER_PREFIX.length).toString('utf8') === LFS_POINTER_PREFIX
}

function sniffBuffer(head) {
  if (head.length >= 8
    && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
    && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) {
    return { kind: 'image', format: 'png' }
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { kind: 'image', format: 'jpeg' }
  }
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
    return { kind: 'image', format: 'webp' }
  }
  if (head.length >= 6) {
    const signature = head.toString('ascii', 0, 6)
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { kind: 'image', format: 'gif' }
    }
  }
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') {
    const brand = head.toString('ascii', 8, 12)
    return { kind: 'video', format: brand === 'qt  ' ? 'mov' : 'mp4' }
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return { kind: 'video', format: 'webm' }
  }
  const text = head.toString('utf8').replace(/^\uFEFF/, '').trimStart().slice(0, 400).toLowerCase()
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    return { kind: 'image', format: 'svg' }
  }
  return { kind: 'unknown', format: 'unknown' }
}

module.exports = { readHead, isGitLfsPointer, sniffBuffer, LFS_POINTER_PREFIX }
