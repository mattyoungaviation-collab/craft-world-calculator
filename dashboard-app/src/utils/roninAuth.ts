/**
 * roninAuth.ts — Ronin Wallet connection, message signing, and Craft World JWT auth.
 *
 * Flow:
 *   1. Connect Ronin Wallet (via injected window.ronin provider)
 *   2. Request challenge message from Craft World server
 *   3. Sign the challenge with the wallet
 *   4. Exchange signature for JWT token
 *   5. Use JWT to query authenticated game data
 *
 * If the auto-discovery of auth endpoint fails, the user can paste their JWT directly.
 */

import { fetchPlayerAccountWithJWT, type PlayerAccountInfo } from './accountService';
import { apiUrl, getCwToken } from './api';

const GAME_API_URL = '/api/game';

const AUTH_STORAGE_KEY = 'cw-auth-token';
const ADDRESS_STORAGE_KEY = 'cw-auth-address';
const REFRESH_TOKEN_KEY = 'cw-refresh-token';
const TOKEN_EXPIRES_AT_KEY = 'cw-token-expires-at';
const FIREBASE_API_KEY = 'AIzaSyDgDDykbRrhbdfWUpm1BUgj4ga7d_-wy_g';

// ─── Types ───
export interface AuthState {
  address: string | null;
  jwtToken: string | null;
  isConnected: boolean;
  isAuthenticated: boolean;
}

// ─── Raw Ronin Provider ───
interface RoninRequestArguments {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

interface RoninProvider {
  isRonin?: boolean;
  chainId?: string;
  selectedAddress?: string;
  request: (args: RoninRequestArguments) => Promise<unknown>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    ronin?: any;
    roninExtension?: any;
  }
}

// ─── Helpers ───

function getRoninProvider(): RoninProvider | null {
  const rawRonin = window.ronin;
  if (rawRonin) {
    if (rawRonin.provider) return rawRonin.provider;
    if (typeof rawRonin.request === 'function') return rawRonin as RoninProvider;
  }

  const rawExtension = window.roninExtension;
  if (rawExtension) {
    if (rawExtension.provider) return rawExtension.provider;
    if (typeof rawExtension.request === 'function') return rawExtension as RoninProvider;
  }

  return null;
}

export function isRoninWalletInstalled(): boolean {
  return getRoninProvider() !== null;
}

// ─── Step 1: Connect ───
export async function connectRoninWallet(): Promise<string> {
  const provider = getRoninProvider();
  if (!provider) {
    throw new Error('Ronin Wallet no está instalado. Instálalo desde https://wallet.roninchain.com');
  }

  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error('No se pudo conectar la Ronin Wallet. Revisa que esté desbloqueada.');
  }

  const address = accounts[0].toLowerCase();
  localStorage.setItem(ADDRESS_STORAGE_KEY, address);
  return address;
}

// ─── Step 2: Get Challenge ───
async function fetchChallenge(address: string): Promise<string> {
  const query = `
    query GetNonce($walletAddress: String!) {
      getNonce(walletAddress: $walletAddress) {
        nonce
      }
    }
  `;
  try {
    const res = await fetch(apiUrl(GAME_API_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': '1.15.1'
      },
      body: JSON.stringify({ query, variables: { walletAddress: address } }),
    });
    const json = await res.json();
    if (json.data?.getNonce?.nonce) {
      console.log('✅ Challenge (nonce) obtained via GraphQL getNonce');
      return json.data.getNonce.nonce;
    }
    if (json.errors) {
      throw new Error(json.errors[0]?.message || 'GraphQL error generating nonce');
    }
  } catch (err: any) {
    console.error('Error fetching challenge:', err);
    throw err;
  }

  throw new Error('No se pudo obtener el mensaje de desafío (nonce) del servidor de Craft World.');
}

// ─── Step 3: Sign Message ───
export async function signMessage(message: string, address: string): Promise<string> {
  const provider = getRoninProvider();
  if (!provider) {
    throw new Error('Ronin Wallet no está conectada.');
  }

  const signature = await provider.request({
    method: 'personal_sign',
    params: [message, address],
  }) as string;

  return signature;
}

// ─── Step 4: Exchange Signature for JWT ───
interface FirebaseAuthResult {
  idToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

async function exchangeSignature(address: string, signature: string): Promise<FirebaseAuthResult> {
  const query = `
    mutation LoginForCustomToken($signature: String!, $walletAddress: String!) {
      loginForCustomToken(signature: $signature, walletAddress: $walletAddress) {
        customToken
      }
    }
  `;
  try {
    const res = await fetch(apiUrl(GAME_API_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': '1.15.1'
      },
      body: JSON.stringify({ query, variables: { walletAddress: address, signature } }),
    });
    const json = await res.json();
    const customToken = json.data?.loginForCustomToken?.customToken;
    if (!customToken) {
      if (json.errors) {
        throw new Error(json.errors[0]?.message || 'GraphQL error logging in');
      }
      throw new Error('No se recibió el token personalizado (customToken) desde el juego.');
    }

    console.log('✅ Firebase Custom Token obtained via GraphQL loginForCustomToken');

    // Exchange customToken for ID Token (JWT) via Firebase Auth REST API
    const fbRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });

    if (!fbRes.ok) {
      const errJson = await fbRes.json();
      throw new Error(`Error en Firebase Auth: ${errJson.error?.message || fbRes.statusText}`);
    }

    const fbJson = await fbRes.json();
    const idToken = fbJson.idToken;
    const refreshToken = fbJson.refreshToken;
    const expiresIn = parseInt(fbJson.expiresIn || '3600');

    if (!idToken) {
      throw new Error('No se recibió el token de identidad (ID Token) desde Firebase.');
    }
    console.log(`✅ Firebase ID Token (JWT) obtained successfully (expires in ${expiresIn}s)`);

    return { idToken, refreshToken, expiresIn };
  } catch (err: any) {
    console.error('Error exchanging signature:', err);
    throw err;
  }
}

