/**
 * priceService.ts — Real-time price service for Craft World dashboard
 * 
 * Source priority:
 *   1. Official Game API (craft-world.gg/graphql) — THE source of truth
 *   2. On-chain RPC + DefiLlama — fallback for COIN/USD rate
 * 
 * Price Model (VOYA Exchange):
 *   The Game API returns the MID/SPOT price for each token.
 *   The VOYA exchange applies a 2.5% fee on every swap.
 *   
 *   - BUY price  = mid / (1 - 0.025)  → what you PAY to acquire 1 unit
 *   - SELL price = mid * (1 - 0.025)  → what you RECEIVE when selling 1 unit
 *   
 *   Additionally, there is a variable Price Impact (slippage) that depends
 *   on trade size and pool liquidity (typically 0.1%-0.5% for normal trades).
 */

import { FACTORIES_DATA } from '../assets/data/factories';
import { fetchBalancesFromOnChain } from './roninWeb3Service';
import { apiUrl } from './api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PriceData {
  mid: number;           // base spot price from the API
  buy: number;           // price in COIN (market price)
  sell: number;          // sell estimate
  usdMid: number;        // base price in USD
  usdBuy: number;        // price in USD
  usdSell: number;       // price in USD
  recommendation?: 'BUY' | 'SELL' | 'HOLD';  // from game API
}

export type TokenPrices = Record<string, PriceData>;

