// Bout en bout — la borne sur tous les types d'écran : de la rue à la K7, téléphones et PC.
//   npm run test:e2e:ecrans       (build de production servi sur le port 3002, vrai Chrome, base locale)
// Lancer d'abord npm run test:e2e:borne : ce test reprend sa session (tests/e2e/captures/session.json).
// Pour chaque écran : le film d'approche va au bout et son écran filmé tombe sur le vrai écran de la borne ; la borne
// s'ouvre sur son écran d'accueil, qui ressemble à celui de la fin du film ; l'accueil tient dans l'écran ; un appui
// ouvre le catalogue ; une location joue la distribution jusqu'au panneau, sans déformer l'écran, la K7 restant dans la
// fenêtre quand elle sort. Captures dans tests/e2e/captures/ecrans/ (hors dépôt).
const { lance, sql, ecart, RACINE, fs, path } = require('./outils.cjs');

const URL0 = process.env.E2E_URL || 'http://localhost:3002/';
const CAP = path.join(__dirname, 'captures', 'ecrans');
fs.mkdirSync(CAP, { recursive: true });
const SESSION = path.join(__dirname, 'captures', 'session.json');
const SUIVI = JSON.parse(fs.readFileSync(path.join(RACINE, 'public/kiosk-distribution-suivi.json'), 'utf8'));
const MISE = { mobile: JSON.parse(fs.readFileSync(path.join(RACINE, 'src/data/storefront-mobile.json'), 'utf8')), pc: JSON.parse(fs.readFileSync(path.join(RACINE, 'src/data/storefront-desktop.json'), 'utf8')) };
// Écart toléré entre la dernière image du film d'approche et la page, dans l'écran de la borne (niveaux sur 255, grille
// grossière d'ecart.py). Le film est une vidéo compressée d'un rendu (vitre, lumière de la rue) ; la page est le vrai
// écran, curseur et voyant en marche. Voir les mesures en tête de la sortie.
const RACCORD_MAX = Number(process.env.E2E_RACCORD_MAX || 22);
const ECRANS = [
  { nom: 'tel-360x640', w: 360, h: 640, mobile: true },
  { nom: 'tel-390x844', w: 390, h: 844, mobile: true },
  { nom: 'tel-412x915', w: 412, h: 915, mobile: true },
  { nom: 'tel-430x932', w: 430, h: 932, mobile: true },
  { nom: 'tablette-768x1024', w: 768, h: 1024, mobile: true },
  { nom: 'pc-1280x720', w: 1280, h: 720, mobile: false },
  { nom: 'pc-1440x900', w: 1440, h: 900, mobile: false },
  { nom: 'pc-1920x1080', w: 1920, h: 1080, mobile: false },
].filter((e) => !process.env.E2E_ECRANS || process.env.E2E_ECRANS.split(',').some((n) => e.nom.includes(n)));

let ok = 0, ko = 0;
const dit = (bon, texte) => { if (bon) ok += 1; else ko += 1; console.log(`${bon ? 'OK   ' : 'ÉCHEC'} ${texte}`); };
const arr = (v) => Math.round(v * 100) / 100;
const KS = '[class*="KioskView_ks__"]';
const ACCUEIL = '[data-testid="borne-accueil"]';
const boite = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, sel);
const dedans = (r, ks, marge = 1) => r && r[0] >= ks[0] - marge && r[1] >= ks[1] - marge && r[0] + r[2] <= ks[0] + ks[2] + marge && r[1] + r[3] <= ks[1] + ks[3] + marge;

