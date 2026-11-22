// Enregistre la page pendant une location dans la borne (vidéo de l'écran du téléphone simulé), pour la montrer.
//   node tests/e2e/enregistre.cjs [<titre du film dans la bande>] [<dossier de sortie>]
// Reprend la session du test de bout en bout (tests/e2e/captures/session.json) : lancer d'abord npm run test:e2e:borne.
const { lance, entre, sql, fs, path } = require('./outils.cjs');
const titre = process.argv[2] || 'Get Out';
const sortie = process.argv[3] || path.join(__dirname, 'captures', 'video');
(async () => {
  sql("update rentals set is_active = 0 where user_id in (select id from users where username glob 'e2e[0-9]*' or username glob 'verif[0-9]*')");
  const b = await lance();
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', storageState: path.join(__dirname, 'captures', 'session.json'), recordVideo: { dir: sortie, size: { width: 412, height: 915 } } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(process.env.E2E_URL || 'http://localhost:3002/', { waitUntil: 'load' });
  await entre(page);
  await page.locator(`button[class*="kRailItem"][aria-label="${titre}"]`).first().evaluate((e) => e.click());
  await page.waitForTimeout(1200);
  await page.locator('button[class*="kLouer"]').first().tap();
  const bouton = page.locator('[class*="kNotice"] button', { hasText: /^Louer$/ }).first();
  await bouton.waitFor();
  await page.waitForTimeout(2500);
  await bouton.tap();
  await page.waitForFunction(() => document.body.innerText.includes('Votre K7 est prête'), null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  const video = await page.video().path();
  await ctx.close();
  await b.close();
  console.log(video);
})().catch((e) => { console.log('ÉCHEC', e); process.exit(1); });