export interface PriceResult {
  coinPriceUsd: number;
  prices: TokenPrices;
  prices1h: Record<string, number>;
  prices24h: Record<string, number>;
  source: 'game-api' | 'rawrtools' | 'onchain' | 'fallback';
  timestamp: number;
  stale: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GAME_API_URL = '/api/game';
const RONIN_RPC_URL = '/api/ronin-rpc';
const DEFILLAMA_WRON_URL = 'https://coins.llama.fi/prices/current/ronin:0xe514d9deb7966c8be0ca922de8a064264ea6bcd4';
const WRON_COIN_POOL = '0x792fba368852af644cd14320f5a0992bb476aeb9';

/**
 * Effective buy and sell fees/spreads in the VOYA exchange.
 * Due to the asymmetry of AMM swaps (price impact increases the buy price 
 * and decreases the sell price), we model the total effective buy/sell rates 
 * independently to match real game UI behavior.
 * 
 * Empirically matching actual in-game trades:
 *   - BUY: ~4.5% effective cost (mid / (1 - 0.045))
 *   - SELL: ~3.9% effective cost (mid * (1 - 0.039))
 * 
 * This resolves the discrepancy where the sell price was underestimated.
 */
const VOYA_BUY_FEE = 0.045;
const VOYA_SELL_FEE = 0.039;

// ─── Token Addresses (for on-chain fallback) ─────────────────────────────────

export const TOKENS: Record<string, string> = {
  COIN: "0x7dc167e270d5ef683ceaf4afcdf2efbdd667a9a7",
  EARTH: "0xC89384CD2970C916DC75DA8E11524EBE6D77FA07",
  WATER: "0x57A8EB80D6813AEEEB9C8E770011C016F980D581",
  FIRE: "0x0E8EDC6F5CAC5DCAE036AD77FC0DE4E72404E2FB",
  MUD: "0x1CC30B8FC5D4480B1740B1676E3636FB1270c524",
  CLAY: "0xA1AF0DFA0884C7433F82BBA89CB36E5B7B90A5C1",
  SAND: "0xAC861E0D31080E3B491747A968DF567F81BC8605",
  COPPER: "0x64AC88024E1BCC49E3EE145C165914F58998EC9B",
  SEAWATER: "0x84A162DFA5D818151BD8C8E804DAE8CD96A0E15D",
  ALGAE: "0x9ACDDDE6564924042E8ACFD5BD137374AF9DFAE5",
  CERAMICS: "0x581E54C7A521519E98D256D39852E4C214CAD697",
  OXYGEN: "0xCF2BD4CDDCE432090D6A9725BEC7A6AED77B41F0",
  STONE: "0xE7AD0FD3C832769437CC1240BFFE5DFF94FC9CF1",
  HEAT: "0x415363B5C4600AA776B6C39FED866DEE15179AB8",
  LAVA: "0x78EB25B148995A4EE373E65E93474EF0ED0FCC9A",
  GAS: "0x91720484FC3569AF94D5049835048C83A1D32FA2",
  CEMENT: "0x04A581CF47CCC244A5AB715C7A105D63BBCB57CA",
  GLASS: "0xF7604075A0ED6B4F6537BA2BAB19F1F44F5E7AA4",
  STEAM: "0x5F146DFF3B6A3E89188A3953D621637452BA4407",
  STEEL: "0x798239FEE069E2B5B3C58978AEA92A3D0E16950C",
  FUEL: "0x677203F3FCC63FE85A5ABC8E6479A88DEB86717B",
  ACID: "0xCD0C9F170E395CA1ADC16AE9AE8107D50273E2E8",
  SULFUR: "0x85120A3D815E95FB8D68129593084BF97905F543",
  ENERGY: "0xA3F0F293AEE7CE8B4A3807BF9CC07942DA4E51E8",
  SCREWS: "0xCC34D8E6A6F61358219D8E8A967ED7F191638449",
  OIL: "0x27908A7052980B7537BCB72757CD59B57D5FAE0B",
  PLASTICS: "0x8EABB6A3A05AF9FB514482A677B12008A2ED6422",
  FIBERGLASS: "0xAB6B550C661862E637249D55207125EE6AFE0AAA",
  HYDROGEN: "0xB7D11863D0D9C39764F981A95AB8AF0AED714C48",
  DYNAMITE: "0x2918938CFDE254CC76B68A4F6992927EE779104A",
  BOLTS: "0x6A15Fb9E1e37d65AE4b969D57D0B1820bbb64066",
  KEY: "0xd3f23035Da2273E71B3c04bB7bD8619fFf7fFfFA",
  CERAMICKEY: "0x7c93df1284A1e63D234e06f120C83f59384288F1",
  GLASSKEY: "0x31ee5DcC97a99C74F43cBc4441528FC4A0eFc7b9",
  DYNOKEY: "0x5991A7516a77796B258A15FBC7004D6BBABbD187",
  WRON: "0xe514d9deb7966c8be0ca922de8a064264ea6bcd4"
};

// ─── GraphQL Query ───────────────────────────────────────────────────────────

const EXCHANGE_PRICE_QUERY = `
  query {
    exchangePriceList {
      baseSymbol
      prices {
        referenceSymbol
        amount
        recommendation
      }
    }
  }
`;

// ─── 1. Primary: Official Game API ───────────────────────────────────────────

interface GameApiPrice {
  referenceSymbol: string;
  amount: number;
  recommendation: 'BUY' | 'SELL' | 'HOLD';
}

interface GameApiResponse {
  data: {
    exchangePriceList: {
      baseSymbol: string;
      prices: GameApiPrice[];
    };
  };
}

async function fetchFromGameApi(): Promise<{ prices: TokenPrices; source: 'game-api' }> {
  const res = await fetch(apiUrl(GAME_API_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query: EXCHANGE_PRICE_QUERY,
      variables: null,
    }),
  });

  if (!res.ok) {
    throw new Error(`Game API returned ${res.status}: ${res.statusText}`);
  }

  const data: GameApiResponse = await res.json();
  const priceList = data?.data?.exchangePriceList?.prices;

  if (!priceList || priceList.length === 0) {
    throw new Error('Game API returned empty price list');
  }

  const tokenPrices: TokenPrices = {};

  // COIN is always 1.0
  tokenPrices['COIN'] = {
    mid: 1.0,
    buy: 1.0,
    sell: 1.0,
    usdMid: 0,
    usdBuy: 0,
    usdSell: 0,
    recommendation: 'HOLD',
  };

  for (const item of priceList) {
    const symbol = item.referenceSymbol;
    const mid = item.amount; // spot/mid price from the API
    const buy = mid / (1 - VOYA_BUY_FEE);   // what you PAY to buy (higher than mid)
    const sell = mid * (1 - VOYA_SELL_FEE);   // what you GET when selling (lower than mid)

    tokenPrices[symbol] = {
      mid,
      buy,
      sell,
      usdMid: 0,
      usdBuy: 0,
      usdSell: 0,
      recommendation: item.recommendation,
    };
  }

  return { prices: tokenPrices, source: 'game-api' };
}

