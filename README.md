# Gynarchy Space API

NestJS backend for search, thumbnails, and authenticated video proxy.

Base URL: `http://localhost:3000/api`

## Setup

```bash
npm install
```

Fill `.env`:

| Key | Required | Notes |
|---|---|---|
| `PORT` | no | Default `3000` |
| `JWT_SECRET` | yes | Signing secret |
| `APP_PASSCODE` | yes | Shared login passcode |
| `XMD` | yes | XMD origin base URL (`https://...`) |
| `HF` | yes | HF origin base URL (`https://...`) |
| `FVC` | yes | FVC origin base URL (`https://...`) |
| `CORS_ORIGIN` | yes | Frontend origin(s), comma-separated. Must match the UI exactly, including port. Example: `http://localhost:4200` |
| `TRUST_PROXY` | no | `0` locally. `1` (or hop count) behind Nginx/Caddy |
| `MONGODB_URI` | yes | MongoDB Atlas SRV URL (`mongodb+srv://...`) |
| `MONGODB_USERNAME` | no | Atlas user |
| `MONGODB_PASSWORD` | no | Atlas password |
| `B2_ENDPOINT` | no | Backblaze B2 S3 endpoint, e.g. `https://s3.eu-central-003.backblazeb2.com`. Downloads stay off until all `B2_*` are set |
| `B2_REGION` | no | B2 region, e.g. `eu-central-003` |
| `B2_BUCKET` | no | Private bucket name |
| `B2_KEY_ID` | no | Application key ID (limited to the bucket) |
| `B2_APPLICATION_KEY` | no | Application key |
| `STORAGE_LIMIT_GB` | no | Space budget for downloads, default `512` |

Search fans out to every centre (XMD, HF, FVC) in parallel and interleaves the cards; a page is the last one once every centre returns a short page, and a centre that fails or takes longer than 5 seconds only drops its own cards (that page is then never reported as the last one). Searches never touch the database. MongoDB Atlas stores only media the user cares about: liked, favorited, downloaded, or with watch progress. A row is created on the first of those and deleted once none is left. Rows are stored in plain text and looked up by their media identifier. Downloaded files in the bucket are named by an HMAC of the identifier (`JWT_SECRET`), so the bucket listing reveals nothing about the videos.

```bash
npm run start:dev
```

Same `.env` is used for `start:dev` and `start:prod`. On Railway, set the same keys as service variables.

## Frontend contract

Set `API_BASE=http://localhost:3000/api`.

Send JWT as `Authorization: Bearer <token>`. Do not use cookies (`credentials` is off).

Store the token in memory or `sessionStorage`. It lasts 7 days. On **401**, return to passcode.

### Health (no JWT)

`GET /api/health` → `{ "status": "ok" }`

Use this as the Railway HTTP healthcheck path: `/api/health`.

### Auth

`POST /api/security/passcode`

```json
{ "passcode": "..." }
```

With `NODE_ENV=production` the request must also come from the iOS home-screen app: an `iPhone`/`iPad`/`iPod` `User-Agent` and the header `X-Display-Mode: standalone`. Any other device gets the same **401** as a wrong passcode, and it counts toward the block below.

**200**

```json
{ "accessToken": "<jwt>" }
```

| Status | When |
|---|---|
| 400 | Missing/empty body or extra fields |
| 401 | Wrong passcode, or (in production) not the iOS home-screen app |
| 429 | 5 wrong passcodes from one IP. That IP is then blocked for 1 hour, even with the right passcode. Correct logins are not counted |

### Search (JWT)

`GET /api/media?keyword=...&page=1`

`keyword` may be empty or missing: the source's search page is then requested with an empty query. `sort` and `filter` are ignored. Invalid `page` defaults to `1`.

**200**

```json
{
  "meta": {
    "currentPage": 1,
    "isLastPage": false
  },
  "medias": [
    {
      "identifier": "<id>",
      "url": "/media/<id>",
      "title": "...",
      "description": "",
      "postedAt": "...",
      "duration": 0,
      "thumbnailSrc": ["/images/<token>", "..."]
    }
  ]
}
```

- No user flags: merge them from `GET /api/media/library` on the client
- `duration` is milliseconds
- `isLastPage` is true when the page has fewer than 24 items
- Prefix paths with `API_BASE`: watch `/api/media/<identifier>`, image `/api/images/<token>`

| Status | When |
|---|---|
| 400 | Keyword is not a single string, or is longer than 200 characters |
| 401 | No/invalid token |
| 429 | More than 120 searches / minute |

### Thumbnails (no JWT)

`GET /api/images/<token>`

Use as `<img src="{API_BASE}/images/{token}">`. Public on purpose.

| Status | When |
|---|---|
| 400 | Host/type not allowed |
| 404 | Bad token |
| 429 | More than 1200 / minute |
| 502 | Upstream image failed |

### Watch (no JWT)

`GET /api/media/<identifier>`

Supports `Range`. Response is `video/*` (or `video/mp4` when the origin sends `application/octet-stream`). A downloaded video answers **302** to its signed B2 link instead (see Downloads).

Use as `<video src="{API_BASE}/media/{identifier}">`. Public on purpose, like thumbnails, so the native player can stream and seek. Only ids that point at a registered centre site are served; the centre that owns the host resolves the video.

| Status | When |
|---|---|
| 404 | Bad id, or id outside every centre site |
| 429 | More than 300 stream requests / minute (each `Range` request counts), or JSDOM queue full |
| 502 | Upstream stream failed |

