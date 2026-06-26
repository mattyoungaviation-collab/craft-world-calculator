/**
 * craftWorldService.ts — Direct CraftWorld GraphQL integration
 *
 * Implements:
 *   1. Token normalization (jwt_ prefix for Firebase tokens)
 *   2. The complete AggregatedCraftWorldDataQuery (same query the game client uses)
 *   3. Parsing of the massive response into PlayerAccountInfo
 *   4. Auto-refresh helper with UID resolution
 *
 * Reference: procesodeobtcwt.txt and datagame.txt
 */

import { authFetch } from './api';
import type {
  PlayerAccountInfo,
  PlayerMine,
  PlayerResource,
  DynoInfo,
  VaultInfo,
  WorkerInfo,
  ResearchInfo,
  PowerPlantInfo,
} from './accountService';

// ─── Constants ───

const CW_CONFIG_URL = '/api/craftworld_config';

// ─── Token Normalization ───

/**
 * CraftWorld expects Firebase tokens prefixed with "jwt_".
 * If the token is a standard Firebase JWT (3 dot-separated parts),
 * prefix it with "jwt_". If it already starts with "jwt_", leave it alone.
 */
export function normalizeCraftWorldToken(token: string): string {
  const value = String(token || '').trim();
  if (!value) throw new Error('Missing CraftWorld token');

  // Already normalized
  if (value.startsWith('jwt_')) return value;

  // Standard Firebase JWT has 3 dot-separated segments
  if ((value.match(/\./g) || []).length >= 2) {
    return `jwt_${value}`;
  }

  return value;
}

/**
 * Decode JWT payload to extract UID without a library.
 */
export function decodeJWTPayload(token: string): Record<string, any> {
  try {
    const cleanToken = token.startsWith('jwt_') ? token.slice(4) : token;
    const parts = cleanToken.split('.');
    if (parts.length < 2) return {};
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

// CraftWorld GraphQL query details live on the backend.

// ─── API Call ───

export async function fetchAggregatedCraftWorldData(_idToken?: string): Promise<{
  account: any;
  features: any[];
  dynoProductionCycle: any;
  events: any[];
  resources: any[];
}> {
  console.log('🌐 Calling backend CraftWorld config route...');

  const res = await authFetch(CW_CONFIG_URL);

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`CraftWorld backend error: HTTP ${res.status} — ${errorText.slice(0, 200)}`);
  }

  const json = await res.json();
  const account = {
    ...(json.account || {}),
    ...(json.fetchCraftWorld || {}),
    profile: {
      ...(json.account?.profile || {}),
      uid: json.uid || json.account?.profile?.uid || json.account?.id,
    },
  };

  console.log('✅ Backend CraftWorld config route succeeded');

  return {
    account,
    features: [],
    dynoProductionCycle: null,
    events: [],
    resources: account.resources || [],
  };
}

// ─── Parse Response into PlayerAccountInfo ───

const RAW_RESOURCES = [
  'EARTH', 'WATER', 'FIRE', 'DYNOFISH', 'MAGICSHARD', 'BURNTRICE',
  'WOOD', 'STONE', 'COAL', 'IRON', 'GOLD',
];

