import type { VersionChoice, VersionRow } from '../../utils/version-choice';

// La liste des versions, la même partout (docs/superpowers/specs/2026-11-19-versions-et-erreurs-de-lecture-design.md,
// § 4.3) : le réglage « Version préférée » de « Mon compte », la ligne « Version » du panneau de la borne, le bouton
// « Version » du lecteur et de la télécommande du Cast. Les lignes viennent de `versionRows` (logique pure testée).
// Pas de feuille de style à elle : chaque endroit lui passe les classes de la sienne — une seule liste pour trois
// dessins. Ni état ni crochet : ce que la liste montre et ce qu'un appui fait ne dépendent que de ses propriétés.

export interface VersionListClasses {
  /** La liste entière. */
  list: string;
  title: string;
  /** Une version qu'on peut choisir (« Automatique » comprise). */
  row: string;
  /** Ajoutée à `row` sur la version courante. */
  rowSelected: string;
  /** Une version que le film n'a pas : une ligne de texte avec sa raison. */
  absent: string;
  name: string;
  sub: string;
  /** « Autres versions ». */
  more: string;
  /** « Retour », en pied. */
  back: string;
}

export interface VersionListProps {
  title: string;
  rows: VersionRow[];
  classes: VersionListClasses;
  /** Le couple choisi, ou null pour « Automatique ». */
  onPick(v: VersionChoice | null): void;
  /** « Autres versions » : déplier les combinaisons plus rares. */
  onMore(): void;
  onBack(): void;
  /** Un choix est en cours d'enregistrement : la liste le dit (`aria-busy`) et ses lignes ignorent l'appui. */
  busy?: boolean;
}

// La ligne « Automatique » ne porte pas de texte dans la logique : c'est l'écran qui l'écrit.
const AUTO_NAME = 'Automatique';
const AUTO_SUB = 'VF quand elle existe, sinon VOSTFR';

export function VersionList({ title, rows, classes, onPick, onMore, onBack, busy = false }: VersionListProps) {
  const waiting = busy || undefined;
  // Pendant l'enregistrement, un second choix ne part pas ; « Retour », lui, répond toujours (la liste n'enferme pas).
  const pick = (v: VersionChoice | null) => {
    if (!busy) onPick(v);
  };
  const more = () => {
    if (!busy) onMore();
  };

  const versionButton = (key: string, name: string, sub: string, selected: boolean, v: VersionChoice | null) => (
    <button
      key={key}
      type="button"
      className={selected ? `${classes.row} ${classes.rowSelected}` : classes.row}
      aria-pressed={selected}
      aria-busy={waiting}
      onClick={() => pick(v)}
    >
      <span className={classes.name}>{name}</span>
      <span className={classes.sub}>{sub}</span>
    </button>
  );

  return (
    <div className={classes.list} role="group" aria-label={title} aria-busy={waiting}>
      <h2 className={classes.title}>{title}</h2>
      {rows.map((row) => {
        switch (row.kind) {
          case 'auto':
            return versionButton('auto', AUTO_NAME, AUTO_SUB, row.selected, null);
          case 'choice':
            return versionButton(row.name, row.name, row.sub, row.selected, row.version);
          case 'absent':
            // Jamais un bouton grisé : la version absente est écrite, avec sa raison.
            return (
              <p key={row.text} className={classes.absent}>
                {row.text}
              </p>
            );
          case 'more':
            return (
              <button key="more" type="button" className={classes.more} onClick={more}>
                Autres versions
              </button>
            );
        }
      })}
      <button type="button" className={classes.back} onClick={onBack}>
        Retour
      </button>
    </div>
  );
}