async function ecran(b, e) {
  sql("update rentals set is_active = 0 where user_id in (select id from users where username glob 'e2e[0-9]*' or username glob 'verif[0-9]*')");
  const ctx = await b.newContext({ viewport: { width: e.w, height: e.h }, deviceScaleFactor: e.mobile ? 2 : 1, ...(e.mobile ? { hasTouch: true, isMobile: true } : {}), serviceWorkers: 'block', storageState: SESSION });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const erreurs = [];
  page.on('pageerror', (x) => erreurs.push(String(x)));
  const appuie = (loc) => (e.mobile ? loc.tap() : loc.click());
  const n = e.nom;
  try {
    // Toujours partir de la rue : le site se souvient de la scène.
    await page.goto(URL0, { waitUntil: 'load' });
    await page.evaluate(() => { try { localStorage.removeItem('videoclub-storage'); } catch { /* sans stockage */ } });
    await page.goto(URL0, { waitUntil: 'load' });
    const porte = page.locator('button[aria-label="Ouvrir la borne de location"]').first();
    await porte.waitFor({ state: 'attached' });
    await page.waitForTimeout(3000);

    // ----- 1. Le film d'approche -----
    await porte.evaluate((x) => x.click());
    const film = { vu: false, fin: null };
    const t0 = Date.now();
    let avant = null;
    while (Date.now() - t0 < 9000) {
      const s = await page.evaluate((ks) => {
        const v = document.querySelector('video[class*="approachFilm"]');
        const r = v ? v.getBoundingClientRect() : null;
        return { t: v ? v.currentTime : -1, fin: v ? v.ended : false, op: v ? Number(getComputedStyle(v).opacity) : 0, v: r ? [r.left, r.top, r.width, r.height] : null, borne: !!document.querySelector(ks) };
      }, KS);
      if (s.op > 0.9 && s.t > 0.2) film.vu = true;
      if (s.v && s.t >= 2.9 && !s.borne) { film.fin = s.v; avant = await page.screenshot(); }
      if (s.borne) break;
      await page.waitForTimeout(30);
    }
    await page.waitForSelector(KS);
    const ks = await boite(page, KS);
    dit(film.vu && film.fin !== null, `${n} 1  le film d'approche joue jusqu'à la borne`);
    const m = (e.mobile ? MISE.mobile : MISE.pc).approche.ecran;
    if (film.fin) {
      const f = film.fin;
      const filme = [f[0] + m.x0 * f[2], f[1] + m.y0 * f[3], (m.x1 - m.x0) * f[2], (m.y1 - m.y0) * f[3]];
      const pire = Math.max(...filme.map((v, i) => Math.abs(v - ks[i])));
      dit(pire <= 2, `${n} 1  à la fin du film, l'écran filmé tombe sur le vrai écran (au pire ${arr(pire)} pt)`);
    }

    // ----- 2. L'écran d'accueil -----
    await page.waitForSelector(ACCUEIL);
    dit(true, `${n} 2  la borne s'ouvre sur son écran d'accueil`);
    // Le titre de la première jaquette, relevé avant que le défilement ne passe à la suivante.
    const premier = await page.evaluate((acc) => document.querySelector(`${acc} [class*="KioskWelcome_caption__"]`).textContent.trim(), ACCUEIL);
    // Après l'allumage de la dalle (2,8 s) et avant le premier changement de jaquette (3,2 s).
    await page.waitForSelector('[class*="KioskView_kWarm"]', { state: 'detached', timeout: 4000 }).catch(() => {});
    const apres = await page.screenshot();
    if (avant) {
      const fa = path.join(CAP, `${n}-fin-du-film.png`), fp = path.join(CAP, `${n}-accueil.png`);
      fs.writeFileSync(fa, avant); fs.writeFileSync(fp, apres);
      const bx = [ks[0] / e.w, ks[1] / e.h, (ks[0] + ks[2]) / e.w, (ks[1] + ks[3]) / e.h];
      const [ec, biais] = ecart(fp, fa, bx);
      dit(ec <= RACCORD_MAX, `${n} 2  la page ressemble à la fin du film dans l'écran (écart ${ec}, biais ${biais}, seuil ${RACCORD_MAX})`);
    }
    const a = await page.evaluate(({ acc }) => {
      const racine = document.querySelector(acc);
      const r = (el) => { if (!el) return null; const q = el.getBoundingClientRect(); return [q.left, q.top, q.width, q.height]; };
      const un = (c) => racine.querySelector(`[class*="KioskWelcome_${c}__"]`);
      const nom = un('name'), cta = un('cta'), label = un('ctaLabel'), sub = un('ctaSub'), term = un('term');
      return {
        nom: r(nom), term: r(term), cta: r(cta), label: r(label), sub: r(sub), quitter: r(un('quit')), actus: r(un('news')),
        texte: racine.innerText, affiches: [...racine.querySelectorAll('img')].map((i) => ({ ok: i.complete && i.naturalWidth > 0, slot: i.dataset.slot, src: i.getAttribute('src'), b: r(i) })),
        titre: un('caption').textContent.trim(), police: document.fonts.check('20px "VT323"'),
      };
    }, { acc: ACCUEIL });
    dit(a.police && /Club LaZone/.test(a.texte) && /TOUCHEZ L.ÉCRAN/i.test(a.texte) && /pour louer une K7/i.test(a.texte), `${n} 2  « Club LaZone » (police VT323 chargée) et l'invitation sont à l'écran`);
    dit(dedans(a.nom, a.term) && dedans(a.term, ks) && dedans(a.cta, ks) && dedans(a.quitter, ks) && dedans(a.actus, ks), `${n} 2  le nom, les nouveautés, l'invitation et « Quitter » tiennent dans l'écran`);
    dit(a.label[0] >= a.cta[0] && a.sub[0] + a.sub[2] <= a.cta[0] + a.cta[2] + 0.5 && a.label[0] + a.label[2] <= a.sub[0] + 0.5, `${n} 2  le libellé de l'invitation n'est ni coupé ni chevauché`);
    const centre = a.affiches.find((i) => i.slot === '0');
    dit(a.affiches.length >= 1 && a.affiches.every((i) => i.ok) && centre && dedans(centre.b, a.actus), `${n} 2  les jaquettes sont chargées (${a.affiches.length}) et celle du centre tient dans son cadre`);
    const api = await page.evaluate(async () => { const r = await fetch('/api/films/aisle/nouveautes'); const j = await r.json(); return (j.films || j)[0]; });
    dit(api && premier === api.title, `${n} 2  la première jaquette est la dernière nouveauté arrivée (« ${premier} »), sans date dessous`);
    dit(a.quitter[2] >= 40 || a.quitter[3] >= 24, `${n} 2  « Quitter » est assez grand pour être touché (${Math.round(a.quitter[2])} × ${Math.round(a.quitter[3])} pt)`);

    // Le geste retour ne quitte pas la borne.
    await page.goBack().catch(() => {});
    await page.waitForTimeout(500);
    dit((await page.locator(ACCUEIL).count()) === 1 && (await page.locator('[class*="KioskWelcome_quitHint"]').count()) === 1, `${n} 2  geste retour sur l'accueil : toujours dans la borne, « Quitter » s'éclaire`);

    // ----- 3. Un appui ouvre le catalogue -----
    await appuie(page.locator(`${ACCUEIL} [class*="KioskWelcome_enter"]`));
    await page.waitForSelector(ACCUEIL, { state: 'detached' });
    await page.waitForTimeout(600);
    const louer = await boite(page, 'button[class*="kLouer"]');
    dit(dedans(louer, ks), `${n} 3  un appui ouvre le catalogue, « Louer » est dans l'écran`);

    // ----- 4. Une location : la distribution -----
    await page.locator('button[class*="kRailItem"][aria-label="Get Out"]').first().evaluate((x) => x.click());
    await page.waitForTimeout(700);
    await appuie(page.locator('button[class*="kLouer"]').first());
    const bouton = page.locator('[class*="kNotice"] button', { hasText: /^Louer$/ }).first();
    await bouton.waitFor();
    await page.waitForFunction(() => { const v = document.querySelector('video[class*="KioskDistributionFilm"]'); return v && v.src.startsWith('blob:') && v.readyState >= 3; }, null, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);
    await appuie(bouton);
    const d = { vu: false, max: 0, deforme: 0, hors: 0, fente: null, pris: false };
    const t1 = Date.now();
    while (Date.now() - t1 < 16000) {
      const s = await page.evaluate((sel) => {
        const v = document.querySelector('video[class*="KioskDistributionFilm"]');
        const q = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
        return { t: v ? v.currentTime : -1, montre: !!document.querySelector('[class*="filmShown"]'), ks: q(document.querySelector(sel)), tranche: q(document.querySelector('[data-testid="distribution-tranche"]')), visible: (() => { const x = document.querySelector('[data-testid="distribution-tranche"]'); return x ? getComputedStyle(x).visibility === 'visible' : false; })(), pret: document.body.innerText.includes('Votre K7 est prête') };
      }, KS);
      if (s.montre) {
        d.vu = true; d.max = Math.max(d.max, s.t);
        // L'écran ne doit jamais être déformé : mêmes proportions qu'au repos.
        d.deforme = Math.max(d.deforme, Math.abs(s.ks[2] / s.ks[3] - ks[2] / ks[3]) / (ks[2] / ks[3]));
        // La K7 qui sort par la fente (images 141 à 168 : elle est immobile) doit être dans la fenêtre.
        const i = Math.round(s.t * SUIVI.ips);
        if (i >= 141 && i <= 168 && s.visible && s.tranche) {
          d.fente = s.tranche;
          if (s.tranche[0] < -1 || s.tranche[1] < -1 || s.tranche[0] + s.tranche[2] > e.w + 1 || s.tranche[1] + s.tranche[3] > e.h + 1) d.hors += 1;
          if (!d.pris) { d.pris = true; await page.screenshot({ path: path.join(CAP, `${n}-k7-a-la-fente.png`) }); }
        }
      }
      if (s.pret) break;
      await page.waitForTimeout(40);
    }
    dit(d.vu && d.max > 7.5, `${n} 4  la distribution joue jusqu'au bout (${arr(d.max)} s) et le panneau s'ouvre`);
    dit(d.deforme < 0.01, `${n} 4  l'écran de la borne n'est jamais déformé pendant la vidéo (au pire ${arr(d.deforme * 100)} %)`);
    dit(d.fente !== null && d.hors === 0, `${n} 4  la K7 qui sort par la fente est dans la fenêtre${d.fente ? ` (${d.fente.map(Math.round).join(', ')})` : ''}`);
    await page.waitForTimeout(600);
    const fin = await page.evaluate((sel) => { const k = document.querySelector(sel); const r = k.getBoundingClientRect(); return { b: [r.left, r.top, r.width, r.height], tr: k.style.transform }; }, KS);
    dit(fin.tr === '' && fin.b.every((v, i) => Math.abs(v - ks[i]) < 0.5), `${n} 4  après la vidéo l'écran est revenu à sa place`);
    await page.screenshot({ path: path.join(CAP, `${n}-k7-prete.png`) });
    dit(erreurs.length === 0, `${n} 5  erreurs de page : ${erreurs.length ? erreurs[0].slice(0, 120) : 'aucune'}`);
  } catch (x) {
    dit(false, `${n} —  le parcours s'est arrêté : ${String(x).split('\n')[0].slice(0, 160)}`);
    await page.screenshot({ path: path.join(CAP, `${n}-arret.png`) }).catch(() => {});
  }
  await ctx.close();
}

(async () => {
  if (!fs.existsSync(SESSION)) { console.log('ÉCHEC pas de session : lancer d\'abord npm run test:e2e:borne'); process.exit(1); }
  const b = await lance();
  for (const e of ECRANS) await ecran(b, e);
  console.log(`\n${ok} OK, ${ko} ÉCHEC — ${ECRANS.length} écrans`);
  await b.close();
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.log('ÉCHEC', e); process.exit(1); });
