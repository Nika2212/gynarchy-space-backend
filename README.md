# Gynarchy Space API

NestJS backend for search, thumbnails, and authenticated video proxy.

Base URL: `http://localhost:3000/api`

## Setup

```bash
npm install
cp .env.example .env.dev
```

Fill `.env.dev`:

| Key | Required | Notes |
|---|---|---|
| `PORT` | no | Default `3000` |
| `JWT_SECRET` | yes | Signing secret |
| `APP_PASSCODE` | yes | Shared login passcode |
| `XMD` | yes | Origin base URL (`https://...`) |
| `CORS_ORIGIN` | yes | Frontend origin(s), comma-separated. Must match the UI exactly, including port. Example: `http://localhost:4200` |
| `TRUST_PROXY` | no | `0` locally. `1` (or hop count) behind Nginx/Caddy |

```bash
npm run start:dev
```

Production: fill `.env.prod` and run `npm run start:prod`.

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
| 429 | More than 6 attempts / minute |

### Search (JWT)

`GET /api/media?keyword=...&page=1`

`sort` and `filter` are ignored. Invalid `page` defaults to `1`.

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

- `duration` is milliseconds
- `isLastPage` is true when the page has fewer than 24 items
- Prefix paths with `API_BASE`: watch `/api/media/<identifier>`, image `/api/images/<token>`

| Status | When |
|---|---|
| 400 | Missing/invalid keyword |
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

### Watch (JWT)

`GET /api/media/<identifier>`

Supports `Range`. Response is `video/*` (or `video/mp4` when the origin sends `application/octet-stream`).

**A `<video src>` tag cannot send Bearer.** Fetch the stream with `Authorization` (and `Range` if needed), then use a `blob:` URL or Media Source. Native `src="/api/media/..."` will 401.

| Status | When |
|---|---|
| 401 | No/invalid token |
| 404 | Bad id |
| 429 | More than 20 watches / minute, or JSDOM queue full |
| 502 | Upstream stream failed |

### Not implemented

These only return a placeholder message. Do not build product UI on them:

- `GET /api/media/:id/like`
- `GET /api/media/:id/favorite`
- `GET /api/media/:id/download`

## Scripts

```bash
npm run start:dev    # watch
npm run start        # dist, .env.dev
npm run start:prod   # dist, .env.prod
npm test
npm run test:e2e
```
