import React, { useEffect, useRef } from 'react';
import anime from 'animejs';
import styles from './BonusPanel.module.css';
import { MASTERY_YIELD_PER_LEVEL } from '../../utils/gameHelpers';

interface BonusPanelProps {
  factoryName: string;
  factoryCount: number;
  setFactoryCount: (n: number) => void;
  mastery: number;
  setMastery: (n: number) => void;
  workshop: number;
  setWorkshop: (n: number) => void;
  workers: number;
  setWorkers: (n: number) => void;
  boost: number; // 1, 2, 5, 10
  setBoost: (n: number) => void;
}

const BOOST_OPTIONS = [1, 2, 5, 10] as const;

export const BonusPanel: React.FC<BonusPanelProps> = ({
  factoryName,
  factoryCount,
  setFactoryCount,
  mastery,
  setMastery,
  workshop,
  setWorkshop,
  workers,
  setWorkers,
  boost,
  setBoost,
}) => {
  const controlsRef = useRef<HTMLDivElement>(null);

  // Stagger animation on mount
  useEffect(() => {
    if (controlsRef.current && controlsRef.current.children.length > 0) {
      anime({
        targets: controlsRef.current.children,
        opacity: [0, 1],
        translateY: [18, 0],
        easing: 'easeOutQuad',
        duration: 450,
        delay: anime.stagger(70),
      });
    }
  }, []);

  // Computed effects
  const yieldBonus = +(mastery * MASTERY_YIELD_PER_LEVEL).toFixed(2);
  const timeReduction = 0;
  const inputReduction = 0;

  const handleCountChange = (value: number) => {
    setFactoryCount(Math.max(1, Math.min(100, value)));
  };

  return (
    <section className={`bento-card ${styles.card}`}>
      <h2 className={styles.title}>
        ⚙️ CONFIGURACIÓN DE BONIFICACIONES
        <span className={styles.factoryBadge}>{factoryName}</span>
      </h2>

      <div className={styles.controlsGrid} ref={controlsRef}>
        {/* Factory Count */}
        <div className={styles.controlGroup} style={{ opacity: 0 }}>
          <span className={styles.controlLabel}>Cantidad de Fábricas</span>
          <div className={styles.stepperRow}>
            <button
              className={styles.stepperBtn}
              onClick={() => handleCountChange(factoryCount - 1)}
              aria-label="Reducir cantidad"
            >
              −
            </button>
            <input
              type="number"
              className={styles.stepperInput}
              value={factoryCount}
              onChange={(e) => handleCountChange(parseInt(e.target.value) || 1)}
              min={1}
              max={100}
            />
            <button
              className={styles.stepperBtn}
              onClick={() => handleCountChange(factoryCount + 1)}
              aria-label="Aumentar cantidad"
            >
              +
            </button>
          </div>
        </div>

        {/* Mastery Bonus */}
        <div className={styles.controlGroup} style={{ opacity: 0 }}>
          <span className={styles.controlLabel}>Bonus de Maestría</span>
          <div className={styles.sliderRow}>
            <input
              type="range"
              className={styles.sliderTrack}
              min={0}
              max={200}
              value={mastery}
              onChange={(e) => setMastery(parseInt(e.target.value))}
            />
            <div className={styles.sliderInfo}>
              <span className={styles.sliderValue}>{mastery}</span>
              <span className={styles.sliderEffect}>+{yieldBonus}% yield</span>
            </div>
          </div>
        </div>

        {/* Workshop Bonus */}
        <div className={styles.controlGroup} style={{ opacity: 0 }}>
          <span className={styles.controlLabel}>Bonus del Taller</span>
          <div className={styles.sliderRow}>
            <input
              type="range"
              className={styles.sliderTrack}
              min={0}
              max={100}
              value={workshop}
              onChange={(e) => setWorkshop(parseInt(e.target.value))}
            />
            <div className={styles.sliderInfo}>
              <span className={styles.sliderValue}>{workshop}%</span>
              <span className={styles.sliderEffect}>+{workshop}% velocidad</span>
            </div>
          </div>
        </div>

        {/* Workers Bonus */}
        <div className={styles.controlGroup} style={{ opacity: 0 }}>
          <span className={styles.controlLabel}>Bonus de Trabajadores</span>
          <div className={styles.sliderRow}>
            <input
              type="range"
              className={styles.sliderTrack}
              min={0}
              max={100}
              value={workers}
              onChange={(e) => setWorkers(parseInt(e.target.value))}
            />
            <div className={styles.sliderInfo}>
              <span className={styles.sliderValue}>{workers}%</span>
              <span className={styles.sliderEffect}>+{workers}% velocidad</span>
            </div>
          </div>
        </div>

        {/* Speed Boost */}
        <div className={styles.controlGroup} style={{ opacity: 0 }}>
          <span className={styles.controlLabel}>Boost de Velocidad</span>
          <div className={styles.boostGroup}>
            {BOOST_OPTIONS.map((opt) => (
              <button
                key={opt}
                className={`${styles.boostBtn} ${boost === opt ? styles.boostBtnActive : ''}`}
                onClick={() => setBoost(opt)}
              >
                {opt === 1 ? 'x1' : `x${opt}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Stripe */}
      <div className={styles.summaryStripe}>
        <div className={styles.summaryItem}>
          <span className={styles.summaryItemLabel}>Yield Bonus</span>
          <span className={styles.summaryItemValue}>+{yieldBonus}%</span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryItemLabel}>Tiempo Reducido</span>
          <span className={`${styles.summaryItemValue} ${styles.summaryItemValueCyan}`}>
            -{timeReduction}%
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryItemLabel}>Insumos Reducidos</span>
          <span className={`${styles.summaryItemValue} ${styles.summaryItemValuePink}`}>
            -{inputReduction}%
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryItemLabel}>Velocidad</span>
          <span className={`${styles.summaryItemValue} ${styles.summaryItemValueOrange}`}>
            x{boost}
          </span>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryItemLabel}>Fábricas</span>
          <span className={styles.summaryItemValue}>{factoryCount}</span>
        </div>
      </div>
    </section>
  );
};
