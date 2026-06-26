import http from 'node:http';
import { Buffer } from 'node:buffer';

const PORT = Number(process.env.PORT || 3001);
const CRAFTWORLD_GRAPHQL_URL = process.env.CRAFTWORLD_GRAPHQL_URL || 'https://craft-world.gg/graphql';
const CW_APP_VERSION = process.env.CW_APP_VERSION || '1.11.0';
const RONIN_RPC_URL = process.env.RONIN_RPC_URL || 'https://api.roninchain.com/rpc';
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function getAllowedOrigins() {
  return [...DEFAULT_ALLOWED_ORIGINS, ...(process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)];
}

export function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const parts = String(authHeader).trim().split(' ');
  if (parts.length < 2 || parts[0].toLowerCase() !== 'bearer') return null;
  const token = parts.slice(1).join(' ').trim();
  if (!token || token.toLowerCase().startsWith('bearer ')) return extractBearerToken(token);
  return token;
}

export function normalizeCraftWorldToken(value) {
  if (!value) return null;
  const token = String(value).trim();
  if (!token) return null;
  if (token.startsWith('jwt_')) return token;
  if ((token.match(/\./g) || []).length >= 2) return `jwt_${token}`;
  return token;
}

function decodeJwtPayload(token) {
  try {
    const clean = token?.startsWith('jwt_') ? token.slice(4) : token;
    const payload = clean?.split('.')[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

export async function callCraftWorldGraphQL(query, variables = {}, bearerToken, options = {}) {
  const fallback = process.env.CRAFTWORLD_JWT;
  const requireAuth = options.requireAuth !== false;
  const normalizedToken = normalizeCraftWorldToken(bearerToken || (requireAuth ? fallback : null));
  if (requireAuth && !normalizedToken) {
    const err = new Error('Missing CraftWorld bearer token');
    err.statusCode = 401;
    throw err;
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-app-version': CW_APP_VERSION,
  };
  if (normalizedToken) {
    headers.Authorization = `Bearer ${normalizedToken}`;
  }

  const res = await fetch(CRAFTWORLD_GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`CraftWorld HTTP ${res.status}`);
    err.statusCode = res.status;
    err.details = json;
    throw err;
  }
  if (json.errors) {
    const err = new Error(json.errors[0]?.message || 'CraftWorld GraphQL error');
    err.statusCode = 502;
    err.details = json.errors;
    throw err;
  }
  return json.data || {};
}

const accountStatusQuery = `query AccountStatus { account { power powerMillisecondsUntilRefill powerLastRefill updatedAt } }`;
const proficienciesQuery = `query AccountProficiencies { account { proficiencies { symbol collectedAmount claimedLevel } } }`;
const workshopQuery = `query AccountWorkshop { account { workshop { symbol level } } }`;
const uidQuery = `query AccountUid { account { id walletAddress profile { uid walletAddress avatarUrl displayName } wallets { address type provider providerId primary } tradeAccount { tradeCount dailyRefillAmount totalTradeAmount capacity } } }`;
const configQuery = `query FetchCraftWorld($uid: ID!) { fetchCraftWorld(uid: $uid) { landPlots { areas { symbol factories { factory { level definition { id } } } mines { level definition { id } } } } dynos { meta { displayName rarity } production { amount symbol } } resources { symbol amount } } }`;

function hms(ms) {
  const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function resolveUid(token) {
  const data = await callCraftWorldGraphQL(uidQuery, {}, token);
  const account = data.account || {};
  const payload = decodeJwtPayload(token);
  const uid = account.profile?.uid || account.uid || account.id || payload.uid || payload.user_id || payload.sub || null;
  return { uid, account, tokenPayloadFieldsTried: ['uid', 'user_id', 'sub'] };
}

async function handleApi(path, token) {
  if (path === '/api/account_status') {
    const data = await callCraftWorldGraphQL(accountStatusQuery, {}, token);
    const account = data.account || {};
    const msUntilRefill = account.powerMillisecondsUntilRefill ?? 0;
    return { ...account, msUntilRefill, refillSeconds: Math.ceil(msUntilRefill / 1000), refillHMS: hms(msUntilRefill) };
  }
  if (path === '/api/account_proficiencies') return { proficiencies: (await callCraftWorldGraphQL(proficienciesQuery, {}, token)).account?.proficiencies || [] };
  if (path === '/api/account_workshop') return { workshop: (await callCraftWorldGraphQL(workshopQuery, {}, token)).account?.workshop || [] };
  if (path === '/api/account_uid') return resolveUid(token);
  if (path === '/api/craftworld_config') {
    const { uid, account } = await resolveUid(token);
    if (!uid) { const err = new Error('Could not resolve CraftWorld UID'); err.statusCode = 404; throw err; }
    const data = await callCraftWorldGraphQL(configQuery, { uid }, token);
    return { uid, account, fetchCraftWorld: data.fetchCraftWorld || null };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && getAllowedOrigins().includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (url.pathname === '/' || url.pathname === '') return send(res, 200, { ok: true, service: 'craft-world-calculator-api', health: '/health' });
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    const token = extractBearerToken(req.headers.authorization);
    if (req.method === 'POST' && url.pathname === '/api/game') {
      const body = await readJson(req);
      const data = await callCraftWorldGraphQL(body.query, body.variables || {}, token, { requireAuth: false });
      return send(res, 200, { data });
    }
    if (req.method === 'POST' && url.pathname === '/api/ronin-rpc') {
      const body = await readJson(req);
      const rpcRes = await fetch(RONIN_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const rpcText = await rpcRes.text();
      res.writeHead(rpcRes.status, { 'Content-Type': rpcRes.headers.get('content-type') || 'application/json' });
      return res.end(rpcText);
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const payload = await handleApi(url.pathname, token);
    if (!payload) return send(res, 404, { error: 'Not found' });
    return send(res, 200, payload);
  } catch (err) {
    return send(res, err.statusCode || 500, { error: err.message || 'Server error', details: err.details });
  }
});
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

server.listen(PORT, () => console.log(`CraftWorld backend listening on ${PORT}`));