// ─── 2. Secondary: On-Chain RPC + DefiLlama (for COIN/USD rate) ──────────────

async function fetchCoinUsdFromChain(): Promise<number> {
  let wronPriceUsd = 0.058; // default/fallback WRON price
  let poolRatio = 0.00296; // default/fallback WRON/COIN ratio

  const fetchWronPrice = async () => {
    try {
      const res = await fetch(DEFILLAMA_WRON_URL);
      if (res.ok) {
        const data = await res.json();
        const price = data.coins?.['ronin:0xe514d9deb7966c8be0ca922de8a064264ea6bcd4']?.price;
        if (price && typeof price === 'number') {
          wronPriceUsd = price;
        }
      }
    } catch (err) {
      console.warn('⚠️ Failed to fetch WRON price from DefiLlama:', err);
    }
  };

  const fetchReserves = async () => {
    try {
      const payload = {
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: WRON_COIN_POOL,
            data: '0x0902f1ac', // getReserves()
          },
          'latest',
        ],
        id: 1,
      };

      const res = await fetch(apiUrl(RONIN_RPC_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const json = await res.json();
        const hex = json.result?.replace('0x', '');
        if (hex && hex.length >= 128) {
          const r0Hex = hex.substring(0, 64);
          const r1Hex = hex.substring(64, 128);

          const reserve0 = BigInt('0x' + r0Hex); // COIN (since 0x7dc... < 0xe51...)
          const reserve1 = BigInt('0x' + r1Hex); // WRON

          if (reserve0 > 0n && reserve1 > 0n) {
            const scaledRatio = (reserve1 * 100000000n) / reserve0;
            poolRatio = Number(scaledRatio) / 100000000;
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ Failed to query Katana pool reserves:', err);
    }
  };

  // Run both fetch operations in parallel
  await Promise.all([fetchWronPrice(), fetchReserves()]);

  const coinUsdPrice = wronPriceUsd * poolRatio;
  return coinUsdPrice > 0 ? coinUsdPrice : 0.000175;
}

// ─── Recipe-based price resolution ───────────────────────────────────────────

function resolveRecipePrice(
  symbol: string,
  tokenPrices: TokenPrices,
  coinPriceUsd: number,
  visited: Set<string>
): PriceData {
  if (tokenPrices[symbol]) return tokenPrices[symbol];
  if (visited.has(symbol)) return { mid: 0, buy: 0, sell: 0, usdMid: 0, usdBuy: 0, usdSell: 0 };
  visited.add(symbol);

  const recipeLevels = FACTORIES_DATA[symbol];
  const recipe = recipeLevels?.[0];

  if (!recipe) {
    const fb: PriceData = { mid: 1, buy: 1, sell: 0.97, usdMid: coinPriceUsd, usdBuy: coinPriceUsd, usdSell: 0.97 * coinPriceUsd };
    tokenPrices[symbol] = fb;
    return fb;
  }

  let buyCost = 0;
  if (recipe.input1 && recipe.input1_amt > 0) {
    const inp = tokenPrices[recipe.input1] || resolveRecipePrice(recipe.input1, tokenPrices, coinPriceUsd, visited);
    buyCost += inp.buy * recipe.input1_amt;
  }
  if (recipe.input2 && recipe.input2_amt > 0) {
    const inp = tokenPrices[recipe.input2] || resolveRecipePrice(recipe.input2, tokenPrices, coinPriceUsd, visited);
    buyCost += inp.buy * recipe.input2_amt;
  }

  const yieldAmt = recipe.output || 1;
  let mid = buyCost / yieldAmt;
  if (!isFinite(mid) || isNaN(mid) || mid <= 0) mid = 1;

  const buy = mid / (1 - VOYA_BUY_FEE);   // what you'd pay to buy
  const sell = mid * (1 - VOYA_SELL_FEE);   // what you'd receive selling
  const result: PriceData = { mid, buy, sell, usdMid: mid * coinPriceUsd, usdBuy: buy * coinPriceUsd, usdSell: sell * coinPriceUsd };
  tokenPrices[symbol] = result;
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchAllPrices(): Promise<PriceResult> {
  let tokenPrices: TokenPrices = {};
  let source: PriceResult['source'] = 'fallback';
  let coinPriceUsd = 0;
  let timestamp = Date.now();

  // ── Step 1: Get prices from Game API (primary) ──
  try {
    const gameData = await fetchFromGameApi();
    tokenPrices = gameData.prices;
    source = 'game-api';
    console.log(`✅ Prices from Game API (${Object.keys(tokenPrices).length} tokens)`);
  } catch (err) {
    console.warn('⚠️ Game API failed:', err);
  }

  // ── Step 2: Get COIN/USD price from on-chain RPC + DefiLlama ──
  try {
    coinPriceUsd = await fetchCoinUsdFromChain();
  } catch (err) {
    console.warn('⚠️ On-chain COIN/USD fetch failed:', err);
    coinPriceUsd = 0.000175; // static fallback
  }

  // ── Step 3: Fill in USD values for all prices ──
  for (const price of Object.values(tokenPrices)) {
    price.usdMid = price.mid * coinPriceUsd;
    price.usdBuy = price.buy * coinPriceUsd;
    price.usdSell = price.sell * coinPriceUsd;
  }

  // ── Step 4: Resolve any factory tokens not yet priced ──
  const allFactoryNames = Object.keys(FACTORIES_DATA);
  for (const name of allFactoryNames) {
    if (!tokenPrices[name]) {
      resolveRecipePrice(name, tokenPrices, coinPriceUsd, new Set());
    }
  }

  console.log(`💰 COIN = $${coinPriceUsd.toFixed(6)} | Source: ${source} | Tokens: ${Object.keys(tokenPrices).length}`);

  return {
    coinPriceUsd,
    prices: tokenPrices,
    prices1h: {},
    prices24h: {},
    source,
    timestamp,
    stale: source === 'fallback',
  };
}

export async function fetchTokenBalances(walletAddress: string): Promise<Record<string, number>> {
  try {
    return await fetchBalancesFromOnChain(walletAddress);
  } catch (err) {
    console.warn('⚠️ Multicall token balance fetch failed, falling back to sequential fetch:', err);
    const tokenSymbols = Object.keys(TOKENS);
    const cleanWallet = walletAddress.replace('0x', '').toLowerCase().padStart(64, '0');
    const data = '0x70a08231' + cleanWallet;

    const fetchSingle = async (symbol: string): Promise<[string, number]> => {
      try {
        const res = await fetch(apiUrl(RONIN_RPC_URL), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [
              {
                to: TOKENS[symbol],
                data: data,
              },
              'latest',
            ],
            id: 1,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          const hex = json.result?.replace('0x', '');
          if (hex && hex !== '0x' && hex !== '') {
            const balanceWei = BigInt('0x' + hex);
            return [symbol, Number(balanceWei) / 1e18];
          }
        }
      } catch (e) {
        console.warn(`⚠️ Failed to fetch balance for ${symbol}:`, e);
      }
      return [symbol, 0];
    };

    const results = await Promise.all(tokenSymbols.map((sym) => fetchSingle(sym)));
    return Object.fromEntries(results);
  }
}

