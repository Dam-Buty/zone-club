// Bout en bout — le film du retour de la K7 dans la borne (spec 2026-11-26-borne-retour-k7-design, § 5).
//   E2E_URL=http://localhost:3003/ node tests/e2e/borne-retour.e2e.cjs     (vrai Chrome, base locale du worktree)
//   E2E_COMPTE=<compte de test>   réutilise un compte (l'inscription est limitée à 3 par quart d'heure)
// Ce que ces tests prouvent : « Rendre » de « Mon compte » joue le film du retour après la réponse du serveur ; la
// tranche du film rendu est sur la K7 tant qu'elle est visible, à sa place, puis retirée une fois la K7 avalée ; le
// vrai écran de la borne est dans l'écran filmé, et revient à sa place à la fin ; le message « K7 rendue » vient après.
// Et les cas sans film : appui, geste retour, animations réduites. Captures dans tests/e2e/captures/ (hors dépôt).
const { lance, visiteur, RACINE, fs, path } = require('./outils.cjs');

const CAP = path.join(__dirname, 'captures');
fs.mkdirSync(CAP, { recursive: true });
const SUIVI = JSON.parse(fs.readFileSync(path.join(RACINE, 'public/kiosk-retour-suivi.json'), 'utf8'));
const FILMS = ['Get Out', 'Shutter Island', 'Imitation Game', 'Her'];
let ok = 0, ko = 0;
const dit = (bon, texte) => { if (bon) ok += 1; else ko += 1; console.log(`${bon ? 'OK   ' : 'ÉCHEC'} ${texte}`); };
const arr = (v) => Math.round(v * 100) / 100;

// Les deux calques de film sont montés ensemble : celui du retour est le second.
const etat = (page) => page.evaluate(() => {
  const calques = [...document.querySelectorAll('[class*="KioskDistributionFilm_film__"]')];
  const c = calques[1];
  const v = c && c.querySelector('video');
  const b = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const tr = c && c.querySelector('[data-testid="distribution-tranche"]'), ks = document.querySelector('[class*="KioskView_ks__"]');
  return {
    t: v ? v.currentTime : -1, pause: v ? v.paused : null, montre: !!(c && c.className.includes('filmShown')),
    cadre: b(c && c.querySelector('[class*="KioskDistributionFilm_stage__"]')),
    tranche: b(tr), trancheVisible: tr ? getComputedStyle(tr).visibility === 'visible' : false,
    img: tr ? [...tr.querySelectorAll('img')].map((i) => i.getAttribute('src')) : [],
    ecran: b(ks), transformation: ks ? ks.style.transform : '',
    rendue: document.body.innerText.includes('K7 rendue'), borne: !!ks,
  };
});
const choisis = async (page, titre) => {
  await page.locator(`button[class*="kRailItem"][aria-label="${titre}"]`).first().evaluate((e) => e.click());
  await page.waitForTimeout(700);
};
// Loue le film par la borne, passe le film de distribution, ferme le panneau.
const loue = async (page, titre) => {
  await choisis(page, titre);
  await page.locator('button[class*="kLouer"]').first().tap();
  const bouton = page.locator('[class*="kNotice"] button', { hasText: /^Louer$/ }).first();
  await bouton.waitFor();
  await bouton.tap();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('button', { hasText: 'Plus tard' }).first().waitFor({ timeout: 15000 });
  await page.locator('button', { hasText: 'Plus tard' }).first().tap();
  await page.waitForTimeout(500);
};
// « Compte », puis « Rendre » sur la ligne du film, puis la confirmation. Rend le bouton de confirmation (pas encore appuyé).
const demandeRetour = async (page, titre) => {
  if (!(await page.locator('button', { hasText: /^(Rendre|Retour…)$/ }).count())) {
    await page.locator('button[class*="kNavBtn"]', { hasText: 'Compte' }).first().tap();
    await page.waitForTimeout(800);
  }
  const ligne = page.locator('[class*="kAccountRow"]', { hasText: titre }).locator('button', { hasText: /^Rendre$/ }).first();
  await ligne.tap();
  const bouton = page.locator('[class*="kNotice"] button', { hasText: /^Rendre$/ }).first();
  await bouton.waitFor();
  // La question ouverte, la vidéo du retour se télécharge.
  await page.waitForFunction(() => { const v = document.querySelectorAll('[class*="KioskDistributionFilm_film__"] video')[1]; return v && v.src.startsWith('blob:') && v.readyState >= 3; }, null, { timeout: 10000 }).catch(() => {});
  return bouton;
};
const suis = async (page, { agir } = {}) => {
  const vu = { montre: false, max: 0, agi: false, tranches: new Set(), visibles: 0 };
  const t0 = Date.now();
  while (Date.now() - t0 < 14000) {
    const e = await etat(page);
    if (e.montre) { vu.montre = true; vu.max = Math.max(vu.max, e.t); if (e.trancheVisible) { vu.visibles += 1; vu.tranches.add(e.img.join(',')); } }
    if (agir && e.montre && e.t >= agir.a && !vu.agi) { vu.agi = true; vu.tAgi = Date.now(); await agir.fais(page); }
    if (e.rendue) { vu.rendue = Date.now() - t0; vu.fin = e; if (vu.agi) vu.apresAgi = Date.now() - vu.tAgi; break; }
    await page.waitForTimeout(50);
  }
  return vu;
};
const va = async (page, i) => {
  await page.evaluate((t) => new Promise((res) => {
    const v = document.querySelectorAll('[class*="KioskDistributionFilm_film__"] video')[1];
    v.pause();
    v.requestVideoFrameCallback(() => requestAnimationFrame(() => requestAnimationFrame(res)));
    v.currentTime = t;
  }), i / SUIVI.ips + 0.004);
  await page.waitForTimeout(80);
};
const attendu = (boite, cadre) => [cadre[0] + boite[0] * cadre[2], cadre[1] + boite[1] * cadre[3], (boite[2] - boite[0]) * cadre[2], (boite[3] - boite[1]) * cadre[3]];
const distance = (a, c) => Math.max(...a.map((v, k) => Math.abs(v - c[k])));
const ferme = async (page) => { await page.locator('[class*="kNotice"] button', { hasText: /^(Fermer|Écrire ma critique)$/ }).first().waitFor(); await page.locator('[class*="kNotice"] button', { hasText: /^Fermer$/ }).first().tap(); await page.waitForTimeout(400); };