### Library (JWT)

`GET /api/media/library`

Every media the user has liked, favorited, downloaded, or started watching, most recently changed first. Load it once (the home resolver does) and mark search results with it.

**200**

```json
{
  "medias": [
    {
      "identifier": "<id>",
      "url": "/media/<id>",
      "title": "...",
      "description": "",
      "postedAt": "...",
      "duration": 0,
      "thumbnailSrc": ["/images/<token>", "..."],
      "isLiked": true,
      "isFavorite": false,
      "isDownloaded": false,
      "watchedAt": "2026-09-26T06:30:00.000Z",
      "watchedTimes": 0,
      "watchPositionAt": 45000
    }
  ]
}
```

`watchedAt` and `watchPositionAt` are left out when the media was never watched. `isDownloaded` is stored but nothing sets it yet.

| Status | When |
|---|---|
| 401 | No/invalid token |
| 429 | More than 120 / minute |

### Like / favorite (JWT)

`PATCH /api/media/:id/like`  
`PATCH /api/media/:id/favorite`

Toggles the flag. Send the card shown to the user, so the stored media can be listed without a search:

```json
{ "media": { "title": "...", "duration": 61000, "postedAt": "...", "thumbnailSrc": ["/images/<token>"] } }
```

**200**

```json
{
  "identifier": "<id>",
  "isLiked": true,
  "isFavorite": false,
  "isDownloaded": false,
  "watchedAt": null,
  "watchedTimes": 0,
  "watchPositionAt": null
}
```

| Status | When |
|---|---|
| 400 | Missing/invalid `media` card or extra fields |
| 401 | No/invalid token |
| 404 | Bad id |
| 429 | More than 120 / minute |

### Watch position (JWT)

`PATCH /api/media/:id/watch-position`

Send this from the player about every 30 seconds. `watchPositionAt` is milliseconds (same unit as `duration`). Also sets `watchedAt` to now. Does not increment `watchedTimes`.

```json
{ "watchPositionAt": 45000, "media": { "title": "...", "duration": 61000, "postedAt": "...", "thumbnailSrc": ["/images/<token>"] } }
```

**200**

```json
{
  "identifier": "<id>",
  "isLiked": false,
  "isFavorite": false,
  "isDownloaded": false,
  "watchedAt": "2026-09-26T06:30:00.000Z",
  "watchedTimes": 0,
  "watchPositionAt": 45000
}
```

The library then returns the saved `watchPositionAt` and `watchedAt` for that item.

| Status | When |
|---|---|
| 400 | Missing/invalid `watchPositionAt` (must be a finite number ≥ 0), missing/invalid `media` card, or extra fields |
| 401 | No/invalid token |
| 404 | Bad id |
| 429 | More than 120 / minute |

### Downloads (JWT)

Downloaded videos are copied to a Backblaze B2 bucket (S3 API). `GET /api/media/<identifier>` then answers **302** with a 6-hour signed B2 link, so playback never streams through this server. Downloads are disabled (503) until every `B2_*` variable is set.

`POST /api/media/<identifier>/download` → **202** with the job. Body `{ "media": { ...card } }`; the card may be left out only to retry a failed download.

`DELETE /api/media/<identifier>/download` cancels an active download, dismisses a failed one, or deletes the stored copy (**200** with the media flags when a library row is left, otherwise **204**).

`GET /api/media/downloads` → `{ jobs: IDownloadJob[], storage: { isConfigured, usedBytes, limitBytes, freeBytes } }`

How a download runs:

- Up to 3 at a time; the rest wait in the queue. Each running download reserves its size, so parallel downloads never overfill the space budget. The source size is probed with `Range: bytes=0-0`, then the video is copied in 16 MB byte ranges, each uploaded as one multipart part.
- Every step (resolve link, probe, part download, part upload, finish) is retried up to 5 times with backoff 1 s, 2 s, 4 s, 8 s. A source that sends nothing for 30 s counts as dropped. A source answering 401/403/404/410 or a non-video type gets a freshly resolved link on the next try. Other 4xx, no byte-range support, or not enough free space fail at once.
- A failed job stays listed with its error until retried or dismissed; its multipart upload is aborted. Jobs live in memory: a restart drops them, and leftover multipart uploads are aborted on the next start.
- Free space is `STORAGE_LIMIT_GB` minus what is stored under `media/` (measured on start, then tracked).

| Status | When |
|---|---|
| 400 | No card and no failed job to retry |
| 404 | Bad id, or id outside every centre site |
| 409 | Already downloaded |
| 503 | Storage is not configured |

**Socket** (Socket.IO, namespace `/downloads`, same origin as the API). Connect with `auth: { token: <jwt> }`; a missing or invalid token gets `downloads:unauthorized` and is disconnected.

| Event | Payload |
|---|---|
| `downloads:snapshot` | On connect: `{ jobs, storage }` |
| `downloads:job` | A job changed: `{ identifier, title, state, receivedBytes, totalBytes, attempt, maxAttempts, error, updatedAt }`. `state` is `queued`, `downloading`, `completed`, `failed`, or `canceled`. Byte progress is sent at most every 500 ms |
| `downloads:removed` | `identifier` of a job that left the list (canceled, dismissed, or 30 s after completing) |
| `downloads:storage` | `{ isConfigured, usedBytes, limitBytes, freeBytes }` after a download completes or a copy is deleted |

## Scripts

```bash
npm run start:dev    # watch
npm run start        # dist, development
npm run start:prod   # dist, production
npm test
npm run test:e2e
```
