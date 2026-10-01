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
| `XMD` | yes | Origin base URL (`https://...`) |
| `CORS_ORIGIN` | yes | Frontend origin(s), comma-separated. Must match the UI exactly, including port. Example: `http://localhost:4200` |
| `TRUST_PROXY` | no | `0` locally. `1` (or hop count) behind Nginx/Caddy |
| `MONGODB_URI` | yes | MongoDB Atlas SRV URL (`mongodb+srv://...`) |
| `MONGODB_USERNAME` | no | Atlas user |
| `MONGODB_PASSWORD` | no | Atlas password |

Search comes straight from XMD; searches never touch the database. MongoDB Atlas stores only media the user cares about: liked, favorited, downloaded, or with watch progress. A row is created on the first of those and deleted once none is left. Titles, descriptions, URLs, and thumbnail tokens are encrypted with `JWT_SECRET` before write. The lookup key is an HMAC, not the raw identifier.

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

**200**

```json
{ "accessToken": "<jwt>" }
```

| Status | When |
|---|---|
| 400 | Missing/empty body or extra fields |
| 401 | Wrong passcode |
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
| 429 | More than 180 / minute |
| 502 | Upstream image failed |

### Watch (no JWT)

`GET /api/media/<identifier>`

Supports `Range`. Response is `video/*` (or `video/mp4` when the origin sends `application/octet-stream`).

Use as `<video src="{API_BASE}/media/{identifier}">`. Public on purpose, like thumbnails, so the native player can stream and seek. Only ids that point at the XMD site are served.

| Status | When |
|---|---|
| 404 | Bad id, or id outside the XMD site |
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

### Not implemented

- `GET /api/media/:id/download` — placeholder only (no file storage)

## Scripts

```bash
npm run start:dev    # watch
npm run start        # dist, development
npm run start:prod   # dist, production
npm test
npm run test:e2e
```
