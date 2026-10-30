'use strict'

const manifest = {
  views: [
    {
      id: 'home',
      label: '首页资料',
      type: 'document',
      document: 'site',
      preview: 'index.html',
      description: '这些内容写入 content/site.json，同步到首页 hero、品牌名与联系方式。',
      form: {
        sections: [
          {
            title: '基本资料',
            fields: [
              { path: ['profile', 'name'], label: '姓名', type: 'text', required: true, half: true },
              { path: ['profile', 'initial'], label: '头像首字', type: 'text', half: true },
              { path: ['profile', 'eyebrow'], label: '眉题 Eyebrow', type: 'text' },
              { path: ['profile', 'slogan'], label: '主标语', type: 'textarea', rows: 3 },
              { path: ['profile', 'intro'], label: '个人介绍', type: 'textarea', rows: 5 },
              { path: ['profile', 'tags'], label: '技术标签', type: 'stringList', rows: 5, hint: '每行一个' },
              { path: ['profile', 'email'], label: '邮箱', type: 'email', half: true },
              { path: ['profile', 'github'], label: 'GitHub 链接', type: 'url', half: true },
            ],
          },
          {
            title: '可选集成',
            fields: [
              {
                path: ['integrations', 'postsApiBase'],
                label: '文章接口地址',
                type: 'url',
                hint: 'HTTPS 地址；留空则关闭文章区',
              },
            ],
          },
        ],
      },
    },
    {
      id: 'about',
      label: '关于页',
      type: 'document',
      document: 'site',
      preview: 'about.html',
      description: '教育、实习、能力与联系说明写入 content/site.json。',
      form: {
        sections: [
          {
            title: '介绍',
            fields: [
              { path: ['about', 'intro'], label: '关于页介绍', type: 'textarea', rows: 3 },
              { path: ['about', 'contactNote'], label: '联系区说明', type: 'textarea', rows: 2 },
            ],
          },
          {
            title: '教育经历',
            fields: [
              {
                path: ['about', 'education'],
                type: 'objectList',
                itemLabel: '教育',
                addLabel: '添加教育经历',
                fields: [
                  { path: ['school'], label: '学校', type: 'text' },
                  { path: ['period'], label: '时间', type: 'text' },
                  { path: ['detail'], label: '专业 / 学历', type: 'text' },
                ],
              },
            ],
          },
          {
            title: '实习经历',
            fields: [
              {
                path: ['about', 'internships'],
                type: 'objectList',
                itemLabel: '实习',
                addLabel: '添加实习经历',
                fields: [
                  { path: ['company'], label: '公司', type: 'text' },
                  { path: ['period'], label: '时间', type: 'text' },
                  { path: ['role'], label: '角色', type: 'text' },
                  { path: ['bullets'], label: '成果要点', type: 'stringList', rows: 5, hint: '每行一条' },
                ],
              },
            ],
          },
          {
            title: '技术能力',
            fields: [
              {
                path: ['about', 'capabilities'],
                type: 'objectList',
                itemLabel: '能力',
                addLabel: '添加能力',
                fields: [
                  { path: ['title'], label: '标题', type: 'text' },
                  { path: ['description'], label: '说明', type: 'textarea', rows: 3 },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      id: 'projects',
      label: '作品',
      type: 'collection',
      document: 'projects',
      preview: 'projects.html',
      itemPreview: 'project.html?id={id}',
      description: '编辑项目文字、封面、画面与顺序。slug 首次发布后锁定；归档项目保留内容但不再展示。',
      list: {
        titleField: 'title',
        subtitleField: 'slug',
        statusField: 'status',
        orderField: 'order',
        identityField: 'slug',
      },
      item: {
        identityField: 'slug',
        lockedHint: '已发布，slug 已锁定以保持详情地址稳定',
        defaults: {
          slug: 'new-project',
          status: 'draft',
          order: 1,
          category: '个人项目',
          title: '新项目',
          tagline: '',
          role: '',
          summary: '',
          stack: [],
          proof: [{ value: '', label: '' }],
          overview: '',
          sections: [{ title: '', body: '' }],
          evidence: {},
          sourceUrl: '',
          coverMediaId: null,
          media: [],
        },
        form: {
          sections: [
            {
              fields: [
                { path: ['slug'], label: '项目 slug', type: 'slug', required: true, half: true },
                {
                  path: ['status'],
                  label: '状态',
                  type: 'select',
                  half: true,
                  options: [
                    { value: 'draft', label: '草稿（不展示）' },
                    { value: 'published', label: '已发布（展示）' },
                    { value: 'archived', label: '已归档（不展示）' },
                  ],
                },
                { path: ['category'], label: '分类', type: 'text' },
                { path: ['role'], label: '角色', type: 'text' },
                { path: ['title'], label: '标题', type: 'text' },
                { path: ['tagline'], label: '一句话定位', type: 'text' },
                { path: ['summary'], label: '摘要', type: 'textarea', rows: 3 },
                { path: ['stack'], label: '技术栈', type: 'stringList', rows: 4, hint: '每行一个' },
                { path: ['overview'], label: '项目概览', type: 'textarea', rows: 4 },
                { path: ['sourceUrl'], label: '源码链接（可留空）', type: 'url' },
              ],
            },
            {
              title: '工程成果（proof）',
              fields: [
                {
                  path: ['proof'],
                  type: 'objectList',
                  itemLabel: '成果',
                  addLabel: '添加成果',
                  fields: [
                    { path: ['value'], label: '数值', type: 'text', half: true },
                    { path: ['label'], label: '说明', type: 'text', half: true },
                  ],
                },
              ],
            },
            {
              title: '详情段落',
              fields: [
                {
                  path: ['sections'],
                  type: 'objectList',
                  itemLabel: '段落',
                  addLabel: '添加段落',
                  fields: [
                    { path: ['title'], label: '标题', type: 'text' },
                    { path: ['body'], label: '正文', type: 'textarea', rows: 4 },
                  ],
                },
              ],
            },
            {
              title: '工程证据（evidence）',
              fields: [
                {
                  path: ['evidence'],
                  type: 'keyValue',
                  addLabel: '添加证据',
                  keyLabel: '键名',
                  valueLabel: '内容',
                  hint: 'deployment / modelEvaluation / offlineVerification 会显示中文标签',
                },
              ],
            },
          ],
        },
      },
      media: {
        collection: 'projects',
        coverField: 'coverMediaId',
        fields: [
          { key: 'alt', label: '替代文本', placeholder: '发布必填，描述画面内容' },
          { key: 'caption', label: '画面说明', placeholder: '显示在胶片条下方' },
          { key: 'tag', label: '功能标签', placeholder: '显示在胶片条头部' },
        ],
        labels: {
          title: '项目画面（工程胶片）',
          hint: '拖拽上传图片或视频。图片自动转 WebP（最长边 1920、≤2 MiB）；视频压成 MP4（≤1080p、≤12 秒、≤18 MiB）并生成封面。',
          empty: '还没有画面。上传图片或视频后会出现在这里，可拖拽排序。',
        },
      },
    },
    { id: 'media', label: '素材库', type: 'media' },
    { id: 'publish', label: '发布', type: 'publish' },
  ],
  help: {
    intro: '这个工作台只在本机运行，用来编辑静态作品集网站的草稿并发布。记住一条主线：保存草稿只改本地文件，发布才会上线。',
    sections: [
      {
        title: '五步上手',
        items: [
          '顶部选择要改的页面：首页资料 / 关于页 / 作品。',
          '在左侧表单里修改内容，改完点页面底部的“保存草稿”。',
          '右侧预览会显示已保存的草稿；点“刷新预览”可重新加载。',
          '全部改完后，打开“发布”页，先点“运行校验”。',
          '校验通过后点“发布到正式站”，等待七个步骤全部完成。',
        ],
      },
      {
        title: '头像',
        items: [
          '在“首页资料”顶部的头像卡片上传：自动居中裁成 512×512 WebP，写入 media/profile/avatar.webp 和 content/site.json。',
          '没有本地头像时，网站显示姓名首字；上传后要发布才会在正式站生效。',
        ],
      },
      {
        title: '作品与媒体',
        items: [
          '左侧列表选项目或“新建项目”；拖动项目可调整首页和作品页顺序。',
          '先“保存草稿”，再上传媒体：保存后媒体区才能拖入文件。',
          '图片支持 JPG / PNG / WebP，自动转 WebP（≤2 MiB）；视频支持 MP4 / MOV / WebM，自动压成 MP4（≤1080p、≤12 秒、≤18 MiB）并生成封面。',
          '每张画面都要填替代文本（发布校验会检查）；拖动画面可调整顺序；“设为封面”决定列表卡片和详情页大图。',
          '“移除引用”只从页面移除，文件仍留在素材库；真正删除到“素材库 → 扫描未使用素材”。',
        ],
      },
      {
        title: '发布做了什么',
        items: [
          '校验内容与媒体 → 运行站点测试 → 检查 Git 分支与远程 → 只暂存 content/ 与 media/ → 提交 → 推送 → 等待部署生效。',
          '暂存区有其他文件、本地落后远程、测试失败时会停下并提示，不会自动覆盖。',
          '项目 slug 首次发布后会锁定，避免详情页链接失效。',
        ],
      },
      {
        title: '常见问题',
        items: [
          '预览里文章、评论加载失败可能是外部内容接口未配置或不允许本地域名访问，属正常现象。',
          '页面打不开时确认工作台服务还在运行；关闭后在 studio 目录执行 npm start，端口以启动日志为准（默认 3737）。',
          '视频超过 12 秒会拒绝上传，请先裁剪；本机需要安装 FFmpeg（顶栏会显示是否可用）。',
          '草稿状态的项目会随仓库公开，但页面不展示；发布前校验会提醒。',
        ],
      },
    ],
    tip: '建议顺序：改文字 → 保存 → 上传图片/视频并填替代文本 → 保存 → 刷新预览确认 → 发布。',
  },
}

module.exports = { manifest }
