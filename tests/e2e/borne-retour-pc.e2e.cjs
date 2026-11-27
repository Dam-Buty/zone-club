// Bout en bout — le film du retour de la K7 sur PC (spec 2026-11-26-borne-retour-k7-design, § 5 ; variante du PC).
//   E2E_URL=http://localhost:3003/ node tests/e2e/borne-retour-pc.e2e.cjs     (vrai Chrome, fenêtre de 1440 × 900, souris)
// Ce que ces tests prouvent : sur PC, « Rendre » joue le film du PC (1920 × 1020) ; il part du décor de la page et y
// revient SANS changement de lumière — la page est capturée avant le film, à sa première image, à sa dernière et
// après, et comparée zone par zone hors de l'écran (Rusmir, 27/11/2026 : « on cherche l'harmonie ») ; la tranche du
// film rendu est sur la K7, à sa place ; le vrai écran suit l'écran filmé, puis revient. Captures dans
// tests/e2e/captures/ (hors dépôt).
const { lance, sql, ecart, RACINE, URL0, fs, path } = require('./outils.cjs');

const CAP = path.join(__dirname, 'captures');
fs.mkdirSync(CAP, { recursive: true });
const DONNEES = JSON.parse(fs.readFileSync(path.join(RACINE, 'src/data/kiosk-retour.json'), 'utf8')).pc;
const SUIVI = JSON.parse(fs.readFileSync(path.join(RACINE, 'public', DONNEES.suivi), 'utf8'));
const TITRE = process.env.E2E_FILM || 'Get Out';
const FENETRE = { width: 1440, height: 900 };
// Zones de la fenêtre hors de l'écran de la borne (fractions) : la vitrine et le montant de gauche, le montant de
// droite et le mur, et les bandes du haut — où le décor se fond dans le noir de la page, et la vidéo doit en faire autant.
const ZONES = { gauche: [0.01, 0.06, 0.27, 0.94], droite: [0.7, 0.06, 0.99, 0.94], 'haut à gauche': [0.01, 0, 0.27, 0.04], 'haut à droite': [0.7, 0, 0.99, 0.04] };
// La vidéo a la pluie, pas le décor : + 1 niveau environ, mesuré sur le film de location. Au-delà, la lumière a changé.
const BIAIS_MAX = 2, ECART_MAX = 3;
let ok = 0, ko = 0;
const dit = (bon, texte) => { if (bon) ok += 1; else ko += 1; console.log(`${bon ? 'OK   ' : 'ÉCHEC'} ${texte}`); };
const arr = (v) => Math.round(v * 100) / 100;

const etat = (page) => page.evaluate(() => {
  const c = [...document.querySelectorAll('[class*="KioskDistributionFilm_film__"]')][1];
  const v = c && c.querySelector('video');
  const b = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const tr = c && c.querySelector('[data-testid="distribution-tranche"]'), ks = document.querySelector('[class*="KioskView_ks__"]');
  return {
    t: v ? v.currentTime : -1, largeur: v ? v.videoWidth : 0, montre: !!(c && c.className.includes('filmShown')),
    cadre: b(c && c.querySelector('[class*="KioskDistributionFilm_stage__"]')), bords: !!(c && c.querySelector('[data-testid="distribution-bords"]')),
    tranche: b(tr), trancheVisible: tr ? getComputedStyle(tr).visibility === 'visible' : false,
    img: tr ? [...tr.querySelectorAll('img')].map((i) => i.getAttribute('src')) : [],
    ecran: b(ks), transformation: ks ? ks.style.transform : '', rendue: document.body.innerText.includes('K7 rendue'),
  };
});
// Le lecteur ferme le film 1,5 s après sa durée, vidéo en pause ou non (DISTRIBUTION_GUARD_MARGIN_MS) : tout ce qui se
// mesure sur la vidéo arrêtée doit tenir dans ces 7,4 s — d'où l'attente du fondu à la première image seulement, et
// « montre » vérifié à chaque mesure (un film déjà fermé laisserait passer la comparaison de fin : décor contre décor).
const va = async (page, i, attente = 60) => {
  await page.evaluate((t) => new Promise((res) => {
    const v = document.querySelectorAll('[class*="KioskDistributionFilm_film__"] video')[1];
    v.pause();
    v.requestVideoFrameCallback(() => requestAnimationFrame(() => requestAnimationFrame(res)));
    v.currentTime = t;
  }), i / SUIVI.ips + 0.004);
  await page.waitForTimeout(attente);
};
const attendu = (boite, cadre) => [cadre[0] + boite[0] * cadre[2], cadre[1] + boite[1] * cadre[3], (boite[2] - boite[0]) * cadre[2], (boite[3] - boite[1]) * cadre[3]];
const distance = (a, c) => Math.max(...a.map((v, k) => Math.abs(v - c[k])));
const capture = async (page, nom) => { const f = path.join(CAP, `retour-pc-${nom}.png`); await page.screenshot({ path: f }); return f; };
const raccord = (film, decor, quoi) => {
  for (const [nom, boite] of Object.entries(ZONES)) {
    const [e, biais] = ecart(film, decor, boite);
    dit(e <= ECART_MAX && Math.abs(biais) <= BIAIS_MAX, `R  ${quoi}, zone « ${nom} » : écart ${e}, biais ${biais} niveaux (au plus ${ECART_MAX} et ± ${BIAIS_MAX})`);
  }
};

