import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAST_CHOOSING_TEXT, NO_VOLUME_GESTURE, castBackLabel, castChipLabel, castChipLook, castDeviceLabel, castWaitingParts,
  continueHereLabel, formatCastTime, volumeDragged, volumeSettle, volumeShown,
} from '../../src/cast/cast-labels.ts';
import { castOwnsFilm, initialCastState } from '../../src/cast/cast-machine.ts';
import { watchHereLabel } from '../../src/components/kiosk/kiosk-logic.ts';

// Les décisions des panneaux du Cast qui se prennent sans React (src/cast/cast-labels.ts) : ce que dit chaque
// libellé, et surtout ce qu'il dit quand le nom de la télé est inconnu (page rechargée : `deviceName` est null).
// Les textes sont ceux de contraintes.md, apostrophes et points de suspension typographiques compris.

const text = (parts) => `${parts.before}${parts.device}${parts.after}`;

test('CAST LIBELLÉS: le nom de la télé, ou « la télé » quand il est inconnu', () => {
  assert.equal(castDeviceLabel('Téléviseur Pièce à vivre'), 'Téléviseur Pièce à vivre');
  assert.equal(castDeviceLabel(null), 'la télé');
  // Un nom vide ne dit rien : « Connexion à … » serait pire que « Connexion à la télé… ».
  assert.equal(castDeviceLabel(''), 'la télé');
  assert.equal(castDeviceLabel('   '), 'la télé');
});

test('CAST LIBELLÉS: l\'attente dit où en est la connexion', () => {
  assert.equal(text(castWaitingParts('connecting', 'Salon')), 'Connexion à Salon…');
  assert.equal(text(castWaitingParts('loading', 'Salon')), 'Lancement du film sur Salon…');
  assert.equal(text(castWaitingParts('connecting', null)), 'Connexion à la télé…');
  assert.equal(text(castWaitingParts('loading', null)), 'Lancement du film sur la télé…');
  // Le sélecteur ouvert n'a encore aucun nom à donner : la phrase est celle d'avant.
  assert.equal(CAST_CHOOSING_TEXT, 'Choisis ton appareil dans la fenêtre Google Cast.');
});

test('CAST LIBELLÉS: le nom n\'est mis en pastille que s\'il est connu', () => {
  assert.equal(castWaitingParts('connecting', 'Salon').named, true);
  assert.equal(castWaitingParts('loading', 'Salon').named, true);
  // « la télé » n'est pas un nom : il reste du texte courant.
  assert.equal(castWaitingParts('connecting', null).named, false);
  assert.equal(castWaitingParts('loading', null).named, false);
  assert.equal(castWaitingParts('loading', '').named, false);
});

test('CAST LIBELLÉS: la puce dit ce que fait la télé, seulement quand elle a un film à signaler', () => {
  assert.equal(castChipLabel('remote'), 'TÉLÉCOMMANDE');
  assert.equal(castChipLabel('lost'), 'LA TÉLÉ NE RÉPOND PLUS');
  assert.equal(castChipLabel('ended'), 'FILM TERMINÉ');
  for (const phase of ['idle', 'choosing', 'connecting', 'loading']) assert.equal(castChipLabel(phase), null, phase);
});

test('CAST LIBELLÉS: la puce a un libellé exactement quand la machine désigne un film', () => {
  // Deux décisions écrites à deux endroits ne doivent pas diverger : une puce sans mot, ou un mot sans puce.
  for (const phase of ['idle', 'choosing', 'connecting', 'loading', 'remote', 'ended', 'lost']) {
    const owns = castOwnsFilm({ ...initialCastState, phase, filmId: 7 }) !== null;
    assert.equal(castChipLabel(phase) !== null, owns, phase);
  }
});

test('CAST LIBELLÉS: « continuer ici » suit l\'appareil, comme « où regarder » de la borne', () => {
  const phone = watchHereLabel({ coarsePointer: true, shortSide: 411 });
  const tablet = watchHereLabel({ coarsePointer: true, shortSide: 820 });
  const computer = watchHereLabel({ coarsePointer: false, shortSide: 1080 });
  assert.equal(continueHereLabel(phone), 'Continuer sur ce téléphone');
  assert.equal(continueHereLabel(tablet), 'Continuer sur cette tablette');
  assert.equal(continueHereLabel(computer), 'Continuer sur cet ordinateur');
});

test('CAST LIBELLÉS: le retour dit d\'où l\'on vient', () => {
  assert.equal(castBackLabel('kiosk'), '← Retour à la borne');
  assert.equal(castBackLabel('store'), '← Retour au vidéoclub');
});

test('CAST LIBELLÉS: le temps, en m:ss puis h:mm:ss', () => {
  assert.equal(formatCastTime(0), '0:00');
  assert.equal(formatCastTime(9), '0:09');
  assert.equal(formatCastTime(59), '0:59');
  assert.equal(formatCastTime(61), '1:01');
  assert.equal(formatCastTime(600), '10:00');
  assert.equal(formatCastTime(3599), '59:59');
  assert.equal(formatCastTime(3600), '1:00:00');
  assert.equal(formatCastTime(3725), '1:02:05');
  // Les secondes se tronquent, elles ne s'arrondissent pas : 59,9 s n'est pas encore une minute.
  assert.equal(formatCastTime(59.9), '0:59');
});

