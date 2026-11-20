import { useEffect, useId, useRef, useState } from 'react';
import { versionRows, type VersionChoice, type VersionDecision, type VersionOffer } from '../../utils/version-choice';
import { VersionList } from '../version/VersionList';
import styles from './PlayerVersionPanel.module.css';

// Le réglage « Version » dans le lecteur (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md,
// § 4.1 et 4.3 b) : par-dessus la vidéo, la liste partagée des versions de ce film (`VersionList`, classes de cette
// feuille), ou la question des sous-titres quand le lecteur est ouvert hors de la borne sur une décision « ask ». Un
// choix comme une réponse valent pour ce film seulement : le lecteur les passe à `choose` (usePlayerVersion).

export interface PlayerVersionPanelProps {
  view: 'list' | 'question';
  offer: VersionOffer;
  /** La version qui joue, cochée dans la liste. */
  current: VersionChoice | null;
  /** La question telle que la décision la pose ; lue seulement en vue « question ». */
  question: Extract<VersionDecision, { kind: 'ask' }> | null;
  /** Une version choisie dans la liste. */
  onPick(v: VersionChoice): void;
  /** La réponse à la question. */
  onAnswer(v: VersionChoice): void;
  /** « Retour » de la liste. */
  onClose(): void;
}

export function PlayerVersionPanel({ view, offer, current, question, onPick, onAnswer, onClose }: PlayerVersionPanelProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // « Autres versions » déplie la liste ; refermée, elle repart pliée.
  const [expanded, setExpanded] = useState(false);

  // Le focus va au premier bouton de ce qui s'affiche : les raccourcis du lecteur ne visent plus la vidéo dessous.
  useEffect(() => {
    panelRef.current?.querySelector('button')?.focus();
  }, [view]);

  return (
    <div className={styles.overlay}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        // La liste porte son propre titre (VersionList) : le dialogue prend son nom.
        aria-label={view === 'list' ? 'Version' : undefined}
        aria-labelledby={view === 'question' ? `${id}-title` : undefined}
      >
        {view === 'list' ? (
          <VersionList
            title="Version"
            rows={versionRows({ offer, current, expanded, withAuto: false })}
            classes={{
              list: styles.list,
              title: styles.title,
              row: styles.row,
              rowSelected: styles.rowSelected,
              absent: styles.absent,
              name: styles.name,
              sub: styles.sub,
              more: styles.more,
              back: styles.back,
            }}
            // La liste du lecteur n'a pas de ligne « Automatique » (réglage du compte) : un appui rend toujours un couple.
            onPick={(v) => {
              if (v) onPick(v);
            }}
            onMore={() => setExpanded(true)}
            onBack={onClose}
          />
        ) : question && (
          <>
            <h2 id={`${id}-title`} className={styles.title}>{question.title}</h2>
            {question.body && <p className={styles.body}>{question.body}</p>}
            <div className={styles.answers}>
              <button type="button" className={styles.answer} onClick={() => onAnswer(question.keep.version)}>
                {question.keep.label}
              </button>
              <button type="button" className={styles.answer} onClick={() => onAnswer(question.other.version)}>
                {question.other.label}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** La note d'une substitution (« VOSTFR · VF indisponible pour ce film »), en ligne sous l'en-tête du lecteur. */
export function VersionNoteLine({ text }: { text: string }) {
  return (
    <p className={styles.note} role="status">
      {text}
    </p>
  );
}
