// Outils des tests de bout en bout de la borne : build de production servi sur le port 3002, VRAI Chrome (le Chromium
// de Playwright ne lit pas le H.264). Voir AGENTS.md, « Tests de bout en bout ».
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const URL0 = process.env.E2E_URL || 'http://localhost:3002/';
const MOT_DE_PASSE = 'Verif-2026-borne';

// playwright-core n'est pas une dépendance du dépôt : on le prend là où il est (E2E_PLAYWRIGHT, ou le cache de npx).
function playwright() {
  const pistes = [process.env.E2E_PLAYWRIGHT, 'playwright-core', '/Users/rusmirsadikovic/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core'].filter(Boolean);
  for (const p of pistes) { try { return require(p); } catch { /* piste suivante */ } }
  throw new Error('playwright-core introuvable : npx playwright-core --version une fois, ou E2E_PLAYWRIGHT=<chemin>');
}

async function lance(extraArgs = []) {
  return playwright().chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', ...extraArgs] });
}

const sql = (requete) => execFileSync('sqlite3', [path.join(RACINE, 'zone.db'), requete], { encoding: 'utf8' });

// Un visiteur connecté, avec des crédits, arrivé dans la borne. E2E_COMPTE=<compte de test existant> évite l'inscription
// (limitée à 3 par quart d'heure) ; sans lui, un compte « e2e<nombre> » est créé. Les locations des comptes de test
// des passes précédentes sont closes d'abord : elles immobilisent des copies (stock de 2 par film).
async function visiteur(browser, { taille = [412, 915] } = {}) {
  sql("update rentals set is_active = 0 where user_id in (select id from users where username glob 'e2e[0-9]*' or username glob 'verif[0-9]*')");
  // La session d'une passe précédente est reprise (fichier hors dépôt) : connexion et inscription ont une limite de débit.
  const SESSION = path.join(__dirname, 'captures', 'session.json');
  const reprise = fs.existsSync(SESSION);
  const ctx = await browser.newContext({ viewport: { width: taille[0], height: taille[1] }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', ...(reprise ? { storageState: SESSION } : {}) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.erreurs = [];
  page.on('pageerror', (e) => page.erreurs.push(String(e)));
  await page.goto(URL0, { waitUntil: 'load' });
  let compte = reprise ? await page.evaluate(async () => { const r = await fetch('/api/me', { credentials: 'include' }); return r.ok ? ((await r.json()).user || {}).username || null : null; }) : null;
  if (!compte) {
  compte = process.env.E2E_COMPTE || `e2e${Date.now() % 10000000}`;
  const statut = await page.evaluate(async ({ compte, mdp, creer }) => {
    const r = await fetch(creer ? '/api/auth/register' : '/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: compte, password: mdp }) });
    return r.status;
  }, { compte, mdp: MOT_DE_PASSE, creer: !process.env.E2E_COMPTE });
  if (statut !== 200) throw new Error(`compte de test ${compte} : réponse ${statut} (E2E_COMPTE=<compte existant> si l'inscription est limitée)`);
  fs.mkdirSync(path.dirname(SESSION), { recursive: true });
  await ctx.storageState({ path: SESSION });
  }
  sql(`update users set credits = 90 where username = '${compte}'`);
  await entre(page);
  return { ctx, page, compte };
}

// (Re)charge le site et entre dans la borne par la devanture.
async function entre(page) {
  await page.reload({ waitUntil: 'load' });
  // Le site se souvient de la scène : rechargé depuis la borne, il y revient sans passer par la devanture.
  await page.waitForSelector('button[aria-label="Ouvrir la borne de location"], [class*="KioskView_ks__"]', { state: 'attached' });
  await page.waitForTimeout(1500);
  if (!(await page.locator('[class*="KioskView_ks__"]').count())) await page.locator('button[aria-label="Ouvrir la borne de location"]').first().tap();
  await page.waitForSelector('[class*="KioskView_ks__"]');
  await page.waitForTimeout(1500);
}

// Rend [écart moyen absolu, biais signé] (niveaux sur 255) — voir ecart.py.
const ecart = (capture, reference, boite) => execFileSync('python3', [path.join(__dirname, 'ecart.py'), capture, reference, ...boite.map(String)], { encoding: 'utf8' }).trim().split(' ').map(Number);

module.exports = { lance, visiteur, entre, ecart, sql, RACINE, URL0, fs, path };
