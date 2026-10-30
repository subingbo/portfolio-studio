'use strict'

const { BaseAdapter } = require('../../server/adapters/base')
const { manifest } = require('./manifest')
const { validatePortfolio, AVATAR_FILE } = require('./validate')

const MIB = 1024 * 1024

class PortfolioAdapter extends BaseAdapter {
  get id() {
    return 'portfolio'
  }

  get name() {
    return 'Portfolio adapter'
  }

  get version() {
    return '1.0.0'
  }

  get documents() {
    return [
      { id: 'site', file: 'content/site.json', kind: 'object', label: '站点资料' },
      {
        id: 'projects',
        file: 'content/projects.json',
        kind: 'collection',
        label: '作品',
        itemsKey: 'projects',
        identityField: 'slug',
        orderField: 'order',
        statusField: 'status',
        statuses: ['published', 'draft', 'archived'],
      },
    ]
  }

  get mediaCollections() {
    return [
      {
        id: 'projects',
        label: '项目画面',
        mode: 'collection',
        document: 'projects',
        itemsKey: 'projects',
        mediaField: 'media',
        dirKey: 'slug',
        root: 'media/projects',
        cover: { field: 'coverMediaId' },
        itemDefaults: { alt: '', caption: '', tag: '' },
        formats: { image: ['.webp'], video: ['.mp4'] },
        limits: {
          imageMaxBytes: 2 * MIB,
          videoMaxBytes: 18 * MIB,
          imageMaxSide: 1920,
          videoMaxDurationSeconds: 12,
          videoMaxWidth: 1080,
          totalMaxBytes: 80 * MIB,
        },
      },
    ]
  }

  get avatar() {
    return {
      document: 'site',
      pointer: ['profile', 'avatar'],
      file: AVATAR_FILE,
      size: 512,
      maxBytes: 1 * MIB,
    }
  }

  get publish() {
    return {
      stagePaths: ['content', 'media'],
      commitPrefix: 'content:',
      lockFrom: [{ document: 'projects', via: 'collection', itemsKey: 'projects', field: 'slug' }],
      deployTargets: [
        { document: 'site', urlPath: '/content/site.json' },
        { document: 'projects', urlPath: '/content/projects.json' },
      ],
      stepLabels: { stage: '暂存 content 与 media' },
    }
  }

  get manifest() {
    return manifest
  }

  validate(context) {
    return validatePortfolio(context)
  }
}

module.exports = new PortfolioAdapter()
