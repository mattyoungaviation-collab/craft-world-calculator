# Craft World Calculator — Render Setup

This repo has two deployable services:

1. **Backend web service** at the repo root. It relays authenticated CraftWorld/Firebase token requests to CraftWorld GraphQL.
2. **Frontend static site** in `dashboard-app/`. It reads `cw_token` from browser `localStorage` and calls the backend API.

The app does **not** use Ronin wallet signatures as the primary auth flow. The expected production flow is:

1. CraftWorld/Firebase login places a Firebase ID token in browser `localStorage` as `cw_token`.
2. The frontend strips any accidental leading `Bearer ` from that value.
3. The frontend sends backend requests with `Authorization: Bearer <firebase idToken>`.
4. The backend extracts the bearer token, converts Firebase JWTs to CraftWorld format by adding `jwt_` when needed, and calls `https://craft-world.gg/graphql`.

Never put real Firebase ID tokens, CraftWorld JWTs, or backend environment variables in GitHub, Render public logs, screenshots, Discord, or frontend source code.

---

## 1. Render backend service

Create this service first so you have the backend URL for the frontend settings.

### Service type

- Render service type: **Web Service**
- Root directory: repo root, leave blank or use `.`
- Runtime: **Node**
- Build command: leave blank, or use:

```bash
npm install --omit=dev
```

- Start command:

```bash
npm start
```

The root `package.json` starts the backend with `node server/server.js`.

### Backend environment variables

Required:

| Name | Example | Notes |
| --- | --- | --- |
| `CORS_ORIGINS` | `https://craft-world-calculator.onrender.com` | Your Render frontend URL. Use a comma-separated list for multiple allowed frontend origins. |

Usually provided by Render:

| Name | Example | Notes |
| --- | --- | --- |
| `PORT` | `10000` | Render sets this automatically. Local default is `3001`. |

Optional:

| Name | Example | Notes |
| --- | --- | --- |
| `CRAFTWORLD_JWT` | `<server fallback token>` | Optional server fallback token. Per-user browser calls should still use `cw_token`. Do not expose this to frontend code. |
| `CRAFTWORLD_GRAPHQL_URL` | `https://craft-world.gg/graphql` | Defaults to the correct CraftWorld GraphQL endpoint. |
| `CW_APP_VERSION` | `1.11.0` | Defaults to `1.11.0`. |
| `RONIN_RPC_URL` | `https://api.roninchain.com/rpc` | Optional override for the backend Ronin RPC relay used by on-chain fallback data. |

### Backend health check

After deploy, opening the backend root should return a JSON status instead of `Not found`:

```text
https://<your-backend-service>.onrender.com/
```

For health checks, use:

```text
https://<your-backend-service>.onrender.com/health
```

Expected response:

```json
{"ok":true}
```

### Backend API routes

The frontend uses these backend routes:

- `GET /api/account_status`
- `GET /api/account_proficiencies`
- `GET /api/account_workshop`
- `GET /api/account_uid`
- `GET /api/craftworld_config`
- `POST /api/game` for legacy CraftWorld GraphQL calls, including unauthenticated login nonce/custom-token requests
- `POST /api/ronin-rpc` for on-chain fallback RPC requests

All protected routes expect this request header:

```text
Authorization: Bearer <firebase idToken>
```

Do not send `Bearer Bearer <token>`.

---

## 2. Render frontend static site

Create this after the backend is deployed.

### Service type

- Render service type: **Static Site**
- Root directory: `dashboard-app`
- Build command:

```bash
npm ci && npm run build
```

- Publish directory:

```text
dist
```

Do **not** use `npm run dev` for production.

### Frontend environment variables

Required:

| Name | Example | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `https://craft-world-calculator-api.onrender.com` | The full URL of your Render backend web service. No trailing slash is needed. |

Do not put backend-only secrets such as `CRAFTWORLD_JWT` in the frontend static site environment.

---

## 3. Connect frontend and backend CORS

After creating the frontend static site, copy its Render URL and add it to the backend service:

```text
CORS_ORIGINS=https://<your-frontend-service>.onrender.com
```

If you have preview URLs or a custom domain, use commas:

```text
CORS_ORIGINS=https://<your-frontend-service>.onrender.com,https://www.your-custom-domain.com
```

Redeploy the backend after changing `CORS_ORIGINS`.

---

## 4. Local development

Open two terminals.

### Terminal 1: backend

From the repo root:

```bash
npm install
npm start
```

Backend local URL:

```text
http://localhost:3001
```

### Terminal 2: frontend

From `dashboard-app/`:

```bash
npm ci
VITE_API_URL=http://localhost:3001 npm run dev
```

Frontend local URL is usually:

```text
http://localhost:5173
```

The backend already allows these local origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

---

## 5. Browser token setup

The browser should already have a CraftWorld/Firebase token from login. For manual local testing only, you can set a placeholder token in DevTools:

```js
localStorage.setItem('cw_token', '<firebase idToken>')
```

The frontend helper reads this token, strips a leading `Bearer ` if one was accidentally saved, and sends requests to the backend as:

```text
Authorization: Bearer <firebase idToken>
```

The backend then normalizes before calling CraftWorld:

- Already starts with `jwt_` → use unchanged.
- Looks like a Firebase JWT with two dots → prefix with `jwt_`.
- Never double-prefix `jwt_`.

---

## 6. Quick deploy checklist

Backend:

- [ ] Create Render Web Service from repo root.
- [ ] Set start command to `npm start`.
- [ ] Set `CORS_ORIGINS` to the frontend Render URL.
- [ ] Confirm `/health` returns `{"ok":true}`.

Frontend:

- [ ] Create Render Static Site with root directory `dashboard-app`.
- [ ] Set build command to `npm ci && npm run build`.
- [ ] Set publish directory to `dist`.
- [ ] Set `VITE_API_URL` to the backend Render URL.
- [ ] Confirm the deployed app can read `cw_token` and call `/api/craftworld_config` without a CORS error.

---

## 7. Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Browser CORS error | Frontend URL is not in backend `CORS_ORIGINS`. | Add the exact frontend URL to backend `CORS_ORIGINS` and redeploy backend. |
| `401 Missing CraftWorld bearer token` | Browser has no `cw_token`, or request did not include `Authorization`. | Confirm `localStorage.getItem('cw_token')` exists and frontend `VITE_API_URL` points to backend. |
| CraftWorld `401` or `403` | Token is expired, malformed, or not allowed for that UID. | Refresh CraftWorld/Firebase login and retry with a fresh `cw_token`. |
| `Bearer Bearer` in requests | Token was saved with `Bearer ` and code added another prefix. | The frontend helper strips this; clear and reset `cw_token` if needed. |
| Wrong user data | Backend fallback token is being used instead of browser token. | Confirm frontend requests include `Authorization: Bearer <firebase idToken>`. |
| Frontend build uses dev server | Production command is wrong. | Use `npm ci && npm run build`; do not use `npm run dev` on Render production. |
