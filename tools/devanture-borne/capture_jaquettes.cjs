// Capture des TRANCHES des jaquettes du vidéoclub, telles que l'application les dessine (src/utils/VHSCoverGenerator.ts),
// pour la borne : distribution_tranches_site.py en fait les images que la page pose sur la K7 servie.
//
//   node capture_jaquettes.cjs <adresse du site en développement> <dossier de sortie> [<tmdb> …]
//   ex. : npx next dev -p 3003   puis   node capture_jaquettes.cjs http://localhost:3003/ travail/tex/tranches-site-src
//
// Sans identifiant : tout le catalogue chargé par le site. Un film déjà capturé n'est pas refait (reprise après arrêt).
// Le site doit tourner en DÉVELOPPEMENT (window.__store n'existe pas en production). Pour chaque film on ouvre sa K7
// (selectFilm), on attend que la toile de 1536 points du générateur ne change plus (le logo du film et celui du studio
// arrivent de TMDB après le premier dessin), puis on découpe SPINE2 (x 512, y 117, 102 × 712 à l'échelle 1,5).
// La découpe est en miroir, comme la toile : c'est la fabrique qui la redresse.
const { chromium } = require('/Users/rusmirsadikovic/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [url, sortie, ...ids] = process.argv.slice(2);
const TOILE = 1536, SPINE = { x: 768, y: 175, w: 153, h: 1068 };

(async () => {
  fs.mkdirSync(sortie, { recursive: true });
  // Le vrai Chrome : la scène du vidéoclub exige WebGPU.
  const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.setDefaultTimeout(180000);
  p.on('pageerror', e => console.log('ERREUR PAGE', String(e).slice(0, 200)));
  await p.addInitScript(() => {
    const cree = document.createElement.bind(document);
    window.__toiles = [];
    document.createElement = function (nom, ...r) {
      const e = cree(nom, ...r);
      if (String(nom).toLowerCase() === 'canvas') window.__toiles.push(e);
      return e;
    };
  });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__store);
  await p.evaluate(() => window.__store.getState().setScene('interior'));
  await p.waitForFunction(() => window.__store.getState().isSceneReady === true);
  await p.waitForFunction(() => Object.values(window.__store.getState().films).flat().length > 50);
  const tous = await p.evaluate(() => [...new Set(Object.values(window.__store.getState().films).flat().map(f => f.tmdb_id))]);
  const liste = (ids.length ? ids.map(Number) : tous).filter(t => !fs.existsSync(`${sortie}/${t}.png`));
  console.log('SCÈNE PRÊTE —', tous.length, 'films au catalogue,', liste.length, 'à capturer');
  let faits = 0;
  for (const tmdb of liste) {
    const avant = await p.evaluate(() => window.__toiles.length);
    const titre = await p.evaluate((t) => {
      const s = window.__store.getState();
      const f = Object.values(s.films).flat().find(f => f.tmdb_id === t);
      if (f) s.selectFilm(f.id);
      return f ? f.title : null;
    }, tmdb);
    if (!titre) { console.log('ABSENT', tmdb); continue; }
    // La première toile de 1536 points créée pour ce film est la couleur (la seconde est son relief). On attend que
    // sa tranche ne change plus pendant 3 s, 12 s au plus.
    let data = null, derniere = '', stable = 0;
    for (let k = 0; k < 24; k++) {
      await p.waitForTimeout(500);
      const d = await p.evaluate(({ n, T, S }) => {
        const c = window.__toiles.slice(n).find(c => c.width === T && c.height === T);
        if (!c) return null;
        const d = window.__decoupe || (window.__decoupe = Object.assign(new OffscreenCanvas(S.w, S.h), {}));
        const g = d.getContext('2d');
        g.clearRect(0, 0, S.w, S.h);
        g.drawImage(c, S.x, S.y, S.w, S.h, 0, 0, S.w, S.h);
        const px = g.getImageData(0, 0, S.w, S.h).data;
        let s = '';
        for (let i = 0; i < px.length; i += 4096) s += String.fromCharCode(px.subarray(i, Math.min(i + 4096, px.length)).reduce((a, v) => (a + v) & 0xffff, 0));
        return { somme: s };
      }, { n: avant, T: TOILE, S: SPINE });
      if (d && d.somme === derniere) stable++; else stable = 0;
      derniere = d ? d.somme : '';
      if (d && stable >= 6) break;
    }
    if (derniere) {
      data = await p.evaluate(async () => {
        const blob = await window.__decoupe.convertToBlob({ type: 'image/png' });
        return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
      });
    }
    if (data) { fs.writeFileSync(`${sortie}/${tmdb}.png`, Buffer.from(data.split(',')[1], 'base64')); faits++; }
    console.log(data ? 'FILM' : 'ÉCHEC', tmdb, titre);
    await p.evaluate(() => window.__store.getState().selectFilm(null));
    await p.waitForTimeout(300);
  }
  console.log('FINI —', faits, 'tranches écrites dans', sortie);
  await b.close();
})().catch(e => { console.log('ÉCHEC', e); process.exit(1); });
