import React, { useState, useEffect, useRef } from 'react';
import { FACTORIES_DATA } from './assets/data/factories';
import type { LevelData } from './types/game';
import { BentoGrid } from './components/BentoGrid/BentoGrid';
import { FactoryDetails } from './components/FactoryDetails/FactoryDetails';
import { LevelSlider } from './components/LevelSlider/LevelSlider';
import { Calculator } from './components/Calculator/Calculator';
import { ProgressionChart } from './components/ProgressionChart/ProgressionChart';
import { RelationsExplorer } from './components/RelationsExplorer/RelationsExplorer';
import { ResourceTable } from './components/ResourceTable/ResourceTable';
import { CoinCalculatorModal } from './components/CoinCalculatorModal/CoinCalculatorModal';
import { BonusPanel } from './components/BonusPanel/BonusPanel';
import { PowerCalculator } from './components/PowerCalculator/PowerCalculator';
import { MasterpieceSimulator } from './components/MasterpieceSimulator/MasterpieceSimulator';
import anime from 'animejs';
import { useRealTimePrices } from './hooks/useRealTimePrices';
import { usePlayerConfig, ResourceConfig } from './hooks/usePlayerConfig';
import { usePriceHistory } from './hooks/usePriceHistory';
import { AccountConnector } from './components/AccountConnector/AccountConnector';
import { ResourceSelectorDropdown } from './components/ResourceSelectorDropdown/ResourceSelectorDropdown';
import { fetchTokenBalances } from './utils/priceService';
import { fetchPlayerAccount, fetchPlayerAccountWithJWT, type PlayerAccountInfo, type PlayerMine } from './utils/accountService';
import { authenticateWithRonin, clearAuth, validateJWT, getValidToken } from './utils/roninAuth';
import { resolveRNS, fetchFactoriesFromOnChain, fetchBalancesFromOnChain } from './utils/roninWeb3Service';
import { fetchFullPlayerData } from './utils/craftWorldService';
import { ethers } from 'ethers';

import './styles/global.css';
import { getCategory, getEmoji } from './utils/gameHelpers';

interface PriceCountdownProps {
  lastUpdate: number;
  intervalMs?: number;
}

