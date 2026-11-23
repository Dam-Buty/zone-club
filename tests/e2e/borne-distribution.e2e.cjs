// Bout en bout — la distribution filmée de la K7 dans la borne (spec 2026-11-17, § 13).
//   npm run test:e2e:borne        (build de production servi sur le port 3002, vrai Chrome, base locale)
//   E2E_COMPTE=<compte de test>   réutilise un compte (l'inscription est limitée à 3 par quart d'heure)
// Ce que ces tests prouvent : la vidéo joue après une location ; la tranche du film loué est sur la K7 à chaque image,
// à sa place et semblable à l'image de référence (tests/e2e/reference/, fabriquée par
// tools/devanture-borne/distribution_reference.py) ; l'écran filmé est le vrai écran de la borne, remis à sa place à
// la fin ; et tous les cas où la vidéo ne doit pas jouer. Captures dans tests/e2e/captures/ (hors dépôt).
const { lance, visiteur, entre, ecart, RACINE, fs, path } = require('./outils.cjs');

const CAP = path.join(__dirname, 'captures');
fs.mkdirSync(CAP, { recursive: true });
const SUIVI = JSON.parse(fs.readFileSync(path.join(RACINE, 'public/kiosk-distribution-suivi.json'), 'utf8'));
const FILM = JSON.parse(fs.readFileSync(path.join(RACINE, 'src/data/kiosk-distribution.json'), 'utf8')).film;
const REFERENCE = { tmdb: 419430, titre: 'Get Out', images: [30, 56, 72, 90, 118, 124, 154] };   // le film des images de référence, choisi par son titre
// Écart toléré avec la référence, en niveaux sur 255, en moyenne dans la boîte de la K7 (grille grossière, voir
// ecart.py). La référence est un collage en lumière linéaire sur les images d'origine ; la page n'a qu'une image, un
// masque et un voile noir, par-dessus une vidéo compressée : mesuré de 3 à 9 le 23/11/2026, biais de luminosité de
// −3 à +1. Au-delà de 10, quelque chose est cassé (tranche absente : ~40 ; cache absent : ~25).
const ECART_MAX = 10;
let ok = 0, ko = 0;
const dit = (bon, texte) => { if (bon) ok += 1; else ko += 1; console.log(`${bon ? 'OK   ' : 'ÉCHEC'} ${texte}`); };
const arr = (v) => Math.round(v * 100) / 100;

