// Capture des toiles du générateur de jaquettes (échelle provisoire 4 → 4096 points) pour quelques films.
const { chromium } = require('/Users/rusmirsadikovic/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core');
const fs = require('fs');
const [url, sortie, ...ids] = process.argv.slice(2);
(async () => {
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
  console.log('SCÈNE PRÊTE');
  for (const tmdb of ids.map(Number)) {
    const avant = await p.evaluate(() => window.__toiles.length);
    const film = await p.evaluate((t) => {
      const s = window.__store.getState();
      const f = Object.values(s.films).flat().find(f => f.tmdb_id === t);
      if (f) s.selectFilm(f.id);
      return f ? f.title : null;
    }, tmdb);
    if (!film) { console.log('ABSENT', tmdb); continue; }
    await p.waitForTimeout(9000);
    const toiles = await p.evaluate((n) => window.__toiles.map((c, i) => ({ i, w: c.width, h: c.height })).filter(c => c.i >= n && c.w >= 4000), avant);
    let k = 0;
    for (const t of toiles) {
      const data = await p.evaluate((i) => { try { return window.__toiles[i].toDataURL('image/png'); } catch (e) { return 'ERR ' + e; } }, t.i);
      if (!data.startsWith('data:')) { console.log('  toile', t.i, data.slice(0, 80)); continue; }
      fs.writeFileSync(`${sortie}/${tmdb}-${t.i}.png`, Buffer.from(data.split(',')[1], 'base64'));
      k++;
    }
    console.log('FILM', tmdb, film, 'toiles 4096 :', toiles.map(t => t.i).join(','), 'écrites', k);
    await p.evaluate(() => window.__store.getState().selectFilm(null));
    await p.waitForTimeout(800);
  }
  await b.close();
})().catch(e => { console.log('ÉCHEC', e); process.exit(1); });
