// Les pannes de la liaison avec le serveur se disent en français, et ne se confondent pas avec un refus du serveur.
// Batterie de tests du 25/11/2026 : « Failed to fetch » et « Expected ',' or '}' after property value in JSON… »
// s'affichaient tels quels dans le panneau de connexion.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, auth, NETWORK_DOWN, SERVER_BROKEN, SERVER_SLOW } from '../../src/api/index.ts';

const withFetch = async (fake, run) => {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await run(); } finally { globalThis.fetch = real; }
};
const refus = async (fake) => withFetch(fake, async () => { try { await auth.login('a', 'b'); } catch (e) { return e; } return null; });

test('API: réseau coupé — un message en français, et pas un refus du serveur', async () => {
  const e = await refus(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(e.message, NETWORK_DOWN);
  assert.ok(!(e instanceof ApiError), 'sans réponse du serveur il n\'y a pas de statut HTTP : ce n\'est pas une ApiError');
});

test('API: serveur trop lent — la requête est abandonnée et le dit', async () => {
  const e = await refus(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  assert.equal(e.message, SERVER_SLOW);
  assert.ok(!(e instanceof ApiError));
});

test('API: chaque requête part avec un délai maximal', async () => {
  let vu = null;
  await withFetch(async (_url, init) => { vu = init.signal; return new Response(JSON.stringify({ user: {} }), { status: 200 }); }, () => auth.login('a', 'b'));
  assert.ok(vu instanceof AbortSignal, 'un signal d\'abandon accompagne la requête');
});

test('API: réponse 200 illisible — message en français, statut gardé', async () => {
  const e = await refus(async () => new Response('{"user":{"id":1,', { status: 200 }));
  assert.ok(e instanceof ApiError && e.status === 200);
  assert.equal(e.message, SERVER_BROKEN);
});

test('API: erreur 500 ou 502 sans JSON — message en français, statut gardé', async () => {
  for (const status of [500, 502]) {
    const e = await refus(async () => new Response('<html>Bad Gateway</html>', { status }));
    assert.ok(e instanceof ApiError && e.status === status);
    assert.equal(e.message, SERVER_BROKEN);
  }
});

test('API: un refus du serveur garde son message et son statut', async () => {
  const e = await refus(async () => new Response(JSON.stringify({ error: 'Pseudo ou mot de passe incorrect' }), { status: 401 }));
  assert.ok(e instanceof ApiError && e.status === 401);
  assert.equal(e.message, 'Pseudo ou mot de passe incorrect');
});
