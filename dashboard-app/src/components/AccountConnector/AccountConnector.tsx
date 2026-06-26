import React, { useState, useEffect, useRef } from 'react';
import styles from './AccountConnector.module.css';
import type { PlayerAccountInfo } from '../../utils/accountService';
import { isRoninWalletInstalled, fetchAuthenticatedAccountData } from '../../utils/roninAuth';
import anime from 'animejs';

interface AccountConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
  userId: string;
  jwtToken: string | null;
  roninAddress: string | null;
  accountInfo: PlayerAccountInfo | null;
  balances: Record<string, number> | null;
  isSyncing: boolean;
  onSyncUserId: (userId: string) => Promise<void>;
  onRoninAuth: () => Promise<void>;
  onDisconnect: () => void;
}

export const AccountConnector: React.FC<AccountConnectorProps> = ({
  isOpen,
  onClose,
  walletAddress,
  userId,
  jwtToken,
  roninAddress,
  accountInfo,
  balances,
  isSyncing,
  onSyncUserId,
  onRoninAuth,
  onDisconnect,
}) => {
  const [inputUserId, setInputUserId] = useState(userId);
  const [inputJwt, setInputJwt] = useState(jwtToken || '');
  const [localSyncing, setLocalSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const roninDetected = isRoninWalletInstalled();
  const [activeLoginTab, setActiveLoginTab] = useState<'web3' | 'address' | 'jwt'>('web3');

  const handleRoninLogin = async () => {
    setErrorMsg('');
    setLocalSyncing(true);
    try {
      await onRoninAuth();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al autenticar con Ronin Wallet.');
    } finally {
      setLocalSyncing(false);
    }
  };

  const handleUserIdSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUserId) {
      setErrorMsg('Por favor ingresa tu Wallet, RNS (.ronin) o User ID.');
      return;
    }
    setErrorMsg('');
    setLocalSyncing(true);
    try {
      await onSyncUserId(inputUserId);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al cargar datos de la blockchain. Revisa la consola (F12).');
    } finally {
      setLocalSyncing(false);
    }
  };

  const handleJwtSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputJwt) {
      setErrorMsg('Pega tu JWT token aquí.');
      return;
    }
    setErrorMsg('');
    setLocalSyncing(true);
    try {
      localStorage.setItem('cw_token', inputJwt);
      localStorage.setItem('cw-auth-token', inputJwt);
      const info = await fetchAuthenticatedAccountData(inputJwt, inputUserId || undefined);
      if (info.id) {
        localStorage.setItem('cw-user-id', info.id);
      }
      localStorage.setItem('cw-account-info', JSON.stringify(info));
      window.location.reload();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al usar JWT.');
    } finally {
      setLocalSyncing(false);
    }
  };

  const handleDisconnectAll = () => {
    setInputUserId('');
    setInputJwt('');
    setErrorMsg('');
    onDisconnect();
  };

  const getStatusString = () => {
    if (isSyncing || localSyncing) return 'loading';
    if (accountInfo) return 'connected';
    if (roninAddress || walletAddress || jwtToken) return 'wallet-only';
    return 'disconnected';
  };

  const status = getStatusString();
  const balanceCount = balances ? Object.keys(balances).filter(k => balances[k] > 0).length : 0;

  const apiFactoryCount = 
    ((accountInfo as any)?.factories?.length || 0) +
    ((accountInfo as any)?.buildings?.length || 0) +
    ((accountInfo as any)?.powerPlants?.length || 0) +
    ((accountInfo as any)?.batteries?.length || 0);

  const displayWallet = roninAddress || walletAddress;

  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', handleEscape);

      anime.remove([overlayRef.current, modalRef.current]);
      
      anime({
        targets: overlayRef.current,
        opacity: [0, 1],
        duration: 300,
        easing: 'easeOutQuad'
      });

      anime({
        targets: modalRef.current,
        scale: [0.92, 1],
        opacity: [0, 1],
        duration: 350,
        easing: 'easeOutBack'
      });

      return () => {
        window.removeEventListener('keydown', handleEscape);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div className={`${styles.modal} ${styles[status]}`} ref={modalRef}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar modal">
          &times;
        </button>

        <div className={styles.header}>
          <div className={styles.titleArea}>
            <span className={styles.icon}>🔗</span>
            <div>
              <h3>Conexión de Cuenta</h3>
              <p className={styles.subtitle}>Usa tu token de CraftWorld/Firebase para cargar tus datos del juego</p>
            </div>
          </div>
          <span className={`${styles.statusBadge} ${styles[status]}`}>
            {status === 'connected' && '🟢 Conectado'}
            {status === 'wallet-only' && '🟡 Wallet Conectada'}
            {status === 'loading' && '⚡ Sincronizando...'}
            {status === 'disconnected' && '⚪ Desconectado'}
          </span>
        </div>

        {status === 'disconnected' && (
          <div className={styles.formContainer}>
            <div className={styles.loginTabs}>
              <button
                onClick={() => { setErrorMsg(''); setActiveLoginTab('web3'); }}
                className={`${styles.loginTabBtn} ${activeLoginTab === 'web3' ? styles.loginTabBtnActive : ''}`}
              >
                🦊 Ronin Wallet
              </button>
              <button
                onClick={() => { setErrorMsg(''); setActiveLoginTab('address'); }}
                className={`${styles.loginTabBtn} ${activeLoginTab === 'address' ? styles.loginTabBtnActive : ''}`}
              >
                🔍 Consulta Pública
              </button>
              <button
                onClick={() => { setErrorMsg(''); setActiveLoginTab('jwt'); }}
                className={`${styles.loginTabBtn} ${activeLoginTab === 'jwt' ? styles.loginTabBtnActive : ''}`}
              >
                🔑 Token JWT
              </button>
            </div>

            <div className={styles.tabContent}>
              {activeLoginTab === 'web3' && (
                <div className={styles.tabPanel}>
                  <p className={styles.loginDesc}>
                    Si ya tienes Ronin configurado, este flujo heredado puede intentar obtener un token Firebase. El flujo recomendado es usar cw_token de CraftWorld/Firebase.
                  </p>
                  <button
                    onClick={handleRoninLogin}
                    disabled={isSyncing || localSyncing}
                    className={styles.roninBtn}
                  >
                    <span className={styles.roninBtnIcon}>🦊</span>
                    <span>Iniciar sesión con Ronin Wallet</span>
                  </button>
                  {!roninDetected && (
                    <p className={styles.hint}>
                      ¿No tienes Ronin Wallet?{' '}
                      <a href="https://wallet.roninchain.com" target="_blank" rel="noopener noreferrer">
                        Instálala aquí
                      </a>
                    </p>
                  )}
                </div>
              )}

              {activeLoginTab === 'address' && (
                <div className={styles.tabPanel}>
                  <p className={styles.loginDesc}>
                    Carga los saldos de tus recursos y fábricas directamente de la blockchain ingresando tu dirección Ronin o tu dominio RNS (.ronin).
                  </p>
                  <form onSubmit={handleUserIdSubmit} className={styles.formGroup}>
                    <div className={styles.inputWrapper}>
                      <input
                        type="text"
                        placeholder="Ej: 0x1234... o tu_nombre.ronin"
                        value={inputUserId}
                        onChange={(e) => setInputUserId(e.target.value)}
                        className={styles.input}
                      />
                      <button type="submit" disabled={isSyncing || localSyncing} className={styles.secondaryBtn}>
                        Consultar
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {activeLoginTab === 'jwt' && (
                <div className={styles.tabPanel}>
                  <p className={styles.loginDesc}>
                    Pega tu cw_token de CraftWorld/Firebase. Se limpiará en el frontend y el backend lo normalizará para CraftWorld.
                  </p>
                  <form onSubmit={handleJwtSubmit} className={styles.formGroup}>
                    <div className={styles.inputWrapper}>
                      <input
                        type="text"
                        placeholder="Pega tu JWT token aquí..."
                        value={inputJwt}
                        onChange={(e) => setInputJwt(e.target.value)}
                        className={styles.input}
                      />
                      <button type="submit" disabled={isSyncing || localSyncing} className={styles.secondaryBtn}>
                        Usar JWT
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>

            {errorMsg && <p className={styles.errorText}>{errorMsg}</p>}
          </div>
        )}

        {status === 'wallet-only' && (
          <div className={styles.connectedContainer}>
            <div className={styles.accountHeader}>
              <div className={styles.meta}>
                <span className={styles.addressLabel}>Wallet:</span>
                <code className={styles.code}>
                  {displayWallet ? `${displayWallet.slice(0, 10)}...${displayWallet.slice(-8)}` : 'Conectada'}
                </code>
              </div>
              <button onClick={handleDisconnectAll} className={styles.disconnectBtn}>Desconectar</button>
            </div>

            {balances && balanceCount > 0 && (
              <div className={styles.statsSummary}>
                <div className={styles.statItem}>
                  <span className={styles.statVal}>{balanceCount}</span>
                  <span className={styles.statLbl}>Recursos en Wallet</span>
                </div>
                <div className={styles.statItem}>
                  <span className={styles.statVal}>
                    ${balances?.COIN ? (balances.COIN).toFixed(2) : '0.00'}
                  </span>
                  <span className={styles.statLbl}>Saldos Cargados</span>
                </div>
              </div>
            )}

            <form onSubmit={handleUserIdSubmit} className={styles.addJwtSection}>
              <p className={styles.jwtHint}>
                <strong>¡Paso 2!</strong> Ingresa tu <strong>Account ID</strong> del juego (el código que empieza con <strong>0x...</strong>) para cargar tus datos:
              </p>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  placeholder="Pega tu Account ID (Ej: 0x4334...)"
                  value={inputUserId}
                  onChange={(e) => setInputUserId(e.target.value)}
                  className={styles.inputSmall}
                />
                <button type="submit" disabled={isSyncing || localSyncing} className={styles.addJwtBtn}>
                  Cargar Cuenta
                </button>
              </div>
            </form>

            {errorMsg && <p className={styles.errorText}>{errorMsg}</p>}
          </div>
        )}

        {status === 'connected' && (
          <div className={styles.connectedContainer}>
            <div className={styles.accountHeader}>
              <div className={styles.userInfo}>
                <span className={styles.userName}>{accountInfo?.displayName || 'Usuario Cargado'}</span>
                {accountInfo && <span className={styles.userLvl}>LVL {accountInfo.level}</span>}
              </div>
              <div className={styles.headerActions}>
                {displayWallet && (
                  <code className={styles.roninBadge}>
                    🦊 {displayWallet.slice(0, 6)}...{displayWallet.slice(-4)}
                  </code>
                )}
                <button onClick={handleDisconnectAll} className={styles.disconnectBtn}>Desconectar</button>
              </div>
            </div>

            <div className={styles.metaGrid}>
              {accountInfo?.id && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLbl}>User ID</span>
                  <code className={styles.metaVal}>{accountInfo.id}</code>
                </div>
              )}
              {accountInfo?.walletAddress && (
                <div className={styles.metaItem}>
                  <span className={styles.metaLbl}>Wallet asociada</span>
                  <code className={styles.metaVal}>{accountInfo.walletAddress.slice(0, 8)}...{accountInfo.walletAddress.slice(-6)}</code>
                </div>
              )}
            </div>

            <div className={styles.statsSummary}>
              <div className={styles.statItem}>
                <span className={styles.statVal}>{accountInfo?.mines?.length || 0}</span>
                <span className={styles.statLbl}>Minas</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statVal}>{apiFactoryCount || '0'}</span>
                <span className={styles.statLbl}>Fábricas/Edificios</span>
              </div>
              <div className={styles.statItem}>
                <span className={styles.statVal}>{accountInfo?.resources?.length || balanceCount}</span>
                <span className={styles.statLbl}>Recursos</span>
              </div>
            </div>

            <div className={styles.footerActions}>
              <button
                onClick={handleRoninLogin}
                disabled={isSyncing || localSyncing}
                className={styles.refreshBtn}
              >
                🔄 Volver a Autenticar / Firmar con Ronin
              </button>
            </div>

            <div className={styles.debugToggleArea}>
              <button
                onClick={(e) => { e.preventDefault(); setShowDebug(!showDebug); }}
                className={styles.debugToggleBtn}
              >
                {showDebug ? '🙈 Ocultar' : '🔍 Ver datos crudos API'}
              </button>
              {showDebug && (
                <pre className={styles.debugPre}>
                  {JSON.stringify(accountInfo, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {(isSyncing || localSyncing) && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner}></div>
            <p>Conectándose a los servidores del juego...</p>
          </div>
        )}
      </div>
    </div>
  );
};
