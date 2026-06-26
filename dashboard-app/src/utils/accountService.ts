import { apiUrl } from './api';
/**
 * accountService.ts — Queries Craft World GraphQL API
 *
 * Two modes:
 *   1. JWT-based (authenticated) — queries account { mines }, factories, etc.
 *   2. userId-based (public) — queries resourcesByUserId, etc.
 */

const GAME_API_URL = '/api/game';

export interface PlayerMine {
  id: string;
  level: number;
  definition: {
    id: string;
  };
}

export interface PlayerResource {
  symbol: string;
  amount: number;
}

export interface DynoInfo {
  production: { symbol: string; amount: number }[];
  claimableResources: { symbol: string; amount: number }[];
  meta: {
    displayName: string;
    imageUrl?: string;
    rarity: string;
    isOneOfOne?: boolean;
  };
}

export interface VaultInfo {
  symbol: string;
  amount: number;
  capacity: number;
  isUnlocked: boolean;
  buildingUnlockLevel?: number;
}

export interface WorkerInfo {
  id: string;
  name: string;
  skin?: string;
  areaBoostValue: number;
  areaUuid?: string;
  isAreaLead?: boolean;
  traits?: string[];
  training?: {
    id: string;
    workerSlotIndex: number;
    universitySlotIndex: number;
    universityBuildingId: string;
    startedAt: string;
    readyAt: string;
  };
  abilityId?: string;
  abilityActivation?: {
    effect: string;
    activatedAt: string;
    expiresAt: string;
  };
  cooldownEndsAt?: string;
}

export interface ResearchInfo {
  symbol: string;
  remainingInMilliseconds: number;
  claimed: boolean;
}

export interface PowerPlantInfo {
  buildingId: string;
  lastClaimedAt?: string;
  storedPower: number;
  inputAmount: number;
  runningLevel: number;
  activeBoosters?: Array<{ boosterId: string; expiresAt: string }>;
}

export interface PlayerAccountInfo {
  id: string;
  walletAddress: string;
  displayName: string;
  level: number;
  mines: PlayerMine[];
  factories?: PlayerMine[];
  powerPlants?: PlayerMine[];
  batteries?: PlayerMine[];
  resources?: PlayerResource[];
  workshopLevel?: number;
  proficiencies?: Array<{ symbol: string; claimedLevel: number; collectedAmount?: number }>;
  workshop?: Array<{ symbol: string; level: number }>;
  allRawData?: Record<string, any>;
  rawAccountData?: any;
  rawFactoriesData?: any;

  // Extended fields from AggregatedCraftWorldDataQuery
  dynos?: DynoInfo[];
  vaults?: VaultInfo[];
  workers?: WorkerInfo[];
  researches?: ResearchInfo[];
  detailedPowerPlants?: PowerPlantInfo[];
  experiencePoints?: number;
  power?: number;
  powerLastRefill?: string;
  skillPoints?: number;
  tradeAccount?: {
    tradeCount: number;
    dailyRefillAmount: number;
    totalTradeAmount: number;
    capacity: number;
  };
  crystalPass?: {
    claimableCrystals: number;
    claimableDays: number;
    remainingDays: number;
    maxDays: number;
    hasActivePass: boolean;
    isClaimable: boolean;
  };
  eggs?: Array<{ definitionId: string; amount: number }>;
  chests?: Array<{ definitionId: string; count: number }>;
  blueprintInventory?: Array<{ definitionId: string; amount: number; starLevel: number; landPlotUuids: string[] }>;
  availablePowerPacks?: Array<{ id: string; amount: number }>;
  availableBoosters?: Array<{ id: string; amount: number }>;
  resourcesOnChain?: PlayerResource[];
  currencyBalances?: Array<{ type: string; amount: number }>;
  uid?: string;
  avatarUrl?: string;
  lastDataRefresh?: number; // timestamp of last auto-refresh
}

interface QueryAttempt {
  label: string;
  data: any;
  error: string | null;
}

function createHeaders(jwtToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-App-Version': '1.15.1',
  };
  if (jwtToken) {
    headers['Authorization'] = `Bearer ${jwtToken}`;
  }
  return headers;
}

