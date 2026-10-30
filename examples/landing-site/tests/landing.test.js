'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const data = JSON.parse(fs.readFileSync(path.join(root, 'content', 'landing.json'), 'utf8'))

test('landing.json has the fields used by the page', () => {
  assert.equal(typeof data.title, 'string')
  assert.ok(data.title.trim().length > 0)
  assert.ok(Array.isArray(data.sections))
  data.sections.forEach((section) => {
    assert.equal(typeof section.heading, 'string')
    assert.equal(typeof section.body, 'string')
  })
  assert.ok(Array.isArray(data.images))
  for (const image of data.images) {
    assert.match(image.src, /^media\/images\/[A-Za-z0-9._-]+\.webp$/)
    assert.ok(fs.existsSync(path.join(root, image.src)), image.src + ' must exist')
    assert.ok(fs.statSync(path.join(root, image.src)).size <= 2 * 1024 * 1024)
    assert.ok(image.alt && image.alt.trim())
  }
})

test('index.html loads the JSON content', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  assert.match(html, /content\/landing\.json/)
  assert.match(html, /cache: 'no-cache'/)
})