const PriceCountdown: React.FC<PriceCountdownProps> = ({ lastUpdate, intervalMs = 30000 }) => {
  const [sec, setSec] = useState(Math.round(intervalMs / 1000));

  useEffect(() => {
    setSec(Math.round(intervalMs / 1000));
  }, [lastUpdate, intervalMs]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return <span>({sec}s)</span>;
};

export const App: React.FC = () => {
  const { prices, coinPriceUsd, source, stale, loading: pricesLoading, lastUpdate } = useRealTimePrices();
  const playerConfig = usePlayerConfig();
  const priceDeltas = usePriceHistory(prices);
  
  const [activeTab, setActiveTab] = useState<'explorer' | 'production' | 'relations' | 'resources' | 'masterpiece'>(() => {
    return (localStorage.getItem('cw-active-tab') as any) || 'explorer';
  });

  const [activeFactory, setActiveFactory] = useState(() => {
    return localStorage.getItem('cw-active-factory') || 'MUD';
  });
  const [currentLevel, setCurrentLevel] = useState<number>(() => {
    try {
      const active = localStorage.getItem('cw-active-factory') || 'MUD';
      const configRaw = localStorage.getItem('cw-player-config');
      if (configRaw) {
        const config = JSON.parse(configRaw);
        if (config[active]?.level) {
          return config[active].level;
        }
      }
    } catch (e) {
      console.warn('Failed to load level from player config:', e);
    }
    const saved = localStorage.getItem('cw-current-level');
    return saved ? parseInt(saved) : 1;
  });
  const [targetProduction, setTargetProduction] = useState<number>(() => {
    const saved = localStorage.getItem('cw-target-production');
    return saved ? parseInt(saved) : 10000;
  });
  const [showCoinCalc, setShowCoinCalc] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Account Connection States
  const [walletAddress, setWalletAddress] = useState(() => localStorage.getItem('cw-wallet-address') || '');
  const [userId, setUserId] = useState(() => localStorage.getItem('cw-user-id') || '');
  const [jwtToken, setJwtToken] = useState<string | null>(() => {
    const saved = localStorage.getItem('cw-auth-token');
    return saved || null;
  });
  const [roninAddress, setRoninAddress] = useState<string | null>(() => {
    const saved = localStorage.getItem('cw-auth-address');
    return saved || null;
  });
  const [accountInfo, setAccountInfo] = useState<PlayerAccountInfo | null>(() => {
    const saved = localStorage.getItem('cw-account-info');
    return saved ? JSON.parse(saved) : null;
  });
  const [balances, setBalances] = useState<Record<string, number> | null>(() => {
    const saved = localStorage.getItem('cw-token-balances');
    return saved ? JSON.parse(saved) : null;
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [refreshToken, setRefreshToken] = useState<string | null>(() => {
    return localStorage.getItem('cw-refresh-token') || null;
  });
  const [lastAutoRefresh, setLastAutoRefresh] = useState<number>(0);
  const [autoRefreshCountdown, setAutoRefreshCountdown] = useState(30);
  const autoRefreshRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false); // Ref to avoid stale closure in interval

  const levelSourceRef = useRef<'config' | 'slider' | 'idle'>('idle');
  const accountSyncedRef = useRef<string | null>(null);
  const isFirstMount = useRef(true);

  const handleSyncWalletAddress = async (address: string) => {
    setIsSyncing(true);
    try {
      const tokenBalances = await fetchTokenBalances(address);
      setWalletAddress(address);
      setBalances(tokenBalances);
      localStorage.setItem('cw-wallet-address', address);
      localStorage.setItem('cw-token-balances', JSON.stringify(tokenBalances));
    } catch (err) {
      console.error('Failed to sync wallet balances:', err);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  };



  const handleSyncUserId = async (id: string) => {
    setIsSyncing(true);
    try {
      const cleanId = id.trim().toLowerCase();
      const isWeb3 = cleanId.endsWith('.ronin') || cleanId.endsWith('.ron') || cleanId.startsWith('ronin:') || ethers.isAddress(cleanId);
      
      let info: PlayerAccountInfo;
      let tokenBalances: Record<string, number> | null = null;
      
      if (isWeb3) {
        let cleanAddress = cleanId;
        if (cleanAddress.startsWith('ronin:')) {
          cleanAddress = '0x' + cleanAddress.substring(6);
        }
        
        console.log(`Resolving on-chain RNS/Address for: ${cleanAddress}`);
        const resolvedAddress = await resolveRNS(cleanAddress);
        console.log(`Resolved address: ${resolvedAddress}`);
        
        let onChainFactories: any[] = [];
        let chainErrorOccurred = false;
        try {
          // Fetch data from blockchain
          onChainFactories = await fetchFactoriesFromOnChain(resolvedAddress);
          tokenBalances = await fetchBalancesFromOnChain(resolvedAddress);
        } catch (chainErr) {
          console.warn("On-chain fetch failed, falling back to game public API:", chainErr);
          chainErrorOccurred = true;
        }

        const activeOnChain = onChainFactories.filter(f => f.level > 0);

        if (activeOnChain.length === 0 || chainErrorOccurred) {
          try {
            console.log(`No active on-chain factories found. Querying game public API fallback for ID: ${id}`);
            const publicInfo = await fetchPlayerAccount(id);
            info = publicInfo;
            if (tokenBalances) {
              const onChainResources = Object.entries(tokenBalances)
                .filter(([_, amt]) => amt > 0)
                .map(([symbol, amount]) => ({ symbol, amount }));
              const merged = [...(info.resources || [])];
              onChainResources.forEach(ocr => {
                if (!merged.some(r => r.symbol === ocr.symbol)) {
                  merged.push(ocr);
                }
              });
              info.resources = merged;
            }
          } catch (apiErr) {
            console.error("Public API fallback also failed:", apiErr);
            if (tokenBalances) {
              info = {
                id: id,
                walletAddress: resolvedAddress,
                displayName: id.endsWith('.ronin') || id.endsWith('.ron') ? id : `${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)}`,
                level: 0,
                mines: [],
                factories: [],
                powerPlants: [],
                batteries: [],
                resources: Object.entries(tokenBalances)
                  .filter(([_, amt]) => amt > 0)
                  .map(([symbol, amount]) => ({ symbol, amount })),
                allRawData: { onChain: true, factories: [] },
              };
            } else {
              throw apiErr;
            }
          }
        } else {
          const parsedMines: PlayerMine[] = [];
          const parsedFactories: PlayerMine[] = [];
          
          onChainFactories.forEach(f => {
            if (f.level > 0) {
              const mineObj: PlayerMine = {
                id: f.symbol,
                level: f.level,
                definition: { id: f.symbol }
              };
              const rawResources = ["EARTH", "WATER", "FIRE", "DYNOFISH", "MAGICSHARD", "BURNTRICE", "WOOD", "STONE", "COAL", "IRON", "GOLD"];
              if (rawResources.includes(f.symbol)) {
                parsedMines.push(mineObj);
              } else {
                parsedFactories.push(mineObj);
              }
            }
          });
          
          info = {
            id: id,
            walletAddress: resolvedAddress,
            displayName: id.endsWith('.ronin') || id.endsWith('.ron') ? id : `${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)}`,
            level: 0,
            mines: parsedMines,
            factories: parsedFactories,
            powerPlants: [],
            batteries: [],
            resources: Object.entries(tokenBalances || {})
              .filter(([_, amt]) => amt > 0)
              .map(([symbol, amount]) => ({ symbol, amount })),
            allRawData: { onChain: true, factories: onChainFactories },
            rawAccountData: { walletAddress: resolvedAddress },
            rawFactoriesData: parsedFactories,
          };
        }
      } else {
        if (jwtToken) {
          info = await fetchPlayerAccountWithJWT(jwtToken, id);
        } else {
          info = await fetchPlayerAccount(id);
        }
      }
      
      setUserId(id);
      setAccountInfo(info);
      if (isWeb3 && tokenBalances) {
        setBalances(tokenBalances);
        const resolvedAddress = info.walletAddress;
        setWalletAddress(resolvedAddress);
        localStorage.setItem('cw-wallet-address', resolvedAddress);
        localStorage.setItem('cw-token-balances', JSON.stringify(tokenBalances));
      }
      
      localStorage.setItem('cw-user-id', id);
      localStorage.setItem('cw-account-info', JSON.stringify(info));

      if (!isWeb3) {
        const connectedWallet = info.walletAddress || roninAddress || walletAddress;
        if (connectedWallet && !balances) {
          handleSyncWalletAddress(connectedWallet).catch(() => {});
        }
      }

      const allBuildings: PlayerMine[] = [
        ...(info.mines || []),
        ...(info.factories || []),
        ...(info.powerPlants || []),
        ...(info.batteries || []),
      ];

      const activeAgg = allBuildings.filter((m: PlayerMine) => (m.definition?.id || m.id || '').toUpperCase() === activeFactory);
      if (activeAgg.length > 0) {
        const maxLvl = Math.max(...activeAgg.map(m => Math.max(1, m.level)));
        if (maxLvl > 0) {
          levelSourceRef.current = 'config';
          setCurrentLevel(maxLvl);
        }
      }
    } catch (err) {
      console.error('Failed to sync player account:', err);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  };

  // Auto-sync on mount: prefer full CraftWorld query if JWT exists, fallback to userId
  useEffect(() => {
    const doInitialSync = async () => {
      const savedToken = await getValidToken();
      if (savedToken) {
        console.log('🚀 Auto-syncing with CraftWorld full query on mount...');
        try {
          const info = await fetchFullPlayerData(savedToken);
          setJwtToken(savedToken);
          setAccountInfo(info);
          setUserId(info.id || '');
          setWalletAddress(info.walletAddress || '');
          localStorage.setItem('cw-account-info', JSON.stringify(info));
          if (info.id) localStorage.setItem('cw-user-id', info.id);
          if (info.walletAddress) localStorage.setItem('cw-wallet-address', info.walletAddress);
          setLastAutoRefresh(Date.now());
          console.log('✅ Mount sync with full query succeeded');
          return;
        } catch (err) {
          console.warn('⚠️ Full query mount sync failed, trying userId fallback:', err);
        }
      }
      // Fallback: use saved userId
      const savedUserId = localStorage.getItem('cw-user-id');
      if (savedUserId) {
        console.log('🔄 Auto-syncing saved user ID on mount:', savedUserId);
        handleSyncUserId(savedUserId).catch((err) => {
          console.warn('⚠️ Auto-sync on mount failed:', err);
        });
      }
    };
    doInitialSync();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 30-second Auto-Refresh ───
  useEffect(() => {
    // Keep the ref in sync so the interval callback sees fresh values
    isSyncingRef.current = isSyncing;
  }, [isSyncing]);

  useEffect(() => {
    // Clear existing intervals
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    // Only auto-refresh if we have a JWT token
    const hasToken = !!jwtToken || !!localStorage.getItem('cw-auth-token');
    if (!hasToken || !accountInfo) {
      return;
    }

    // Countdown ticker (every second)
    setAutoRefreshCountdown(30);
    countdownRef.current = setInterval(() => {
      setAutoRefreshCountdown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    // Main refresh every 30 seconds
    autoRefreshRef.current = setInterval(async () => {
      if (isSyncingRef.current) {
        console.log('⏳ Skipping auto-refresh: already syncing');
        return;
      }

      try {
        const validToken = await getValidToken();
        if (!validToken) {
          console.warn('⚠️ Auto-refresh: no valid token available');
          return;
        }

        console.log('🔄 Auto-refresh: fetching latest CraftWorld data...');
        const info = await fetchFullPlayerData(validToken);

        setAccountInfo(info);
        setJwtToken(validToken);
        setLastAutoRefresh(Date.now());
        setAutoRefreshCountdown(30);
        localStorage.setItem('cw-account-info', JSON.stringify(info));
        console.log('✅ Auto-refresh completed successfully');
      } catch (err) {
        console.warn('⚠️ Auto-refresh failed:', err);
      }
    }, 30000);

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jwtToken, accountInfo !== null]);

  // Sync playerConfig levels, mastery, workshop, workers, and boosters from accountInfo
  useEffect(() => {
    const allBuildings = [
      ...(accountInfo?.mines || []),
      ...(accountInfo?.factories || []),
      ...(accountInfo?.powerPlants || []),
      ...(accountInfo?.batteries || []),
    ];
    if (allBuildings.length === 0) return;

    // Build a map: areaUuid → resource symbol from landPlots raw data
    const areaToSymbol: Record<string, string> = {};
    const rawAccount = accountInfo?.rawAccountData || accountInfo?.allRawData?.account;
    if (rawAccount?.landPlots) {
      rawAccount.landPlots.forEach((plot: any) => {
        if (plot.areas) {
          plot.areas.forEach((area: any) => {
            areaToSymbol[area.id] = (area.symbol || '').toUpperCase();
          });
        }
      });
    }

    // Extract worker speed bonuses per resource
    // Each worker has areaBoostValue and areaUuid → maps to area → resource symbol
    const workerBoostPerResource: Record<string, number> = {};
    if (accountInfo?.workers && rawAccount?.landPlots) {
      accountInfo.workers.forEach((worker: any) => {
        if (worker.areaUuid && worker.areaBoostValue > 0) {
          const resourceSymbol = areaToSymbol[worker.areaUuid];
          if (resourceSymbol) {
            workerBoostPerResource[resourceSymbol] = (workerBoostPerResource[resourceSymbol] || 0) + worker.areaBoostValue;
          }
        }
      });
    }

    // Also check for active workerBoostIntervals in factories
    if (rawAccount?.landPlots) {
      rawAccount.landPlots.forEach((plot: any) => {
        if (plot.areas) {
          plot.areas.forEach((area: any) => {
            const resSymbol = (area.symbol || '').toUpperCase();
            if (area.factories) {
              area.factories.forEach((f: any) => {
                if (f.workerBoostIntervals) {
                  const now = Date.now();
                  f.workerBoostIntervals.forEach((wbi: any) => {
                    const start = new Date(wbi.startTime).getTime();
                    const end = new Date(wbi.endTime).getTime();
                    if (now >= start && now <= end && wbi.boostValue > 0) {
                      workerBoostPerResource[resSymbol] = (workerBoostPerResource[resSymbol] || 0) + wbi.boostValue;
                    }
                  });
                }
              });
            }
          });
        }
      });
    }

    // Extract active factory boosters per resource
    const boosterPerResource: Record<string, number> = {};
    if (rawAccount?.landPlots) {
      rawAccount.landPlots.forEach((plot: any) => {
        if (plot.areas) {
          plot.areas.forEach((area: any) => {
            const resSymbol = (area.symbol || '').toUpperCase();
            if (area.factories) {
              area.factories.forEach((f: any) => {
                const now = Date.now();
                const checkBoosters = (boosters: any[]) => {
                  if (!boosters) return;
                  boosters.forEach((b: any) => {
                    const start = new Date(b.startTime).getTime();
                    const end = new Date(b.endTime).getTime();
                    if (now >= start && now <= end && b.boostValue > 1) {
                      const current = boosterPerResource[resSymbol] || 1;
                      if (b.boostValue > current) {
                        boosterPerResource[resSymbol] = b.boostValue;
                      }
                    }
                  });
                };
                checkBoosters(f.boosters);
                checkBoosters(f.consumableBoosters);
              });
            }
          });
        }
      });
    }

    // Calculate a comprehensive fingerprint
    const profFingerprint = accountInfo?.proficiencies
      ? accountInfo.proficiencies.map(p => `${p.symbol}:${p.claimedLevel}`).join(',')
      : '';
    const wsFingerprint = accountInfo?.workshop
      ? accountInfo.workshop.map(w => `${w.symbol}:${w.level}`).join(',')
      : '';
    const wkFingerprint = Object.entries(workerBoostPerResource).map(([k, v]) => `${k}:${v}`).join(',');
    const boostFingerprint = Object.entries(boosterPerResource).map(([k, v]) => `${k}:${v}`).join(',');
    const buildingsFingerprint = allBuildings.map(m => `${m.definition?.id || m.id}:${m.level}`).join(',');
    const fingerprint = `${buildingsFingerprint}|ws:${wsFingerprint}|prof:${profFingerprint}|wk:${wkFingerprint}|boost:${boostFingerprint}`;

    if (accountSyncedRef.current === fingerprint) return;
    accountSyncedRef.current = fingerprint;

    const aggregated: Record<string, { count: number; maxLevel: number }> = {};
    allBuildings.forEach((mine) => {
      const symbol = (mine.definition?.id || mine.id || '').toUpperCase();
      if (FACTORIES_DATA[symbol]) {
        const level = Math.max(1, mine.level);
        if (!aggregated[symbol]) {
          aggregated[symbol] = { count: 0, maxLevel: 0 };
        }
        aggregated[symbol].count += 1;
        if (level > aggregated[symbol].maxLevel) {
          aggregated[symbol].maxLevel = level;
        }
      }
    });

    const updates: Record<string, Partial<ResourceConfig>> = {};
    Object.keys(FACTORIES_DATA).forEach((symbol) => {
      const currentCfg = playerConfig.getConfig(symbol);
      
      // Mastery from proficiencies
      let masteryVal = 0;
      if (accountInfo?.proficiencies) {
        const prof = accountInfo.proficiencies.find(p => p.symbol.toUpperCase() === symbol);
        if (prof) {
          masteryVal = prof.claimedLevel;
        }
      }
      
      // Workshop level → speed % (each level = 9%)
      let wsLevel = 0;
      if (accountInfo?.workshop) {
        const ws = accountInfo.workshop.find(w => w.symbol.toUpperCase() === symbol);
        if (ws) {
          wsLevel = ws.level * 9;
        }
      }

      // Worker speed bonus
      const workerVal = workerBoostPerResource[symbol] || 0;

      // Active factory booster
      const boostVal = boosterPerResource[symbol] || 1;

      if (aggregated[symbol]) {
        if (
          currentCfg.factories !== aggregated[symbol].count ||
          currentCfg.level !== aggregated[symbol].maxLevel ||
          currentCfg.mastery !== masteryVal ||
          currentCfg.workshop !== wsLevel ||
          currentCfg.workers !== workerVal ||
          currentCfg.boost !== boostVal
        ) {
          updates[symbol] = {
            factories: aggregated[symbol].count,
            level: aggregated[symbol].maxLevel,
            mastery: masteryVal,
            workshop: wsLevel,
            workers: workerVal,
            boost: boostVal,
          };
        }
      } else {
        if (
          currentCfg.factories !== 0 ||
          currentCfg.level !== 1 ||
          currentCfg.mastery !== masteryVal ||
          currentCfg.workshop !== wsLevel ||
          currentCfg.workers !== workerVal ||
          currentCfg.boost !== boostVal
        ) {
          updates[symbol] = {
            factories: 0,
            level: 1,
            mastery: masteryVal,
            workshop: wsLevel,
            workers: workerVal,
            boost: boostVal,
          };
        }
      }
    });

    if (Object.keys(updates).length > 0) {
      playerConfig.updateBulkConfig(updates);
    }

    const activeAgg = aggregated[activeFactory];
    if (activeAgg && activeAgg.maxLevel > 0 && activeAgg.maxLevel !== currentLevel) {
      levelSourceRef.current = 'config';
      setCurrentLevel(activeAgg.maxLevel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountInfo]);

  const handleRoninAuth = async () => {
    setIsSyncing(true);
    try {
      const { address, jwtToken: token, refreshToken: rToken } = await authenticateWithRonin();
      setRoninAddress(address);
      setJwtToken(token);
      setRefreshToken(rToken);
      setWalletAddress(address);

      localStorage.setItem('cw_token', token);
      localStorage.setItem('cw-auth-token', token);
      localStorage.setItem('cw-auth-address', address);
      localStorage.setItem('cw-wallet-address', address);

      // PRIMARY: Use the complete AggregatedCraftWorldDataQuery
      let info: PlayerAccountInfo;
      let tokenBalances: Record<string, number> | null = null;
      try {
        console.log('🚀 Fetching complete CraftWorld data via AggregatedCraftWorldDataQuery...');
        info = await fetchFullPlayerData(token);

        // Also fetch on-chain balances for the wallet
        try {
          tokenBalances = await fetchBalancesFromOnChain(address);
        } catch (balErr) {
          console.warn('On-chain balance fetch failed:', balErr);
        }
      } catch (fullQueryErr) {
        console.warn('⚠️ Full CraftWorld query failed, falling back to on-chain + API:', fullQueryErr);

        // FALLBACK: on-chain factories + game API
        try {
          const onChainFactories = await fetchFactoriesFromOnChain(address);
          tokenBalances = await fetchBalancesFromOnChain(address);

          const parsedMines: PlayerMine[] = [];
          const parsedFactories: PlayerMine[] = [];

          onChainFactories.forEach(f => {
            if (f.level > 0) {
              const mineObj: PlayerMine = {
                id: f.symbol,
                level: f.level,
                definition: { id: f.symbol }
              };
              const rawResources = ["EARTH", "WATER", "FIRE", "DYNOFISH", "MAGICSHARD", "BURNTRICE", "WOOD", "STONE", "COAL", "IRON", "GOLD"];
              if (rawResources.includes(f.symbol)) {
                parsedMines.push(mineObj);
              } else {
                parsedFactories.push(mineObj);
              }
            }
          });

          info = {
            id: address,
            walletAddress: address,
            displayName: `${address.slice(0, 6)}...${address.slice(-4)}`,
            level: 0,
            mines: parsedMines,
            factories: parsedFactories,
            powerPlants: [],
            batteries: [],
            resources: Object.entries(tokenBalances)
              .filter(([_, amt]) => amt > 0)
              .map(([symbol, amount]) => ({ symbol, amount })),
            allRawData: { onChain: true, factories: onChainFactories },
            rawAccountData: { walletAddress: address },
            rawFactoriesData: parsedFactories,
          };
        } catch (chainErr) {
          console.warn('On-chain also failed, using JWT game API:', chainErr);
          info = await fetchPlayerAccountWithJWT(token, userId || undefined);
          tokenBalances = await fetchTokenBalances(address);
        }
      }

      if (info.id) {
        setUserId(info.id);
        localStorage.setItem('cw-user-id', info.id);
      }
      setAccountInfo(info);
      if (tokenBalances) {
        setBalances(tokenBalances);
        localStorage.setItem('cw-token-balances', JSON.stringify(tokenBalances));
      }
      setLastAutoRefresh(Date.now());
      setAutoRefreshCountdown(30);
      localStorage.setItem('cw-account-info', JSON.stringify(info));
    } catch (err) {
      console.error('Failed to authenticate with Ronin:', err);
      throw err;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = () => {
    // Stop auto-refresh
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    setWalletAddress('');
    setUserId('');
    setJwtToken(null);
    setRefreshToken(null);
    setRoninAddress(null);
    setAccountInfo(null);
    setBalances(null);
    setLastAutoRefresh(0);
    clearAuth();
    localStorage.removeItem('cw_token');
    localStorage.removeItem('cw-wallet-address');
    localStorage.removeItem('cw-user-id');
    localStorage.removeItem('cw-account-info');
    localStorage.removeItem('cw-token-balances');
  };

  const tabContentRef = useRef<HTMLDivElement>(null);

  // Sync level from playerConfig when switching active factory
  const prevActiveFactoryRef2 = useRef(activeFactory);
  useEffect(() => {
    const factoryChanged = prevActiveFactoryRef2.current !== activeFactory;
    prevActiveFactoryRef2.current = activeFactory;
    if (factoryChanged) {
      const configLevel = playerConfig.getConfig(activeFactory).level || 1;
      if (configLevel !== currentLevel) {
        levelSourceRef.current = 'config';
        setCurrentLevel(configLevel);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFactory]);

  // Sync level changes from slider/user to playerConfig — skip if change came from config or on mount
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (levelSourceRef.current === 'config') {
      levelSourceRef.current = 'idle';
      return;
    }
    const currentCfg = playerConfig.getConfig(activeFactory);
    if (currentCfg.level !== currentLevel) {
      playerConfig.updateField(activeFactory, 'level', currentLevel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLevel]);


  // Animate page header letters once loaded
  useEffect(() => {
    anime.timeline()
      .add({
        targets: '.logoChar',
        translateY: [-30, 0],
        opacity: [0, 1],
        easing: "easeOutElastic(1.2, 0.6)",
        delay: anime.stagger(45),
        duration: 1000
      });
  }, []);

  // Animate tab content transitions when activeTab changes
  useEffect(() => {
    if (tabContentRef.current) {
      anime({
        targets: tabContentRef.current,
        opacity: [0, 1],
        translateY: [15, 0],
        duration: 350,
        easing: 'easeOutQuad'
      });

      if (activeTab === 'explorer') {
        anime({
          targets: tabContentRef.current.querySelectorAll('.bento-card'),
          opacity: [0, 1],
          translateY: [20, 0],
          scale: [0.98, 1],
          easing: 'spring(1, 80, 12, 0)',
          delay: anime.stagger(60)
        });
      }
    }
  }, [activeTab]);

  // Persist user preferences to localStorage
  useEffect(() => {
    localStorage.setItem('cw-active-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('cw-active-factory', activeFactory);
  }, [activeFactory]);

  useEffect(() => {
    localStorage.setItem('cw-current-level', currentLevel.toString());
  }, [currentLevel]);

  useEffect(() => {
    localStorage.setItem('cw-target-production', targetProduction.toString());
  }, [targetProduction]);





  const handleSelectFactory = (name: string) => {
    setActiveFactory(name);
    const cfg = playerConfig.getConfig(name);
    setCurrentLevel(cfg.level || 1);
  };

  // State derivation
  const levels = FACTORIES_DATA[activeFactory] || [];
  const maxLevel = levels.length;
  const currentLvlData: LevelData = levels[currentLevel - 1] || levels[0] || {} as LevelData;
  const activeConfig = playerConfig.getConfig(activeFactory);

  const basePowerCost = levels[0]?.power_cost || 0;
  const category = getCategory(activeFactory);
  const emoji = getEmoji(activeFactory);

  const gameBalances = React.useMemo(() => {
    if (!accountInfo?.resources) return null;
    const map: Record<string, number> = {};
    accountInfo.resources.forEach(r => {
      map[r.symbol.toUpperCase()] = r.amount;
    });
    return map;
  }, [accountInfo]);

  const inputs = [];
  if (currentLvlData.input1) {
    inputs.push({
      name: currentLvlData.input1,
      amount: currentLvlData.input1_amt,
      emoji: getEmoji(currentLvlData.input1)
    });
  }
  if (currentLvlData.input2) {
    inputs.push({
      name: currentLvlData.input2,
      amount: currentLvlData.input2_amt,
      emoji: getEmoji(currentLvlData.input2)
    });
  }

  // Relations mapping
  const firstLvl = levels[0] || {};
  const parents = [firstLvl.input1, firstLvl.input2]
    .filter(Boolean)
    .map(name => ({
      name,
      emoji: getEmoji(name),
      isFactory: FACTORIES_DATA[name] !== undefined
    }));

  const children = Object.keys(FACTORIES_DATA)
    .filter(name => {
      if (name === activeFactory) return false;
      const fl = FACTORIES_DATA[name][0];
      return fl.input1 === activeFactory || fl.input2 === activeFactory;
    })
    .map(name => ({
      name,
      emoji: getEmoji(name)
    }));

  return (
    <div className="app-container">
      {/* Floating HUD Navbar */}
      <nav className="navbar">
        <div className="nav-left">
          <img src="/assets/logo.png" className="logo-img" alt="Craft World Logo" />
        </div>
        <div className="nav-center">
          <button
            className={`nav-tab-btn ${activeTab === 'explorer' ? 'nav-tab-btn-active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            <span className="tab-emoji">🏭</span> <span className="tab-text">EXPLORADOR</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'production' ? 'nav-tab-btn-active' : ''}`}
            onClick={() => setActiveTab('production')}
          >
            <span className="tab-emoji">🧮</span> <span className="tab-text">PRODUCCION</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'relations' ? 'nav-tab-btn-active' : ''}`}
            onClick={() => setActiveTab('relations')}
          >
            <span className="tab-emoji">🔗</span> <span className="tab-text">RECETAS</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'resources' ? 'nav-tab-btn-active' : ''}`}
            onClick={() => setActiveTab('resources')}
          >
            <span className="tab-emoji">📊</span> <span className="tab-text">RECURSOS</span>
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'masterpiece' ? 'nav-tab-btn-active' : ''}`}
            onClick={() => setActiveTab('masterpiece')}
          >
            <span className="tab-emoji">🏆</span> <span className="tab-text">OBRA MAESTRA</span>
          </button>
        </div>
        <div className="nav-right">
          {/* Status del RPC/API */}
          <div className="hud-badge" title={`Servidor: ${source === 'game-api' ? 'Game API' : 'Ronin RPC'} ${stale ? '(Datos obsoletos)' : ''}`} style={{ borderColor: stale ? 'rgba(255,165,0,0.3)' : source === 'game-api' ? 'rgba(57,255,20,0.2)' : 'rgba(255,255,0,0.2)' }}>
            <span style={{ color: stale ? '#ffa500' : source === 'game-api' ? 'var(--color-green)' : '#fbbf24', fontSize: '0.7rem', fontWeight: 800 }}>
              {stale ? '⚠️ STALE' : source === 'game-api' ? '🟢 API' : '🟡 RPC'}
            </span>
            <span style={{ marginLeft: '4px', fontSize: '0.65rem', color: 'rgba(255, 255, 255, 0.4)', fontFamily: 'var(--font-mono)' }}>
              <PriceCountdown lastUpdate={lastUpdate} />
            </span>
          </div>

          {/* Precio del COIN */}
          <div
            className="hud-badge"
            style={{ borderColor: 'rgba(57, 255, 20, 0.2)', cursor: 'pointer' }}
            onClick={() => setShowCoinCalc(true)}
            title="Abrir Calculadora de COIN"
          >
            <span className="hud-badge-value" style={{ color: 'var(--color-green)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <img 
                src="/assets/resources/Coin.png" 
                alt="COIN" 
                style={{ width: '16px', height: '16px', objectFit: 'contain' }}
              />
              ${pricesLoading ? '...' : coinPriceUsd.toFixed(6)}
            </span>
          </div>

          {/* Selector de Recurso Activo */}
          <ResourceSelectorDropdown
            activeFactory={activeFactory}
            factoriesList={Object.keys(FACTORIES_DATA).sort()}
            onSelectFactory={handleSelectFactory}
          />



          {/* Auto-Refresh Indicator */}
          {jwtToken && accountInfo && (
            <div
              className="hud-badge"
              style={{
                borderColor: autoRefreshCountdown <= 5 ? 'rgba(57,255,20,0.4)' : 'rgba(57,255,20,0.15)',
                transition: 'border-color 0.3s ease',
              }}
              title={`Datos actualizándose cada 30s. Último: ${lastAutoRefresh ? new Date(lastAutoRefresh).toLocaleTimeString() : 'N/A'}`}
            >
              <span style={{
                color: autoRefreshCountdown <= 5 ? 'var(--color-green)' : 'rgba(255,255,255,0.5)',
                fontSize: '0.7rem',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: isSyncing ? '#fbbf24' : 'var(--color-green)',
                  display: 'inline-block',
                  animation: isSyncing ? 'pulse 0.8s infinite' : autoRefreshCountdown <= 3 ? 'pulse 0.5s infinite' : 'none',
                }} />
                {isSyncing ? '⟳' : `${autoRefreshCountdown}s`}
              </span>
            </div>
          )}

          {/* Conexión de Cuenta */}
          <div 
            className={`hud-badge connection-badge ${accountInfo ? 'connected' : 'disconnected'}`}
            onClick={() => setShowAccountModal(true)}
            title={accountInfo ? "Cuenta conectada. Haz clic para ver detalles" : "Conectar cuenta de juego"}
          >
            <span className="hud-badge-value" style={{ fontSize: '0.8rem' }}>
              {accountInfo ? `👤 ${accountInfo.displayName}` : '🔌 Conectar'}
            </span>
          </div>
        </div>
      </nav>

      <div ref={tabContentRef} className="app-content">
        {activeTab === 'explorer' && (
          <div className="explorer-layout">

            {/* MAIN AREA: CONNECTOR, DETAILS, SLIDER, CHART */}
            <main className="explorer-main">

              <div className="factory-details-grid">
                <FactoryDetails
                  factoryName={activeFactory}
                  category={category}
                  emoji={emoji}
                  maxLevel={maxLevel}
                  basePowerCost={basePowerCost}
                  inputs={inputs}
                  prices={prices}
                  coinPriceUsd={coinPriceUsd}
                  factoriesCount={activeConfig.factories}
                  currentConfigLevel={activeConfig.level}
                  playerCfg={activeConfig}
                  accountInfo={accountInfo}
                  priceDeltas={priceDeltas}
                  currentLevelData={currentLvlData}
                  gameBalance={gameBalances?.[activeFactory] ?? undefined}
                  walletBalance={balances?.[activeFactory] ?? undefined}
                />
                <LevelSlider
                  level={currentLevel}
                  setLevel={setCurrentLevel}
                  maxLevel={maxLevel}
                  output={currentLvlData.output || 0}
                  duration={currentLvlData.duration || '0:00:00'}
                  durationSec={currentLvlData.duration_sec || 0}
                  powerCost={currentLvlData.power_cost || 0}
                  xpPerOutput={currentLvlData.xp_per_output || 0}
                  costSymbol={currentLvlData.cost_symbol}
                  costAmount={currentLvlData.cost_amount || 0}
                  levels={levels}
                  prices={prices}
                />
              </div>

              <ProgressionChart
                levels={levels}
                currentLevel={currentLevel}
                setCurrentLevel={setCurrentLevel}
              />
            </main>
          </div>
        )}

        {activeTab === 'production' && (
          <BentoGrid>
            {/* CONFIGURACIÓN DE BONOS */}
            <BonusPanel
              factoryName={activeFactory}
              factoryCount={activeConfig.factories}
              setFactoryCount={(n) => playerConfig.updateField(activeFactory, 'factories', n)}
              mastery={activeConfig.mastery}
              setMastery={(n) => playerConfig.updateField(activeFactory, 'mastery', n)}
              workshop={activeConfig.workshop}
              setWorkshop={(n) => playerConfig.updateField(activeFactory, 'workshop', n)}
              workers={activeConfig.workers}
              setWorkers={(n) => playerConfig.updateField(activeFactory, 'workers', n)}
              boost={activeConfig.boost}
              setBoost={(n) => playerConfig.updateField(activeFactory, 'boost', n)}
            />

            {/* CARD 5: CALCULATOR */}
            <Calculator
              dailyProduction={currentLvlData.production_per_day || 0}
              dailyXp={currentLvlData.xp_per_day || 0}
              targetProduction={targetProduction}
              setTargetProduction={setTargetProduction}
              inputs={inputs}
              outputPerCycle={currentLvlData.output || 1}
              prices={prices}
              outputName={activeFactory}
              durationSec={currentLvlData.duration_sec || 0}
              xpPerOutput={currentLvlData.xp_per_output || 0}
              factoryCount={activeConfig.factories}
              mastery={activeConfig.mastery}
              workshop={activeConfig.workshop}
              workers={activeConfig.workers}
              boost={activeConfig.boost}
              levelYield={currentLvlData.yield}
            />

            {/* CONSUMO DE ENERGÍA */}
            <PowerCalculator
              playerConfig={playerConfig.config}
              prices={prices}
            />
          </BentoGrid>
        )}

        {activeTab === 'relations' && (
          <BentoGrid>
            {/* CARD 7: RELATION EXPLORER */}
            <RelationsExplorer
              currentFactory={activeFactory}
              parents={parents}
              children={children}
              onSelectFactory={handleSelectFactory}
              prices={prices}
            />
          </BentoGrid>
        )}

        {activeTab === 'resources' && (
          <BentoGrid>
            {/* CARD 8: RESOURCE TABLE */}
            <ResourceTable
              prices={prices}
              coinPriceUsd={coinPriceUsd}
              pricesLoading={pricesLoading}
              playerConfig={playerConfig}
              priceDeltas={priceDeltas}
              balances={balances}
              gameBalances={gameBalances}
              accountInfo={accountInfo}
            />
          </BentoGrid>
        )}

        {activeTab === 'masterpiece' && (
          <BentoGrid>
            <MasterpieceSimulator prices={prices} />
          </BentoGrid>
        )}
      </div>

      <footer className="app-footer">
        <p>Diseñado con ❤️ en React + TypeScript y animado con <strong>anime.js</strong>. Craft World © 2026</p>
      </footer>

      <CoinCalculatorModal
        isOpen={showCoinCalc}
        onClose={() => setShowCoinCalc(false)}
        coinPriceUsd={coinPriceUsd}
        prices={prices}
      />

      <AccountConnector
        isOpen={showAccountModal}
        onClose={() => setShowAccountModal(false)}
        walletAddress={walletAddress}
        userId={userId}
        jwtToken={jwtToken}
        roninAddress={roninAddress}
        accountInfo={accountInfo}
        balances={balances}
        isSyncing={isSyncing}
        onSyncUserId={handleSyncUserId}
        onRoninAuth={handleRoninAuth}
        onDisconnect={handleDisconnect}
      />
    </div>
  );
};

