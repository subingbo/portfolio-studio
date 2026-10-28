# Content schema

The site reads two JSON files at runtime with `cache: "no-cache"`. If either request fails, the page keeps its built-in static fallback and shows a notice. The studio edits these files directly.

## `content/site.json`

```json
{
  "profile": {
    "name": "Your Name",
    "initial": "Y",
    "avatar": "",
    "eyebrow": "FULL STACK · ENGINEERING NOTES",
    "slogan": "One-line statement.",
    "intro": "Short introduction.",
    "tags": ["Backend", "Frontend", "Database"],
    "email": "you@example.com",
    "github": "https://github.com/your-name"
  },
  "integrations": {
    "postsApiBase": ""
  },
  "about": {
    "intro": "About paragraph.",
    "education": [
      { "school": "Example University", "period": "2020—2024", "detail": "Computer Science · BSc" }
    ],
    "internships": [
      { "company": "Example Co.", "period": "2024—Now", "role": "Software Engineer", "bullets": ["Shipped X.", "Improved Y."] }
    ],
    "capabilities": [
      { "title": "Backend", "description": "APIs, databases, caching." }
    ],
    "contactNote": "Say hello by email."
  }
}
```

| Field | Rules |
| --- | --- |
| `profile.name` / `slogan` / `intro` / `email` | Required non-empty strings; email must look like an email |
| `profile.initial` | Optional display letter; falls back to the first character of `name` |
| `profile.avatar` | `""` or exactly `media/profile/avatar.webp`; file must exist before publishing |
| `profile.tags` | Non-empty array of strings |
| `profile.github` | `https://` URL |
| `integrations.postsApiBase` | `""` (disable posts) or an `https://` API base |
| `about.education[]` | `school`, `period` required; `detail` optional |
| `about.internships[]` | `company`, `period`, `role`, `bullets[]` |
| `about.capabilities[]` | `title`, `description` |

## `content/projects.json`

```json
{
  "version": 1,
  "projects": [
    {
      "slug": "sample-project",
      "status": "published",
      "order": 1,
      "category": "Project",
      "title": "Project title",
      "tagline": "Short tagline",
      "role": "Your role",
      "summary": "Card summary",
      "stack": ["Node.js", "SQLite"],
      "proof": [{ "value": "3", "label": "modules" }],
      "overview": "Overview paragraph",
      "sections": [{ "title": "Problem", "body": "..." }],
      "evidence": { "deployment": "Deployment evidence" },
      "sourceUrl": "",
      "coverMediaId": null,
      "media": []
    }
  ]
}
```

| Field | Rules |
| --- | --- |
| `slug` | Lowercase letters, digits and `-`; unique; locked after the first publish |
| `status` | `published` (shown), `draft` (hidden), `archived` (hidden, kept) |
| `order` | Integer; lower comes first |
| `category` / `title` / `tagline` / `role` / `summary` / `overview` | Required non-empty strings |
| `stack` | Non-empty string array |
| `proof[]` | `value` and `label` strings |
| `sections[]` | `title` and `body` strings |
| `evidence` | Object of string values; `deployment` / `modelEvaluation` / `offlineVerification` get friendly labels |
| `sourceUrl` | `""` or an `https://` URL |
| `coverMediaId` | `null` or the `id` of an item in `media` |
| `media[]` | See below |

### Media item

```json
{
  "id": "media-id",
  "type": "image",
  "src": "media/projects/sample-project/file.webp",
  "poster": null,
  "alt": "What the image shows",
  "caption": "Shown under the frame",
  "tag": "Feature label"
}
```

| Field | Rules |
| --- | --- |
| `id` | Lowercase letters, digits, `-`; unique within the project |
| `type` | `image` or `video` |
| `src` | Must start with `media/projects/<project-slug>/`; images end in `.webp`, videos in `.mp4` |
| `poster` | `null` for images; required `.webp` for videos |
| `alt` | Required for publishing (drafts may omit it and get a warning) |
| `caption` | Optional string |
| `tag` | Optional filmstrip label |

## Media and publishing rules

- Image files: ≤ 2 MiB; video files: ≤ 18 MiB; all published media: ≤ 80 MiB.
- Images are stored as WebP (longest side ≤ 1920px); videos as H.264/AAC MP4 (≤ 1080p, ≤ 12s) with a WebP poster.
- Publishing rejects phone numbers, student-ID-like strings, `.docx` / `.pdf` links, and unsafe protocols.
- The studio stages only `content/**` and `media/**`. Keep unrelated changes out of the publish commit.