(async () => {
  const b = await lance();
  const { page, compte } = await visiteur(b);
  console.log('compte de test :', compte);
  for (const titre of FILMS) await loue(page, titre);
  const tmdb = await page.evaluate(async (t) => { const r = await fetch('/api/films'); const j = await r.json(); const l = Array.isArray(j) ? j : Object.values(j).flat(); return (l.find((f) => f.title === t) || {}).tmdb_id; }, FILMS[0]);

  // 1-3. Le film joue, la tranche du film rendu suit la K7, l'écran revient à sa place, puis « K7 rendue ».
  const avant = (await etat(page)).ecran;
  const bouton = await demandeRetour(page, FILMS[0]);
  const avantCompte = (await etat(page)).ecran;
  await bouton.tap();
  await page.waitForFunction(() => { const c = document.querySelectorAll('[class*="KioskDistributionFilm_film__"]')[1]; return c && c.className.includes('filmShown'); }, null, { timeout: 6000 }).catch(() => {});
  let pirePlace = 0, pireEcran = 0, cachees = 0;
  for (const i of [0, 45, 63, 70, 78, 84, 95, 120]) {
    await va(page, i);
    const e = await etat(page);
    const pas = SUIVI.pas[i];
    pireEcran = Math.max(pireEcran, distance(e.ecran, attendu(pas.e, e.cadre)));
    if (pas.t === null) { if (!e.trancheVisible) cachees += 1; } else pirePlace = Math.max(pirePlace, distance(e.tranche, attendu(pas.t, e.cadre)));
    if (i === 0) dit(distance(e.ecran, avantCompte) <= 0.5, `3  à la première image le vrai écran n'a pas bougé (${arr(distance(e.ecran, avantCompte))} pt)`);
    await page.screenshot({ path: path.join(CAP, `retour-image-${String(i).padStart(4, '0')}.png`) });
  }
  await va(page, 70);
  const e70 = await etat(page);
  dit(e70.trancheVisible && e70.img.some((s) => s === `/kiosk-tranches/${tmdb}-c.webp`), `2  la tranche du film rendu est sur la K7 (${e70.img.join(' | ')})`);
  dit(pirePlace <= 1.5, `2  la tranche est à sa place à chaque image (au pire ${arr(pirePlace)} pt)`);
  dit(cachees === 3, `2  une fois la K7 avalée, la tranche n'est plus posée (${cachees} images sur 3)`);
  dit(pireEcran <= 1, `3  le vrai écran est dans la boîte de l'écran filmé (au pire ${arr(pireEcran)} pt)`);
  await page.evaluate(() => { const v = document.querySelectorAll('[class*="KioskDistributionFilm_film__"] video')[1]; v.currentTime = 5.0; return v.play(); });
  const vu1 = await suis(page);
  dit(vu1.rendue > 0, '1  le film va au bout, puis « K7 rendue »');
  const fin = await etat(page);
  dit(fin.transformation === '' && distance(fin.ecran, avant) <= 0.5, `3  après le film l'écran est revenu à sa place (transformation « ${fin.transformation} »)`);
  await page.screenshot({ path: path.join(CAP, 'retour-fin.png') });
  await ferme(page);

  // 4. Un appui pendant le film : le message vient aussitôt.
  await (await demandeRetour(page, FILMS[1])).tap();
  const vu4 = await suis(page, { agir: { a: 1.5, fais: (p) => p.touchscreen.tap(206, 300) } });
  dit(vu4.montre && vu4.agi && vu4.rendue > 0 && vu4.apresAgi < 800 && vu4.fin.transformation === '', `4  appui à 1,5 s : « K7 rendue » ${vu4.apresAgi} ms après, écran remis en place`);
  await ferme(page);

  // 5. Le geste retour pendant le film : il le passe, la borne reste ouverte.
  await (await demandeRetour(page, FILMS[2])).tap();
  const vu5 = await suis(page, { agir: { a: 1.5, fais: (p) => p.goBack().catch(() => {}) } });
  dit(vu5.montre && vu5.agi && vu5.rendue > 0 && vu5.fin.borne && vu5.fin.transformation === '', `5  geste retour à 1,5 s : « K7 rendue » ${vu5.apresAgi} ms après, toujours dans la borne`);
  await ferme(page);

  // 6. Moins de mouvement demandé : pas de film, le message tout de suite.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await (await demandeRetour(page, FILMS[3])).tap();
  const vu6 = await suis(page);
  dit(!vu6.montre && vu6.rendue > 0 && vu6.rendue < 3000, `6  animations réduites : pas de film, « K7 rendue » en ${vu6.rendue} ms`);
  await page.emulateMedia({ reducedMotion: null });

  dit(page.erreurs.length === 0, `aucune erreur dans la page (${page.erreurs.join(' | ')})`);
  console.log(`\n${ok} OK, ${ko} ÉCHEC`);
  await b.close();
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
