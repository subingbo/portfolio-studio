# Portfolio Site Template

A small, dependency-free static portfolio site with a local visual content studio. Edit content in the browser, preview the real pages, then publish with one click.

- **Site**: plain HTML/CSS/JS. Content lives in `content/site.json` and `content/projects.json`; media lives in `media/`.
- **Studio**: a local-only Node app (`studio/`) that edits the JSON, processes images/videos, previews the site, and commits/pushes only `content/` and `media/`.
- **No build step** for the site. Node.js ≥ 21 is required for the studio; FFmpeg is optional (video uploads only).

## Quick start

```bash
git clone <your-repo-url> portfolio-site
cd portfolio-site/studio
npm install
cp config.example.json config.json
# edit config.json: sitePath, production.expectedRemote, production.url (optional)
npm start
# open http://127.0.0.1:3737 (or http://localhost:3737)
```

`studio/config.json` is git-ignored. `sitePath` defaults to `..` (the repo root), so the studio manages this repository.

### Edit without the studio

You can also edit the JSON files directly:

- `content/site.json` — profile, links, education, internships, capabilities, avatar.
- `content/projects.json` — projects, order, status, copy, links, cover, media.
- `media/projects/<project-slug>/` — project images (WebP) and videos (MP4 + WebP poster).

See [docs/content-schema.md](docs/content-schema.md) for the full contract.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home: profile hero, selected work, latest posts (optional API) |
| `about.html` | About: education, experience, capabilities, contact |
| `projects.html` | Project list with 16:9 covers |
| `project.html` | Project detail: `?id=<slug>`, cover, filmstrip gallery, video |
| `blog.html` | Posts list (optional API) |
| `article.html` | Post detail + comments (optional API) |

## Optional posts API

Article sections are disabled by default. To enable them, set `integrations.postsApiBase` in `content/site.json` to an HTTPS API base. The pages expect:

- `GET {base}/posts?pageNum=1&pageSize=6` → `{ "data": { "items": [{ "postId", "title", "excerpt", "category", "createdAt", "commentCount" }] } }`
- `GET {base}/posts/{id}` → `{ "data": { "title", "content" (Markdown), "category", "createdAt", "commentCount" } }`
- `GET {base}/posts/{id}/comments?pageNum=1&pageSize=50` → `{ "data": { "items": [...] } }`

If the base is empty, the pages show a configuration hint instead of failing requests. The API must allow your site origin via CORS.

## Media rules

- Images: JPG / PNG / WebP → WebP, longest side ≤ 1920px, ≤ 2 MiB.
- Videos: MP4 / MOV / WebM → H.264/AAC MP4, ≤ 1080p, ≤ 12 s, ≤ 18 MiB, plus a WebP poster.
- Avatar: square 512×512 WebP at `media/profile/avatar.webp` (uploaded from the studio).
- Total published media ≤ 80 MiB. SVG, GIF and Git LFS pointers are rejected.

## Publishing

The studio's publish pipeline:

1. validates content and media;
2. runs the site test script (`npm test` by default, configurable via `production.testScript`);
3. checks the Git branch, staged area and remote (when configured);
4. stages only `content/` and `media/`, commits, and pushes `origin/<branch>`;
5. optionally polls `production.url` for the deployed JSON to confirm the deploy.

Configure in `studio/config.json`:

```json
{
  "sitePath": "..",
  "port": 3737,
  "production": {
    "url": "https://example.com",
    "expectedRemote": "https://github.com/your-name/your-site.git",
    "branch": "main",
    "testScript": "test",
    "deployCheck": { "enabled": true }
  }
}
```

`production.url` empty or `deployCheck.enabled: false` skips the deploy confirmation; publishing still commits and pushes.

You can deploy the static site anywhere (GitHub Pages, Netlify, Vercel, Cloudflare Pages, object storage + CDN).

## Studio features

- Pages: home profile, about, projects, media library, publish.
- Project editing: create, drag-sort, archive, slug lock after first publish, cover selection, filmstrip media ordering, alt text.
- Media: drag-and-drop upload, automatic WebP/MP4 processing, video posters, unused-media cleanup.
- Avatar: upload/crop/reset, stored locally and preferred over the letter fallback.
- Live preview of the real site with saved drafts.
- Safety: binds to loopback only, session token for writes, Host/Origin checks, atomic writes with backups, publishes only `content/` + `media/`.

## Tests

```bash
npm test            # site checks
cd studio && npm test   # studio checks
```

## Security notes

- The studio is local-only. Do not expose port 3737 publicly.
- Git uses your existing credentials; no tokens are stored by the studio.
- `.studio/` (backups, temp files) and `studio/config.json` are git-ignored.

## License

MIT — see [LICENSE](LICENSE).
