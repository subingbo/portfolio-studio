# Portfolio Studio

Local visual content studio for the static portfolio site in this repository (the parent directory). It edits `content/site.json` and `content/projects.json`, processes uploaded media with sharp/FFmpeg, previews the real pages, and publishes `content/` + `media/` with Git.

See the [root README](../README.md) for the full quick start, and [content schema](../docs/content-schema.md) for the JSON contract.

## Requirements

- Node.js ≥ 21 (uses the built-in test runner and `fetch`)
- FFmpeg + ffprobe in `PATH` (video uploads only; images and the studio still work without it)

## Start

```bash
cd studio
npm install
cp config.example.json config.json
npm start
# open http://127.0.0.1:3737 (or http://localhost:3737)
```

The server binds to `127.0.0.1` only. `config.json` is git-ignored.

## Configuration

```json
{
  "sitePath": "..",
  "port": 3737,
  "production": {
    "url": "",
    "expectedRemote": "https://github.com/your-name/your-site.git",
    "branch": "main",
    "testScript": "test",
    "deployCheck": { "enabled": false }
  }
}
```

- `sitePath`: the site repository root (default `..`).
- `production.expectedRemote`: expected `origin` URL; empty skips the remote check.
- `production.branch`: branch to publish.
- `production.testScript`: npm script run before committing (default `test`).
- `production.url` + `deployCheck.enabled`: poll `${url}/content/site.json` and `/content/projects.json` after pushing to confirm the deploy. Leave `url` empty to skip.

Environment overrides: `STUDIO_SITE_PATH`, `STUDIO_PORT`, `STUDIO_SITE_URL`, `STUDIO_GIT_REMOTE`, `STUDIO_GIT_BRANCH`.

## Features

- **Home profile / About**: edit profile, tags, contact links, education, internships, capabilities; upload or reset the avatar.
- **Projects**: create, drag-sort, archive, lock slugs after first publish; cover selection; filmstrip media ordering; alt/caption/tag fields.
- **Media library**: list files with reference counts; scan and delete unused media after confirmation.
- **Publish**: validate → site `npm test` (configurable) → Git preflight → stage only `content/` + `media/` → commit → push → optional deploy confirmation.
- **Preview**: iframe of the real site reading saved drafts. External post APIs may be unavailable locally.
- **Help**: built-in quick-start panel (opens on first visit).

## Media rules

- Images: JPG / PNG / WebP → WebP, longest side ≤ 1920px, ≤ 2 MiB.
- Videos: MP4 / MOV / WebM → H.264/AAC MP4, ≤ 1080p, ≤ 12 s, ≤ 18 MiB, plus a WebP poster.
- Avatar: square 512×512 WebP at `media/profile/avatar.webp`.
- Total published media ≤ 80 MiB; SVG, GIF and Git LFS pointers are rejected.

## Tests

```bash
npm test
```

Covers content validation, backups/atomic writes, slug rename/locking, media processing, upload security (Host/Origin/token/path checks), and the publish pipeline (staged paths, divergence, test failures, push rejection, deploy timeout, concurrency).

## Security model

- Loopback-only server, random per-start session token for writes, Host/Origin checks, no CORS headers.
- Media type detection by magic bytes; server-generated file names; temp files + atomic moves.
- Backups before content writes; atomic JSON writes.
- Deploy polling only allows HTTPS on the configured host and rejects private/loopback resolutions.
- Git uses local credentials; no tokens are stored. `.studio/` and `config.json` are git-ignored.

## License

MIT
