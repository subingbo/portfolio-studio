'use strict'

const fsp = require('node:fs/promises')
const { runProcess } = require('./util')
const { processPoster } = require('./images')

let ffmpegAvailable = null

async function checkFfmpeg() {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  try {
    await runProcess('ffmpeg', ['-version'], { timeoutMs: 8000 })
    ffmpegAvailable = true
  } catch (error) {
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

function ffmpegMissing() {
  return Object.assign(
    new Error('未找到 FFmpeg。请安装 FFmpeg 并加入 PATH 后重启工作台；图片上传不受影响。'),
    { code: 'FFMPEG_MISSING' }
  )
}

async function probeVideo(inputFile) {
  const { stdout } = await runProcess(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputFile],
    { timeoutMs: 30000 }
  )
  let data
  try {
    data = JSON.parse(stdout)
  } catch (error) {
    throw Object.assign(new Error('无法解析视频信息'), { code: 'INVALID_VIDEO' })
  }
  const streams = Array.isArray(data.streams) ? data.streams : []
  const videoStream = streams.find((stream) => stream.codec_type === 'video')
  if (!videoStream) {
    throw Object.assign(new Error('文件中没有视频轨道'), { code: 'INVALID_VIDEO' })
  }
  const duration = Number((data.format && data.format.duration) || videoStream.duration || 0)
  const width = Number(videoStream.width || 0)
  const height = Number(videoStream.height || 0)
  if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
    throw Object.assign(new Error('无法读取视频时长或尺寸'), { code: 'INVALID_VIDEO' })
  }
  return {
    duration,
    width,
    height,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  }
}

function scaleFilterFor(width, height) {
  // 横屏限制高度、竖屏限制宽度，长边不超过 1080p；滤镜确保 H.264 需要的偶数尺寸。
  const box = width >= height ? '1920:1080' : '1080:1920'
  return 'scale=' + box + ':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2'
}

async function encodeMp4(inputFile, outputFile, duration, filter, limits) {
  const audioBitrate = 128 * 1024
  const budgetBitsPerSecond = (limits.videoMaxBytes * 8 * 0.9) / Math.max(duration, 1)
  let videoBitrate = Math.max(350 * 1024, Math.floor(budgetBitsPerSecond - audioBitrate))
  let lastSize = 0
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const args = [
      '-y',
      '-i', inputFile,
      '-vf', filter,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-profile:v', 'main',
      '-b:v', String(videoBitrate),
      '-maxrate', String(videoBitrate),
      '-bufsize', String(videoBitrate * 2),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputFile,
    ]
    await runProcess('ffmpeg', args, { timeoutMs: limits.videoProcessTimeoutMs })
    const stat = await fsp.stat(outputFile)
    lastSize = stat.size
    if (lastSize <= limits.videoMaxBytes) return lastSize
    videoBitrate = Math.floor(videoBitrate * 0.68)
  }
  throw Object.assign(
    new Error('视频压缩后仍超过 18 MiB，请裁剪更短的片段或降低分辨率'),
    { code: 'MEDIA_TOO_LARGE', size: lastSize }
  )
}

async function extractPoster(inputFile, outputPng, duration, timeoutMs) {
  const seek = Math.min(1, Math.max(0, duration / 2))
  await runProcess(
    'ffmpeg',
    ['-y', '-ss', String(seek), '-i', inputFile, '-frames:v', '1', '-vf', 'scale=1600:-2', outputPng],
    { timeoutMs }
  )
  const stat = await fsp.stat(outputPng)
  if (!stat.size) {
    throw Object.assign(new Error('视频封面提取失败'), { code: 'POSTER_FAILED' })
  }
}

async function processVideo(inputFile, outputFile, posterOutput, limits) {
  if (!(await checkFfmpeg())) throw ffmpegMissing()
  let info
  try {
    info = await probeVideo(inputFile)
  } catch (error) {
    if (error.code === 'SPAWN_FAILED' || error.code === 'PROCESS_TIMEOUT') throw ffmpegMissing()
    throw error
  }
  if (info.duration > limits.videoMaxDurationSeconds + 0.3) {
    throw Object.assign(
      new Error('视频时长 ' + info.duration.toFixed(1) + ' 秒，超过 ' + limits.videoMaxDurationSeconds + ' 秒限制，请先裁剪'),
      { code: 'VIDEO_TOO_LONG' }
    )
  }
  const filter = scaleFilterFor(info.width, info.height)
  let size
  try {
    size = await encodeMp4(inputFile, outputFile, info.duration, filter, limits)
  } catch (error) {
    if (error.code === 'SPAWN_FAILED' || error.code === 'PROCESS_TIMEOUT') throw ffmpegMissingOrTimeout(error)
    throw error
  }
  const posterPng = outputFile + '.poster.png'
  try {
    await extractPoster(inputFile, posterPng, info.duration, limits.videoProcessTimeoutMs)
    const poster = await processPoster(posterPng, posterOutput, limits)
    return Object.assign({}, info, { size, poster })
  } finally {
    await fsp.rm(posterPng, { force: true }).catch(() => {})
  }
}

function ffmpegMissingOrTimeout(error) {
  if (error.code === 'PROCESS_TIMEOUT') {
    return Object.assign(new Error('视频处理超时（超过 ' + Math.round(error.timeoutMs || 120) + ' 秒），请尝试更短的视频'), {
      code: 'VIDEO_TIMEOUT',
    })
  }
  return ffmpegMissing()
}

module.exports = { checkFfmpeg, probeVideo, processVideo, ffmpegMissing }
