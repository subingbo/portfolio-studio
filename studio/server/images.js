'use strict'

const fsp = require('node:fs/promises')
const sharp = require('sharp')

const IMAGE_ATTEMPTS = [
  { side: 1920, quality: 82 },
  { side: 1920, quality: 72 },
  { side: 1920, quality: 64 },
  { side: 1600, quality: 62 },
  { side: 1280, quality: 58 },
  { side: 1080, quality: 52 },
]

const POSTER_ATTEMPTS = [
  { side: 1600, quality: 80 },
  { side: 1600, quality: 70 },
  { side: 1280, quality: 62 },
  { side: 1080, quality: 55 },
]

function tooLargeError(format, size) {
  return Object.assign(new Error(format + '压缩后仍超过 2 MiB（' + (size / 1024 / 1024).toFixed(2) + ' MiB）'), {
    code: 'MEDIA_TOO_LARGE',
  })
}

async function encodeWebp(inputFile, outputFile, attempts, maxBytes) {
  let lastSize = 0
  for (const attempt of attempts) {
    const buffer = await sharp(inputFile)
      .rotate()
      .resize({
        width: attempt.side,
        height: attempt.side,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: attempt.quality, effort: 4 })
      .toBuffer()
    lastSize = buffer.length
    if (buffer.length <= maxBytes) {
      await fsp.writeFile(outputFile, buffer)
      const metadata = await sharp(buffer).metadata()
      return { bytes: buffer.length, width: metadata.width, height: metadata.height }
    }
  }
  throw tooLargeError('图片', lastSize)
}

async function processImage(inputFile, outputFile, limits) {
  return encodeWebp(inputFile, outputFile, IMAGE_ATTEMPTS, limits.imageMaxBytes)
}

async function processPoster(inputFile, outputFile, limits) {
  return encodeWebp(inputFile, outputFile, POSTER_ATTEMPTS, limits.imageMaxBytes)
}

module.exports = { processImage, processPoster }