// ─── Full Auth Flow ───
export async function authenticateWithRonin(): Promise<{ address: string; jwtToken: string; refreshToken: string }> {
  console.group('🔐 Ronin Auth Flow');

  // Step 1: Connect
  console.log('Step 1: Connecting Ronin Wallet...');
  const address = await connectRoninWallet();
  console.log(`✅ Connected: ${address}`);

  // Step 2: Get challenge
  console.log('Step 2: Requesting challenge...');
  const message = await fetchChallenge(address);
  console.log(`✅ Challenge obtained: ${message.slice(0, 60)}...`);

  // Step 3: Sign message
  console.log('Step 3: Signing message...');
  const signature = await signMessage(message, address);
  console.log(`✅ Signature: ${signature.slice(0, 60)}...`);

  // Step 4: Exchange for JWT + refreshToken
  console.log('Step 4: Exchanging signature for JWT...');
  const { idToken: jwtToken, refreshToken, expiresIn } = await exchangeSignature(address, signature);
  console.log(`✅ JWT obtained: ${jwtToken.slice(0, 40)}... (expires in ${expiresIn}s)`);

  console.groupEnd();

  // Store all tokens
  localStorage.setItem('cw_token', jwtToken);
  localStorage.setItem(AUTH_STORAGE_KEY, jwtToken);
  localStorage.setItem(ADDRESS_STORAGE_KEY, address);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  localStorage.setItem(TOKEN_EXPIRES_AT_KEY, String(Date.now() + expiresIn * 1000));

  return { address, jwtToken, refreshToken };
}

// ─── Load saved auth ───
export function loadSavedAuth(): AuthState {
  const jwtToken = getCwToken() || null;
  const address = localStorage.getItem(ADDRESS_STORAGE_KEY);
  return {
    address,
    jwtToken,
    isConnected: !!address,
    isAuthenticated: !!jwtToken,
  };
}

// ─── Clear auth ───
export function clearAuth(): void {
  localStorage.removeItem('cw_token');
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(ADDRESS_STORAGE_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
}

// ─── Refresh Firebase Token ───
export async function refreshFirebaseToken(refreshToken: string): Promise<{ idToken: string; refreshToken: string; expiresIn: number }> {
  console.log('🔄 Refreshing Firebase token...');
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(`Firebase token refresh failed: ${errJson.error?.message || res.statusText}`);
  }

  const json = await res.json();
  const newIdToken = json.id_token;
  const newRefreshToken = json.refresh_token;
  const expiresIn = parseInt(json.expires_in || '3600');

  if (!newIdToken) {
    throw new Error('Failed to refresh Firebase token: no id_token returned');
  }

  // Update stored tokens
  localStorage.setItem('cw_token', newIdToken);
  localStorage.setItem(AUTH_STORAGE_KEY, newIdToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
  localStorage.setItem(TOKEN_EXPIRES_AT_KEY, String(Date.now() + expiresIn * 1000));

  console.log(`✅ Firebase token refreshed (expires in ${expiresIn}s)`);
  return { idToken: newIdToken, refreshToken: newRefreshToken, expiresIn };
}

// ─── Get valid token, refreshing if needed ───
export async function getValidToken(): Promise<string | null> {
  const token = getCwToken();
  if (!token) return null;

  const expiresAt = parseInt(localStorage.getItem(TOKEN_EXPIRES_AT_KEY) || '0');
  const now = Date.now();

  // If token expires within 2 minutes, refresh proactively
  if (expiresAt > 0 && now > expiresAt - 120000) {
    const savedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (savedRefresh) {
      try {
        const { idToken } = await refreshFirebaseToken(savedRefresh);
        return idToken;
      } catch (err) {
        console.warn('⚠️ Token refresh failed, using existing token:', err);
        return token;
      }
    }
  }

  return token;
}

// ─── Authenticated data fetch ───
export async function fetchAuthenticatedAccountData(jwtToken: string, userId?: string): Promise<PlayerAccountInfo> {
  return fetchPlayerAccountWithJWT(jwtToken, userId);
}

// ─── Check if JWT is valid by making a test query ───
export async function validateJWT(jwtToken: string): Promise<boolean> {
  const testQuery = `
    query ValidateToken {
      account {
        id
      }
    }
  `;
  try {
    const res = await fetch(apiUrl(GAME_API_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
        'X-App-Version': '1.15.1',
      },
      body: JSON.stringify({ query: testQuery }),
    });
    const json = await res.json();
    return !json.errors;
  } catch {
    return false;
  }
}