(async () => {
  sql("update rentals set is_active = 0 where user_id in (select id from users where username glob 'e2e[0-9]*' or username glob 'verif[0-9]*')");
  const b = await lance();
  const ctx = await b.newContext({ viewport: FENETRE, deviceScaleFactor: 1, serviceWorkers: 'block', storageState: path.join(CAP, 'session.json') });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(URL0, { waitUntil: 'load' });
  const compte = await page.evaluate(async () => { const r = await fetch('/api/me', { credentials: 'include' }); return r.ok ? ((await r.json()).user || {}).username || null : null; });
  if (!compte) throw new Error('pas de session : lancer d\'abord tests/e2e/borne-retour.e2e.cjs, qui crée le compte de test');
  sql(`update users set credits = 90 where username = '${compte}'`);
  // Dans la borne : par la devanture (film d'approche), ou tout droit si le site s'en souvient.
  await page.waitForSelector('button[aria-label="Ouvrir la borne de location"], [class*="KioskView_ks__"]', { state: 'attached' });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[class*="KioskView_ks__"]').count())) await page.locator('button[aria-label="Ouvrir la borne de location"]').first().click();
  await page.waitForSelector('[class*="KioskView_ks__"]');
  await page.waitForTimeout(4500);
  await page.locator('[data-testid="borne-accueil"] button').first().click();
  await page.waitForSelector('[data-testid="borne-accueil"]', { state: 'detached' });
  dit(await page.evaluate(() => document.querySelector('[class*="KioskView_root__"]').hasAttribute('data-decor')), '0  PC : la borne est montrée dans son décor');

  // Louer, passer le film de location, fermer le panneau.
  await page.locator(`button[class*="kRailItem"][aria-label="${TITRE}"]`).first().evaluate((e) => e.click());
  await page.waitForTimeout(700);
  await page.locator('button[class*="kLouer"]').first().click();
  const louer = page.locator('[class*="kNotice"] button', { hasText: /^Louer$/ }).first();
  await louer.waitFor();
  await louer.click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('button', { hasText: 'Plus tard' }).first().waitFor({ timeout: 20000 });
  await page.locator('button', { hasText: 'Plus tard' }).first().click();
  await page.waitForTimeout(600);
  const tmdb = await page.evaluate(async (t) => { const r = await fetch('/api/films'); const j = await r.json(); const l = Array.isArray(j) ? j : Object.values(j).flat(); return (l.find((f) => f.title === t) || {}).tmdb_id; }, TITRE);

  // « Compte », « Rendre », la question : la vidéo du PC se télécharge.
  const avant = (await etat(page)).ecran;
  await page.locator('button[class*="kNavBtn"]', { hasText: 'Compte' }).first().click();
  await page.waitForTimeout(900);
  await page.locator('[class*="kAccountRow"]', { hasText: TITRE }).locator('button', { hasText: /^Rendre$/ }).first().click();
  const rendre = page.locator('[class*="kNotice"] button', { hasText: /^Rendre$/ }).first();
  await rendre.waitFor();
  await page.waitForFunction(() => { const v = document.querySelectorAll('[class*="KioskDistributionFilm_film__"] video')[1]; return v && v.src.startsWith('blob:') && v.readyState >= 3; }, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const decorAvant = await capture(page, 'A-decor-avant');
  await rendre.click();
  await page.waitForFunction(() => { const c = document.querySelectorAll('[class*="KioskDistributionFilm_film__"]')[1]; return c && c.className.includes('filmShown'); }, null, { timeout: 8000 });

  // 1. Le film du PC, calé sur l'écran ; son départ ne change pas la lumière de la page.
  const depart = Date.now();
  await va(page, 0, 450);          // le fondu d'apparition de la vidéo (280 ms) est fini
  const e0 = await etat(page);
  dit(e0.largeur === DONNEES.film.largeur && e0.bords, `1  le film joué est celui du PC (${e0.largeur} points de large), avec les bords fondus du décor`);
  dit(distance(e0.ecran, avant) <= 0.5, `1  à la première image le vrai écran n'a pas bougé (${arr(distance(e0.ecran, avant))} pt)`);
  raccord(await capture(page, 'B-film-0000'), decorAvant, 'départ du film contre le décor');

  // 2. L'écran suit l'écran filmé ; la tranche du film rendu est sur la K7, à sa place, puis retirée.
  let pirePlace = 0, pireEcran = 0, cachees = 0, posees = 0, montrees = 0, e70 = null;
  const IMAGES = [12, 24, 44, 64, 70, 84, 96, 120];
  for (const i of IMAGES) {
    await va(page, i);
    const e = await etat(page);
    const pas = SUIVI.pas[i];
    if (e.montre) montrees += 1;
    if (i === 70) e70 = e;
    pireEcran = Math.max(pireEcran, distance(e.ecran, attendu(pas.e, e.cadre)));
    if (pas.t === null) { if (!e.trancheVisible) cachees += 1; } else { posees += 1; pirePlace = Math.max(pirePlace, distance(e.tranche, attendu(pas.t, e.cadre))); }
    await capture(page, `image-${String(i).padStart(4, '0')}`);
    if (process.env.E2E_DEBUG) console.log('   ', i, 'cadre', e.cadre.map(arr), 'écran', e.ecran.map(arr), 'attendu', attendu(pas.e, e.cadre).map(arr), 'visible', e.trancheVisible, e.transformation, 'montre', e.montre);
  }
  dit(montrees === IMAGES.length, `2  le film est resté à l'écran pendant les mesures (${montrees} images sur ${IMAGES.length})`);
  dit(e70.trancheVisible && e70.img.some((s) => s === `/kiosk-tranches/${tmdb}-c.webp`), `2  la tranche du film rendu est sur la K7 (${e70.img.join(' | ')})`);
  dit(posees === 5 && pirePlace <= 1.5, `2  la tranche est à sa place à chaque image (${posees} images, au pire ${arr(pirePlace)} pt)`);
  dit(cachees === 3, `2  hors de vue (avant d'entrer, une fois avalée), la tranche n'est pas posée (${cachees} images sur 3)`);
  dit(pireEcran <= 1, `2  le vrai écran est dans la boîte de l'écran filmé (au pire ${arr(pireEcran)} pt)`);

  // 3. La fin : même lumière que le décor, puis « K7 rendue », l'écran à sa place.
  await va(page, SUIVI.images - 1);
  const eDerniere = await etat(page);
  const fin = await capture(page, 'C-film-fin');
  const duree = Date.now() - depart;
  dit(eDerniere.montre && (await etat(page)).montre && distance(eDerniere.ecran, avant) <= 0.5, `3  à la dernière image le film est encore à l'écran et le vrai écran est revenu à sa place (${arr(distance(eDerniere.ecran, avant))} pt ; mesures faites en ${duree} ms)`);
  await page.evaluate(() => { const v = document.querySelectorAll('[class*="KioskDistributionFilm_film__"] video')[1]; return v.play(); });
  await page.waitForFunction(() => document.body.innerText.includes('K7 rendue'), null, { timeout: 15000 });
  await page.waitForTimeout(900);
  const eFin = await etat(page);
  dit(!eFin.montre && eFin.transformation === '' && distance(eFin.ecran, avant) <= 0.5, `3  après le film, « K7 rendue » et l'écran revenu à sa place (transformation « ${eFin.transformation} »)`);
  raccord(fin, await capture(page, 'D-decor-apres'), 'fin du film contre le décor');

  dit(erreurs.length === 0, `aucune erreur dans la page (${erreurs.join(' | ')})`);
  console.log(`\n${ok} OK, ${ko} ÉCHEC`);
  await b.close();
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