test('CAST LIBELLÉS: un temps que la TV n\'a pas donné s\'affiche 0:00, pas NaN', () => {
  assert.equal(formatCastTime(NaN), '0:00');
  assert.equal(formatCastTime(Infinity), '0:00');
  assert.equal(formatCastTime(-5), '0:00');
});

test('CAST LIBELLÉS: la puce n\'a un point que si elle a quelque chose à dire, et ne respire que télécommande allumée', () => {
  // Vert qui clignote : la télécommande est vivante. Orange fixe : la TV ne répond plus. Rien : le film est fini.
  assert.deepEqual(castChipLook('remote'), { dot: 'live', pulse: true });
  assert.deepEqual(castChipLook('lost'), { dot: 'warn', pulse: false });
  assert.deepEqual(castChipLook('ended'), { dot: null, pulse: false });
  for (const phase of ['idle', 'choosing', 'connecting', 'loading']) assert.deepEqual(castChipLook(phase), { dot: null, pulse: false }, phase);
});

test('CAST VOLUME: le curseur montre le doigt tant que la TV n\'a pas répondu, puis la TV', () => {
  assert.equal(volumeShown(null, 0.28), 0.28);
  // Geste fait quand la TV était à 0,28 : il se voit tant qu\'elle y est encore.
  assert.equal(volumeShown({ level: 0.8, base: 0.28 }, 0.28), 0.8);
  // La TV a répondu (son volume a changé) : sa valeur reprend la main, jamais une valeur qu\'elle n\'a pas.
  assert.equal(volumeShown({ level: 0.8, base: 0.28 }, 0.8), 0.8);
  assert.equal(volumeShown({ level: 0.8, base: 0.28 }, 0.5), 0.5);
});

const idle = { busy: false, tvVolume: 0.28 };

test('CAST VOLUME: rien ne part pendant le geste, une seule commande au relâchement', () => {
  let g = volumeDragged(0.4);
  // Le doigt bouge : plusieurs valeurs, aucune commande.
  g = volumeDragged(0.55);
  let r = volumeSettle(g, { release: false, ...idle });
  assert.equal(r.send, null);
  assert.deepEqual(r.gesture, g, 'le geste continue');
  // Le doigt se lève : une commande, la dernière valeur.
  r = volumeSettle(g, { release: true, ...idle });
  assert.equal(r.send, 0.55);
  assert.deepEqual(r.gesture, NO_VOLUME_GESTURE);
  // pointerup, touchend, keyup et blur se suivent : aucun ne renvoie la valeur.
  for (let i = 0; i < 4; i += 1) {
    const again = volumeSettle(r.gesture, { release: true, ...idle });
    assert.equal(again.send, null, `événement ${i + 2}`);
    assert.equal(again.clear, false);
  }
});

test('CAST VOLUME: relâché pendant qu\'une commande est en vol, il part dès que la TV a accusé, la dernière valeur gagne', () => {
  let r = volumeSettle(volumeDragged(0.4), { release: true, busy: true, tvVolume: 0.28 });
  assert.equal(r.send, null, 'en vol : on attend');
  assert.equal(r.gesture.pending, 0.4, 'la valeur est gardée');
  assert.equal(r.gesture.released, true, 'et le doigt est bien levé');
  // Un nouveau geste remplace la valeur gardée.
  const next = volumeDragged(0.7);
  r = volumeSettle(next, { release: true, busy: true, tvVolume: 0.28 });
  assert.equal(r.send, null);
  // L\'accusé arrive : busy retombe, sans nouvel événement du doigt.
  r = volumeSettle(r.gesture, { release: false, busy: false, tvVolume: 0.28 });
  assert.equal(r.send, 0.7, 'la dernière valeur demandée, pas la première');
  assert.deepEqual(r.gesture, NO_VOLUME_GESTURE);
});

test('CAST VOLUME: tant que le doigt est posé, une commande qui retombe n\'envoie rien', () => {
  const dragging = volumeDragged(0.6);
  const r = volumeSettle(dragging, { release: false, busy: false, tvVolume: 0.28 });
  assert.equal(r.send, null);
  assert.deepEqual(r.gesture, dragging);
});

test('CAST VOLUME: relâcher sur le volume de la TV n\'envoie rien et rend le curseur à la TV', () => {
  const r = volumeSettle(volumeDragged(0.28), { release: true, busy: false, tvVolume: 0.28 });
  assert.equal(r.send, null);
  assert.equal(r.clear, true);
  assert.deepEqual(r.gesture, NO_VOLUME_GESTURE);
  // Sans geste, il n\'y a rien à rendre : le curseur n\'est pas touché.
  const none = volumeSettle(NO_VOLUME_GESTURE, { release: true, ...idle });
  assert.equal(none.send, null);
  assert.equal(none.clear, false);
});