const etat = (page) => page.evaluate(() => {
  const v = document.querySelector('video[class*="KioskDistributionFilm"]');
  const b = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const tr = document.querySelector('[data-testid="distribution-tranche"]'), ks = document.querySelector('[class*="KioskView_ks__"]');
  return {
    t: v ? v.currentTime : -1, pause: v ? v.paused : null, muet: v ? v.muted : null,
    montre: !!document.querySelector('[class*="filmShown"]'), cadre: b(document.querySelector('[class*="KioskDistributionFilm_stage__"]')),
    tranche: b(tr), trancheVisible: tr ? getComputedStyle(tr).visibility === 'visible' : false,
    img: tr ? [...tr.querySelectorAll('img')].map((i) => i.getAttribute('src')) : [], titre: tr ? (tr.querySelector('span') || {}).textContent || '' : '',
    ecran: b(ks), transformation: ks ? ks.style.transform : '', rognage: ks ? ks.style.clipPath : '',
    signe: !!document.querySelector('[aria-label="Son coupé"]'), pret: document.body.innerText.includes('Votre K7 est prête'), borne: !!ks,
  };
});
const choisis = async (page, titre) => {      // les K7 de la bande sont des boutons sans texte, nommés par aria-label
  await page.locator(`button[class*="kRailItem"][aria-label="${titre}"]`).first().evaluate((e) => e.click());
  await page.waitForTimeout(700);
};
const loue = async (page) => {
  await page.locator('button[class*="kLouer"]').first().tap();
  const bouton = page.locator('[class*="kNotice"] button', { hasText: /^Louer$/ }).first();
  await bouton.waitFor();
  return bouton;
};
const plusTard = async (page) => { await page.locator('button', { hasText: 'Plus tard' }).first().tap(); await page.waitForTimeout(500); };
const pretes = (page) => page.waitForFunction(() => { const v = document.querySelector('video[class*="KioskDistributionFilm"]'); return v && v.src.startsWith('blob:') && v.readyState >= 3; }, null, { timeout: 10000 }).then(() => true).catch(() => false);
// Suit la vidéo jusqu'au panneau ; `agir` : une action à faire quand la vidéo atteint l'instant `a`.
const suis = async (page, { agir } = {}) => {
  const vu = { montre: false, max: 0, muet: false, signe: false, agi: false, tranches: new Set() };
  const t0 = Date.now();
  while (Date.now() - t0 < 16000) {
    const e = await etat(page);
    if (e.montre) { vu.montre = true; vu.max = Math.max(vu.max, e.t); vu.muet = vu.muet || e.muet; vu.signe = vu.signe || e.signe; if (e.trancheVisible) { vu.tranches.add(e.img.join(',')); vu.titre = e.titre || vu.titre; } }
    if (agir && e.montre && e.t >= agir.a && !vu.agi) { vu.agi = true; vu.tAgi = Date.now(); await agir.fais(page); }
    if (e.pret) { vu.pret = Date.now() - t0; vu.fin = e; if (vu.agi) vu.apresAgi = Date.now() - vu.tAgi; break; }
    await page.waitForTimeout(50);
  }
  return vu;
};
// Met la vidéo en pause sur l'image i et attend que la page l'ait présentée et suivie.
const va = async (page, i) => {
  await page.evaluate((t) => new Promise((res) => {
    const v = document.querySelector('video[class*="KioskDistributionFilm"]');
    v.pause();
    v.requestVideoFrameCallback(() => requestAnimationFrame(() => requestAnimationFrame(res)));
    v.currentTime = t;
  }), i / SUIVI.ips + 0.004);
  await page.waitForTimeout(80);
};
const attendu = (boite, cadre) => [cadre[0] + boite[0] * cadre[2], cadre[1] + boite[1] * cadre[3], (boite[2] - boite[0]) * cadre[2], (boite[3] - boite[1]) * cadre[3]];
const distance = (a, c) => Math.max(...a.map((v, k) => Math.abs(v - c[k])));