export function parseAggregatedData(
  account: any,
  fallbackIdToken?: string,
): PlayerAccountInfo {
  if (!account) {
    throw new Error('No account data returned from CraftWorld');
  }

  // ─── Extract mines and factories from multiple sources ───
  const extractedMines: PlayerMine[] = [];
  const extractedFactories: PlayerMine[] = [];
  const extractedPowerPlants: PlayerMine[] = [];
  const extractedBatteries: PlayerMine[] = [];

  const classifyAndPush = (symbol: string, level: number, id: string) => {
    const buildingObj: PlayerMine = {
      id,
      level: level + 1, // CraftWorld API returns 0-indexed levels
      definition: { id: symbol },
    };
    if (symbol.includes('POWER') || symbol.includes('PLANT')) {
      extractedPowerPlants.push(buildingObj);
    } else if (symbol.includes('BATTERY') || symbol.includes('ACCUMULATOR')) {
      extractedBatteries.push(buildingObj);
    } else if (RAW_RESOURCES.includes(symbol) || symbol.includes('MINE') || symbol.includes('COLLECTOR') || symbol.includes('EXTRACTOR')) {
      extractedMines.push(buildingObj);
    } else {
      extractedFactories.push(buildingObj);
    }
  };

  // From account.mines
  if (account.mines) {
    account.mines.forEach((m: any) => {
      const symbol = (m.definition?.id || m.id || '').toUpperCase();
      classifyAndPush(symbol, m.level, m.id);
    });
  }

  // From account.landPlots → areas → factories
  if (account.landPlots) {
    account.landPlots.forEach((plot: any) => {
      if (plot.areas) {
        plot.areas.forEach((area: any) => {
          if (area.factories) {
            area.factories.forEach((f: any) => {
              if (f.factory) {
                const symbol = (f.factory.definition?.id || f.factory.id || '').toUpperCase();
                classifyAndPush(symbol, f.factory.level, f.factory.id);
              }
            });
          }
        });
      }
    });
  }

  // From account.factoryInventory
  if (account.factoryInventory) {
    account.factoryInventory.forEach((f: any) => {
      const symbol = (f.definitionId || f.id || '').toUpperCase();
      classifyAndPush(symbol, f.level, f.id);
    });
  }

  // ─── Resources ───
  const resources: PlayerResource[] = (account.resources || []).map((r: any) => ({
    symbol: r.symbol,
    amount: r.amount,
  }));

  // ─── Resources On Chain ───
  const resourcesOnChain: PlayerResource[] = (account.resourcesOnChain || []).map((r: any) => ({
    symbol: r.symbol,
    amount: r.amount,
  }));

  // ─── Dynos ───
  const dynos: DynoInfo[] = (account.dynos || []).map((d: any) => ({
    production: d.production || [],
    claimableResources: d.claimableResources || [],
    meta: {
      displayName: d.meta?.displayName || '',
      imageUrl: d.meta?.imageUrl,
      rarity: d.meta?.rarity || '',
      isOneOfOne: d.meta?.isOneOfOne,
    },
  }));

  // ─── Vaults ───
  const vaults: VaultInfo[] = (account.vaults || []).map((v: any) => ({
    symbol: v.symbol,
    amount: v.amount,
    capacity: v.capacity,
    isUnlocked: v.isUnlocked,
    buildingUnlockLevel: v.buildingUnlockLevel,
  }));

  // ─── Workers ───
  const workers: WorkerInfo[] = (account.workers || []).map((w: any) => ({
    id: w.id,
    name: w.name,
    skin: w.skin,
    areaBoostValue: w.areaBoostValue || 0,
    areaUuid: w.areaUuid,
    isAreaLead: w.isAreaLead,
    traits: w.traits,
    training: w.training,
    abilityId: w.abilityId,
    abilityActivation: w.abilityActivation,
    cooldownEndsAt: w.cooldownEndsAt,
  }));

  // ─── Researches ───
  const researches: ResearchInfo[] = (account.researches || []).map((r: any) => ({
    symbol: r.symbol,
    remainingInMilliseconds: r.remainingInMilliseconds,
    claimed: r.claimed,
  }));

  // ─── Power Plants (detailed) ───
  const detailedPowerPlants: PowerPlantInfo[] = (account.fullPlayerBase?.powerPlants || []).map((pp: any) => ({
    buildingId: pp.buildingId,
    lastClaimedAt: pp.lastClaimedAt,
    storedPower: pp.storedPower || 0,
    inputAmount: pp.inputAmount || 0,
    runningLevel: pp.runningLevel || 0,
    activeBoosters: pp.activeBoosters,
  }));

  // ─── Workshop level from buildings ───
  let workshopLevel = 0;
  if (account.fullPlayerBase?.buildings) {
    const ws = account.fullPlayerBase.buildings.find((b: any) => b.type === 'WORKSHOP');
    if (ws) {
      workshopLevel = ws.level;
    }
  }

  // ─── Profile / UID ───
  const profile = account.profile || {};
  const uid = profile.uid || account.id || '';

  // If we couldn't get UID from account, try JWT payload
  let resolvedUid = uid;
  if (!resolvedUid && fallbackIdToken) {
    const payload = decodeJWTPayload(fallbackIdToken);
    resolvedUid = payload.uid || payload.user_id || payload.sub || '';
  }

  // ─── Build result ───
  const result: PlayerAccountInfo = {
    id: resolvedUid,
    walletAddress: account.walletAddress || profile.walletAddress || '',
    displayName: profile.displayName || `Player ${resolvedUid}`,
    level: 0, // level comes from XP calculation
    uid: resolvedUid,
    avatarUrl: profile.avatarUrl,

    // Buildings
    mines: extractedMines,
    factories: extractedFactories,
    powerPlants: extractedPowerPlants,
    batteries: extractedBatteries,

    // Resources
    resources,
    resourcesOnChain,

    // Workshop & Mastery
    workshopLevel,
    proficiencies: account.proficiencies || [],
    workshop: account.workshop || [],

    // Extended data
    dynos,
    vaults,
    workers,
    researches,
    detailedPowerPlants,
    experiencePoints: account.experiencePoints,
    power: account.power,
    powerLastRefill: account.powerLastRefill,
    skillPoints: account.skillPoints,
    tradeAccount: account.tradeAccount,
    crystalPass: account.crystalPass,
    eggs: account.eggs || [],
    chests: account.chests || [],
    blueprintInventory: account.blueprintInventory || [],
    availablePowerPacks: account.availablePowerPacks || [],
    availableBoosters: account.availableBoosters || [],
    currencyBalances: account.currencyBalances || [],

    // Timestamp
    lastDataRefresh: Date.now(),

    // Raw data preserved
    allRawData: { account, source: 'AggregatedCraftWorldDataQuery' },
    rawAccountData: account,
    rawFactoriesData: extractedFactories,
  };

  // ─── Log summary ───
  console.group('📊 CraftWorld Data Loaded');
  console.log(`👤 Player: ${result.displayName} (${resolvedUid})`);
  console.log(`⛏️ Mines: ${extractedMines.length}`);
  console.log(`🏭 Factories: ${extractedFactories.length}`);
  console.log(`⚡ Power Plants: ${extractedPowerPlants.length}`);
  console.log(`🦕 Dynos: ${dynos.length}`);
  console.log(`📦 Resources: ${resources.length}`);
  console.log(`🏪 Vaults: ${vaults.length}`);
  console.log(`👷 Workers: ${workers.length}`);
  console.log(`🔬 Researches: ${researches.length}`);
  console.log(`⭐ Workshop entries: ${(account.workshop || []).length}`);
  console.log(`🎯 Proficiencies: ${(account.proficiencies || []).length}`);
  console.log(`💰 Power: ${account.power}, XP: ${account.experiencePoints}`);
  console.groupEnd();

  return result;
}

// ─── Convenience: fetch + parse in one call ───

export async function fetchFullPlayerData(idToken: string): Promise<PlayerAccountInfo> {
  const { account } = await fetchAggregatedCraftWorldData(idToken);
  return parseAggregatedData(account, idToken);
}