async function tryQuery(
  label: string,
  query: string,
  variables?: Record<string, any>,
  jwtToken?: string,
): Promise<QueryAttempt> {
  try {
    const res = await fetch(apiUrl(GAME_API_URL), {
      method: 'POST',
      headers: createHeaders(jwtToken),
      body: JSON.stringify({ query, variables: variables || null }),
    });
    if (!res.ok) {
      return { label, data: null, error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    if (json.errors) {
      return { label, data: null, error: json.errors[0]?.message || 'GraphQL error' };
    }
    return { label, data: json.data, error: null };
  } catch (err: any) {
    return { label, data: null, error: err.message };
  }
}

/**
 * Queries the account `{ mines }` field using a JWT token (authenticated).
 * Also tries many factory/building field names with the authenticated session.
 */
export function classifyBuildings(allMines: PlayerMine[]): {
  mines: PlayerMine[];
  factories: PlayerMine[];
  powerPlants: PlayerMine[];
  batteries: PlayerMine[];
} {
  const mines: PlayerMine[] = [];
  const factories: PlayerMine[] = [];
  const powerPlants: PlayerMine[] = [];
  const batteries: PlayerMine[] = [];

  const rawResources = ["EARTH", "WATER", "FIRE", "DYNOFISH", "MAGICSHARD", "BURNTRICE", "WOOD", "STONE", "COAL", "IRON", "GOLD"];

  allMines.forEach((m) => {
    const symbol = (m.definition?.id || m.id || '').toUpperCase();
    if (symbol.includes('POWER') || symbol.includes('PLANT')) {
      powerPlants.push(m);
    } else if (symbol.includes('BATTERY') || symbol.includes('ACCUMULATOR')) {
      batteries.push(m);
    } else if (rawResources.includes(symbol) || symbol.includes('MINE') || symbol.includes('COLLECTOR') || symbol.includes('EXTRACTOR')) {
      mines.push(m);
    } else {
      factories.push(m);
    }
  });

  return { mines, factories, powerPlants, batteries };
}

async function runGraphQLDiagnostics(jwtToken: string, userId?: string) {
  console.log("=== STARTING GRAPHQL DIAGNOSTICS ===");
  const testQueries: Array<{ label: string; query: string; variables?: Record<string, any> }> = [
    {
      label: "account.factories",
      query: `query { account { factories { id level definition { id } } } }`
    },
    {
      label: "account.buildings",
      query: `query { account { buildings { id level definition { id } } } }`
    },
    {
      label: "account.structures",
      query: `query { account { structures { id level definition { id } } } }`
    },
    {
      label: "account.powerPlants",
      query: `query { account { powerPlants { id level definition { id } } } }`
    },
    {
      label: "account.inventory",
      query: `query { account { inventory { symbol amount } } }`
    },
    {
      label: "account.resources",
      query: `query { account { resources { symbol amount } } }`
    },
    {
      label: "account.items",
      query: `query { account { items { id definition { id } } } }`
    }
  ];

  if (userId) {
    testQueries.push(
      {
        label: "root.factories",
        query: `query GetFactories($userId: String!) { factories(userId: $userId) { id level definition { id } } }`,
        variables: { userId }
      },
      {
        label: "root.structures",
        query: `query GetStructures($userId: String!) { structures(userId: $userId) { id level definition { id } } }`,
        variables: { userId }
      },
      {
        label: "root.buildings",
        query: `query GetBuildings($userId: String!) { buildings(userId: $userId) { id level definition { id } } }`,
        variables: { userId }
      }
    );
  }

  for (const t of testQueries) {
    const result = await tryQuery(`DIAGNOSTIC: ${t.label}`, t.query, (t as any).variables, jwtToken);
    if (result.error) {
      console.log(`❌ ${t.label}: Failed with error: ${result.error}`);
    } else {
      console.log(`✅ ${t.label}: Succeeded! Data:`, JSON.stringify(result.data, null, 2));
    }
  }
  console.log("=== END GRAPHQL DIAGNOSTICS ===");
}

/**
 * Queries the account `{ mines }` field using a JWT token (authenticated).
 * Exposes profile, structures, and masterpieces data.
 */
export async function fetchPlayerAccountWithJWT(jwtToken: string, userId?: string): Promise<PlayerAccountInfo> {
  const allResults: QueryAttempt[] = [];
  const allRawData: Record<string, any> = {};

  // Run diagnostics in background (don't block UI but print to console)
  runGraphQLDiagnostics(jwtToken, userId).catch(err => console.error("Diagnostics error:", err));

  // 1. Fetch Account (no parameters, uses JWT authentication context)
  const accountQuery = `
    query GetAccount {
      account {
        id
        walletAddress
        profile {
          displayName
          level
        }
        resources {
          symbol
          amount
        }
        mines {
          id
          level
          definition {
            id
          }
        }
        factoryInventory {
          id
          definitionId
          level
        }
        proficiencies {
          symbol
          claimedLevel
        }
        workshop {
          symbol
          level
        }
        fullPlayerBase {
          buildings {
            type
            level
          }
        }
        landPlots {
          id
          name
          isLocked
          areas {
            id
            symbol
            landPlotId
            landPlotPosition
            factories {
              factory {
                id
                level
                definition {
                  id
                }
              }
            }
          }
        }
      }
    }
  `;
  const accountResult = await tryQuery('account (JWT)', accountQuery, undefined, jwtToken);
  allResults.push(accountResult);
  if (accountResult.error) {
    throw new Error(`Error de cuenta: ${accountResult.error}`);
  }
  const account = accountResult.data?.account;
  if (!account) {
    throw new Error('No se pudo cargar la cuenta. Verifica que el JWT sea válido.');
  }
  allRawData.account = account;
  const resolvedUserId = account?.id || userId;

  // 2. Extract and Classify structures
  const extractedMines: PlayerMine[] = [];
  const extractedFactories: PlayerMine[] = [];
  const extractedPowerPlants: PlayerMine[] = [];
  const extractedBatteries: PlayerMine[] = [];

  const rawResources = ["EARTH", "WATER", "FIRE", "DYNOFISH", "MAGICSHARD", "BURNTRICE", "WOOD", "STONE", "COAL", "IRON", "GOLD"];

  const classifyAndPush = (symbol: string, level: number, id: string) => {
    const buildingObj: PlayerMine = {
      id: id,
      level: level + 1, // Add +1 since Craft World API returns 0-indexed levels
      definition: { id: symbol }
    };
    if (symbol.includes('POWER') || symbol.includes('PLANT')) {
      extractedPowerPlants.push(buildingObj);
    } else if (symbol.includes('BATTERY') || symbol.includes('ACCUMULATOR')) {
      extractedBatteries.push(buildingObj);
    } else if (rawResources.includes(symbol) || symbol.includes('MINE') || symbol.includes('COLLECTOR') || symbol.includes('EXTRACTOR')) {
      extractedMines.push(buildingObj);
    } else {
      extractedFactories.push(buildingObj);
    }
  };

  // Extract from account.mines (raw mines)
  if (account?.mines) {
    account.mines.forEach((m: any) => {
      const symbol = (m.definition?.id || m.id || '').toUpperCase();
      classifyAndPush(symbol, m.level, m.id);
    });
  }

  // Extract from account.landPlots
  if (account?.landPlots) {
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

  // Extract from account.factoryInventory
  if (account?.factoryInventory) {
    account.factoryInventory.forEach((f: any) => {
      const symbol = (f.definitionId || f.id || '').toUpperCase();
      classifyAndPush(symbol, f.level, f.id);
    });
  }

  // 3. Extract resources from account.resources
  let resources: PlayerResource[] = [];
  if (account?.resources) {
    resources = account.resources.map((r: any) => ({
      symbol: r.symbol,
      amount: r.amount
    }));
  }

  // 4. Fetch Masterpieces to get the nested resourcesByUserId (merge if not already present)
  if (resolvedUserId) {
    const masterpiecesQuery = `
      query GetMasterpieces($userId: String!) {
        masterpieces(userId: $userId) {
          resourcesByUserId(userId: $userId) {
            symbol
            amount
          }
          dailyPowerContributionsByUserId(userId: $userId) {
            symbol
            amount
          }
        }
      }
    `;
    const mpResult = await tryQuery('masterpieces (JWT)', masterpiecesQuery, { userId: resolvedUserId }, jwtToken);
    allResults.push(mpResult);
    if (mpResult.data?.masterpieces) {
      allRawData.masterpieces = mpResult.data.masterpieces;
      const mpData = mpResult.data.masterpieces;
      const masterpiecesResList: PlayerResource[] = [];
      if (Array.isArray(mpData)) {
        const allRes: Record<string, number> = {};
        mpData.forEach(mp => {
          if (mp.resourcesByUserId) {
            mp.resourcesByUserId.forEach((r: any) => {
              allRes[r.symbol] = (allRes[r.symbol] || 0) + r.amount;
            });
          }
        });
        Object.entries(allRes).forEach(([symbol, amount]) => {
          masterpiecesResList.push({ symbol, amount });
        });
      } else if (mpData?.resourcesByUserId) {
        masterpiecesResList.push(...mpData.resourcesByUserId);
      }

      // Merge masterpieces resources
      masterpiecesResList.forEach(mpr => {
        const existing = resources.find(r => r.symbol === mpr.symbol);
        if (!existing) {
          resources.push(mpr);
        }
      });
    }
  }

  // ─── Log results ───
  console.group('🎮 Authenticated API Results');
  allResults.forEach(r => {
    if (r.data) {
      const keys = Object.keys(r.data);
      console.log(`✅ ${r.label}:`, keys.map(k =>
        `${k}: ${Array.isArray(r.data[k]) ? r.data[k].length + ' items' : JSON.stringify(r.data[k]).slice(0, 80)}`
      ).join(' | '));
    } else {
      console.log(`❌ ${r.label}: ${r.error}`);
    }
  });
  console.groupEnd();

  // Extraer nivel de taller global y estrellas por recurso
  let workshopLevel = 0;
  if (account?.fullPlayerBase?.buildings) {
    const ws = account.fullPlayerBase.buildings.find((b: any) => b.type === 'WORKSHOP');
    if (ws) {
      workshopLevel = ws.level;
    }
  }

  const proficiencies = account?.proficiencies || [];
  const workshop = account?.workshop || [];

  return {
    id: resolvedUserId || '',
    walletAddress: account?.walletAddress || '',
    displayName: account?.profile?.displayName || `Player ${resolvedUserId || ''}`,
    level: account?.profile?.level || 0,
    mines: extractedMines,
    factories: extractedFactories,
    powerPlants: extractedPowerPlants,
    batteries: extractedBatteries,
    resources,
    workshopLevel,
    proficiencies,
    workshop,
    allRawData,
    rawAccountData: account,
    rawFactoriesData: extractedFactories,
  };
}

/**
 * Fetches all available player data using public queries (profileByUID and masterpieces).
 * No JWT authentication required.
 */
export async function fetchPlayerAccount(userId: string): Promise<PlayerAccountInfo> {
  const allResults: QueryAttempt[] = [];
  const allRawData: Record<string, any> = {};

  // 1. Fetch profile using profileByUID
  const profileQuery = `
    query GetProfileByUID($uid: ID!) {
      profileByUID(uid: $uid) {
        uid
        walletAddress
        avatarUrl
        displayName
        level
      }
    }
  `;
  const profileResult = await tryQuery('profileByUID', profileQuery, { uid: userId });
  allResults.push(profileResult);
  if (profileResult.error) {
    throw new Error(`Error de perfil: ${profileResult.error}`);
  }
  const profile = profileResult.data?.profileByUID;
  if (!profile) {
    throw new Error('No se encontró ningún perfil para el User ID especificado.');
  }
  allRawData.profileByUID = profile;

  // 2. Fetch masterpieces for resources
  let resources: PlayerResource[] | undefined = undefined;
  const masterpiecesQuery = `
    query GetMasterpieces($userId: String!) {
      masterpieces(userId: $userId) {
        resourcesByUserId(userId: $userId) {
          symbol
          amount
        }
      }
    }
  `;
  const mpResult = await tryQuery('masterpieces', masterpiecesQuery, { userId });
  allResults.push(mpResult);
  if (mpResult.data?.masterpieces) {
    allRawData.masterpieces = mpResult.data.masterpieces;
    const mpData = mpResult.data.masterpieces;
    if (Array.isArray(mpData)) {
      const allRes: Record<string, number> = {};
      mpData.forEach(mp => {
        if (mp.resourcesByUserId) {
          mp.resourcesByUserId.forEach((r: any) => {
            allRes[r.symbol] = (allRes[r.symbol] || 0) + r.amount;
          });
        }
      });
      resources = Object.entries(allRes).map(([symbol, amount]) => ({ symbol, amount }));
    } else if (mpData?.resourcesByUserId) {
      resources = mpData.resourcesByUserId;
    }
  }

  // ─── Log all results ───
  console.group('🎮 Craft World API - Public Query Results');
  allResults.forEach(r => {
    if (r.data) {
      const keys = Object.keys(r.data);
      console.log(`✅ ${r.label}:`, keys.map(k => `${k}: ${Array.isArray(r.data[k]) ? r.data[k].length + ' items' : JSON.stringify(r.data[k]).slice(0, 80)}`).join(' | '));
    } else {
      console.log(`❌ ${r.label}: ${r.error}`);
    }
  });
  console.groupEnd();

  return {
    id: userId,
    walletAddress: profile?.walletAddress || '',
    displayName: profile?.displayName || `Player ${userId}`,
    level: profile?.level || 0,
    mines: [],
    factories: [],
    powerPlants: [],
    batteries: [],
    resources,
    allRawData,
  };
}