async function illusion(page, nom) {
  // Avant la location : où est le vrai écran.
  const avant = (await etat(page)).ecran;
  await choisis(page, REFERENCE.titre);
  const bouton = await loue(page);
  dit(await pretes(page), `${nom} 1  la vidéo se télécharge dès que la confirmation s'ouvre`);
  await bouton.tap();
  await page.waitForFunction(() => !!document.querySelector('[class*="filmShown"]'), null, { timeout: 6000 }).catch(() => {});
  let pireEcart = 0, pirePlace = 0, pireEcran = 0;
  const details = [];
  for (const i of [0, ...REFERENCE.images]) {
    await va(page, i);
    const e = await etat(page);
    const pas = SUIVI.pas[i];
    // l'écran : dans la boîte de l'écran filmé (rogné au cadre) ; à l'image 0, il n'a pas bougé
    const de = distance(e.ecran, attendu(pas.e, e.cadre));
    pireEcran = Math.max(pireEcran, de);
    if (i === 0) { dit(distance(e.ecran, avant) <= 0.5, `${nom} 3  à la première image le vrai écran n'a pas bougé (${arr(distance(e.ecran, avant))} pt)`); continue; }
    const dp = distance(e.tranche, attendu(pas.t, e.cadre));
    pirePlace = Math.max(pirePlace, dp);
    const fichier = path.join(CAP, `${nom}-image-${String(i).padStart(4, '0')}.png`);
    const c = e.cadre;
    // La capture est la part VISIBLE du cadre (il déborde de la fenêtre) : on la compare à la même part de la référence.
    const vp = page.viewportSize();
    const x0 = Math.max(0, c[0]), y0 = Math.max(0, c[1]), x1 = Math.min(vp.width, c[0] + c[2]), y1 = Math.min(vp.height, c[1] + c[3]);
    await page.screenshot({ path: fichier, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
    const vis = [(x0 - c[0]) / c[2], (y0 - c[1]) / c[3], (x1 - c[0]) / c[2], (y1 - c[1]) / c[3]];
    const ref = path.join(__dirname, 'reference', `ref-${String(i).padStart(4, '0')}.jpg`);
    const boite = [(pas.t[0] - vis[0]) / (vis[2] - vis[0]), (pas.t[1] - vis[1]) / (vis[3] - vis[1]), (pas.t[2] - vis[0]) / (vis[2] - vis[0]), (pas.t[3] - vis[1]) / (vis[3] - vis[1])];
    const refRecadree = path.join(CAP, `${nom}-ref-${String(i).padStart(4, '0')}.png`);
    require('child_process').execFileSync('python3', ['-c', `from PIL import Image; im=Image.open(r'${ref}'); w,h=im.size; im.crop((round(${vis[0]}*w),round(${vis[1]}*h),round(${vis[2]}*w),round(${vis[3]}*h))).save(r'${refRecadree}')`]);
    const [ec, biais] = ecart(fichier, refRecadree, boite);
    pireEcart = Math.max(pireEcart, ec);
    details.push(`${i}:${ec}(${biais >= 0 ? '+' : ''}${biais})`);
  }
  dit(pireEcart <= ECART_MAX, `${nom} 2  illusion : écart à la référence dans la boîte de la K7 ≤ ${ECART_MAX} niveaux (par image, écart et biais : ${details.join(' ')})`);
  dit(pirePlace <= 1.5, `${nom} 2  la tranche est à sa place à chaque image (au pire ${arr(pirePlace)} pt)`);
  dit(pireEcran <= 1, `${nom} 3  le vrai écran est dans la boîte de l'écran filmé (au pire ${arr(pireEcran)} pt)`);
  // On laisse finir : panneau, écran revenu à sa place, plus aucune transformation.
  await page.evaluate(() => { const v = document.querySelector('video[class*="KioskDistributionFilm"]'); v.currentTime = 7.2; return v.play(); });
  const vu = await suis(page);
  dit(vu.pret > 0, `${nom} 1  la vidéo va au bout et le panneau « Votre K7 est prête » s'ouvre`);
  const fin = await etat(page);
  dit(fin.transformation === '' && fin.rognage === '' && distance(fin.ecran, avant) <= 0.5, `${nom} 3  après la vidéo l'écran est revenu exactement à sa place (transformation « ${fin.transformation} »)`);
  await plusTard(page);
}

(async () => {
  const b = await lance(['--autoplay-policy=document-user-activation-required']);
  const { page, compte } = await visiteur(b);
  console.log('compte de test :', compte);

  await illusion(page, 'tel-412');

  // 4. Un autre film : une autre tranche, vue pendant tout le trajet.
  await choisis(page, 'Shutter Island');
  await (await loue(page)).tap();
  const vu4 = await suis(page);
  dit(vu4.montre && vu4.max > 7.5 && [...vu4.tranches].length === 1 && /\/kiosk-tranches\/\d+\.webp/.test([...vu4.tranches][0]) && ![...vu4.tranches][0].includes(String(REFERENCE.tmdb)), `4  autre film : vidéo jouée jusqu'à ${arr(vu4.max)} s avec la tranche ${[...vu4.tranches].join(' | ')}`);
  await plusTard(page);

  // 5. Un appui pendant la vidéo.
  await choisis(page, 'Imitation Game');
  await (await loue(page)).tap();
  const vu5 = await suis(page, { agir: { a: 2.0, fais: (p) => p.touchscreen.tap(206, 300) } });
  dit(vu5.agi && vu5.pret > 0 && vu5.apresAgi < 800 && vu5.fin.pause === true && vu5.fin.transformation === '', `5  appui à 2 s : panneau ${vu5.apresAgi} ms après, vidéo en pause, écran remis en place`);
  await plusTard(page);

  // 6. Le geste retour pendant la vidéo.
  await choisis(page, 'Ex Machina');
  await (await loue(page)).tap();
  const vu6 = await suis(page, { agir: { a: 2.0, fais: (p) => p.goBack().catch(() => {}) } });
  dit(vu6.agi && vu6.pret > 0 && vu6.fin.borne && vu6.fin.transformation === '', `6  geste retour à 2 s : panneau ${vu6.apresAgi} ms après, toujours dans la borne`);
  await plusTard(page);

  // 7. Moins de mouvement demandé.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await choisis(page, 'Her');
  await (await loue(page)).tap();
  const vu7 = await suis(page);
  dit(!vu7.montre && vu7.pret > 0, `7  animations réduites : pas de vidéo, panneau en ${vu7.pret} ms`);
  await page.emulateMedia({ reducedMotion: null });
  await plusTard(page);

  // 11. Location refusée par le serveur.
  await page.route('**/api/rentals/*', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"refus de test"}' }) : r.continue()));
  await choisis(page, 'Split');
  await (await loue(page)).tap();
  await page.waitForTimeout(2500);
  const e11 = await etat(page);
  dit(!e11.montre && !e11.pret && (await page.evaluate(() => document.body.innerText.includes('Location impossible'))), '11 location refusée : « Location impossible », ni vidéo ni panneau');
  await page.unroute('**/api/rentals/*');

  // 8. Ce qui accompagne la vidéo manque (elle-même, le suivi, une planche) : pas de vidéo, panneau.
  const films8 = ['Insidious', 'Alien : Romulus', 'Une Affaire de famille'];
  for (const [k, motif] of ['**/kiosk-distribution.mp4', '**/kiosk-distribution-suivi.json', '**/kiosk-distribution-caches.webp'].entries()) {
    await page.route(motif, (r) => r.abort());
    await entre(page);
    await choisis(page, films8[k]);
    await (await loue(page)).tap();
    const vu8 = await suis(page);
    dit(!vu8.montre && vu8.pret > 0 && vu8.pret < 5000, `8  ${motif.slice(3)} bloqué : pas de vidéo, panneau en ${vu8.pret} ms`);
    await page.unroute(motif);
  }

  // 9. Tranche du film introuvable : repli avec le titre, pendant tout le trajet.
  await page.route(/\/kiosk-tranches\/\d+\.webp/, (r) => r.fulfill({ status: 404, body: '' }));
  await entre(page);
  await choisis(page, 'It Follows');
  await (await loue(page)).tap();
  const vu9 = await suis(page);
  dit(vu9.montre && [...vu9.tranches].join() === '/kiosk-tranches/repli-1.webp,/kiosk-tranches/repli-1-c.webp' && vu9.titre === 'It Follows', `9  tranche absente : repli « ${vu9.titre} » (${[...vu9.tranches].join(' | ')})`);
  await page.unroute(/\/kiosk-tranches\/\d+\.webp/);

  // 10. Son refusé. Chrome ne le refuse pas ici (un appui passé suffit à sa politique de lecture) ; Safari sur iPhone,
  // lui, exige un appui tout récent, et la vidéo part après la réponse du serveur. On reproduit donc son refus : la
  // lecture sonore est rejetée comme le ferait le navigateur, la lecture muette est laissée passer.
  await entre(page);
  await page.evaluate(() => {
    const lire = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      return this.muted ? lire.call(this) : Promise.reject(new DOMException('lecture sonore refusée (test)', 'NotAllowedError'));
    };
  });
  await choisis(page, 'Les Misérables');
  await (await loue(page)).tap();
  const vu10 = await suis(page, { agir: { a: 1.5, fais: (p) => p.screenshot({ path: path.join(CAP, 'son-coupe.png') }) } });
  dit(vu10.montre && vu10.muet && vu10.signe && vu10.max > 7.5, `10 son refusé : vidéo jouée muette jusqu'à ${arr(vu10.max)} s, signe « son coupé » affiché`);

  dit(page.erreurs.length === 0, `12 erreurs de page : ${page.erreurs.length ? page.erreurs.join(' | ') : 'aucune'}`);

  // Un petit téléphone : le cadre se cale encore sur l'écran.
  const { page: petit } = await visiteur(b, { taille: [360, 640] });
  await illusion(petit, 'tel-360');

  console.log(`\n${ok} OK, ${ko} ÉCHEC — vidéo ${FILM.src}, ${SUIVI.images} images`);
  await b.close();
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.log('ÉCHEC', e); process.exit(1); });
