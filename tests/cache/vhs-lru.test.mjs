/**
 * VHS Cover LRU Cache — Unit tests
 *
 * Tests the LRU eviction logic for VHS cover textures.
 * Since the real implementation uses THREE.CanvasTexture + document.createElement,
 * we replicate the exact same LRU logic with mock objects.
 *
 * Also verifies via static analysis that VHSCoverGenerator.ts contains the cache,
 * and that VHSCaseViewer.tsx does NOT dispose cached textures.
 *
 * Run: node --test tests/cache/vhs-lru.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ── Replicate the exact LRU logic from VHSCoverGenerator.ts ──

function createLRUCache(maxSize) {
  const cache = new Map();
  const lru = []; // oldest first

  function get(key) {
    return cache.get(key) ?? null;
  }

  function set(key, value) {
    // If already in cache, just update LRU order
    if (cache.has(key)) {
      const idx = lru.indexOf(key);
      if (idx > -1) lru.splice(idx, 1);
      lru.push(key);
      return null; // no eviction
    }

    let evicted = null;
    if (lru.length >= maxSize) {
      const evictKey = lru.shift();
      evicted = { key: evictKey, value: cache.get(evictKey) };
      cache.delete(evictKey);
    }
    cache.set(key, value);
    lru.push(key);
    return evicted;
  }

  return { cache, lru, get, set };
}

test('LRU: stores items up to max capacity', () => {
  const { cache, set } = createLRUCache(5);

  for (let i = 0; i < 5; i++) {
    set(i, { id: i, disposed: false });
  }

  assert.equal(cache.size, 5);
});

test('LRU: evicts oldest item when capacity exceeded', () => {
  const { cache, set, get } = createLRUCache(3);

  set(1, { id: 1 });
  set(2, { id: 2 });
  set(3, { id: 3 });

  // Cache full — adding 4 should evict 1
  const evicted = set(4, { id: 4 });

  assert.ok(evicted, 'Should return evicted entry');
  assert.equal(evicted.key, 1, 'Oldest entry (key=1) should be evicted');
  assert.equal(get(1), null, 'Evicted entry should not be in cache');
  assert.equal(cache.size, 3, 'Cache size should remain at max');
});

test('LRU: evicts in FIFO order', () => {
  const { set, get } = createLRUCache(3);

  set(10, 'a');
  set(20, 'b');
  set(30, 'c');

  // Evict 10
  const e1 = set(40, 'd');
  assert.equal(e1.key, 10);

  // Evict 20
  const e2 = set(50, 'e');
  assert.equal(e2.key, 20);

  // Evict 30
  const e3 = set(60, 'f');
  assert.equal(e3.key, 30);

  // Only 40, 50, 60 remain
  assert.equal(get(40), 'd');
  assert.equal(get(50), 'e');
  assert.equal(get(60), 'f');
});

test('LRU: get returns cached value without eviction', () => {
  const { set, get } = createLRUCache(2);

  set(1, 'alpha');
  set(2, 'beta');

  assert.equal(get(1), 'alpha');
  assert.equal(get(2), 'beta');
  assert.equal(get(999), null, 'Missing key returns null');
});

test('LRU: returns exact same reference (not clone)', () => {
  const { set, get } = createLRUCache(5);
  const obj = { id: 42, nested: { data: true } };

  set(42, obj);
  const retrieved = get(42);
  assert.equal(retrieved, obj, 'Must return exact same reference');
});

test('LRU: evicted texture can have dispose() called', () => {
  const { set } = createLRUCache(2);
  let disposed = false;

  const texture = {
    dispose() { disposed = true; }
  };

  set(1, texture);
  set(2, { dispose() {} });

  // Evict texture 1
  const evicted = set(3, { dispose() {} });
  assert.equal(evicted.key, 1);

  // Simulate what VHSCoverGenerator does: dispose the evicted texture
  evicted.value.dispose();
  assert.ok(disposed, 'Evicted texture.dispose() should have been called');
});

test('LRU: max=20 handles bulk insert + eviction correctly', () => {
  const { cache, set, get } = createLRUCache(20);
  const disposeLog = [];

  // Insert 30 items (10 will be evicted)
  for (let i = 0; i < 30; i++) {
    const evicted = set(i, {
      filmId: i,
      dispose() { disposeLog.push(i); }
    });
    if (evicted) evicted.value.dispose();
  }

  assert.equal(cache.size, 20, 'Cache should be at max capacity');
  assert.equal(disposeLog.length, 10, '10 textures should have been evicted and disposed');

  // Items 0-9 evicted, 10-29 still present
  for (let i = 0; i < 10; i++) {
    assert.equal(get(i), null, `Item ${i} should have been evicted`);
  }
  for (let i = 10; i < 30; i++) {
    assert.ok(get(i), `Item ${i} should still be in cache`);
    assert.equal(get(i).filmId, i);
  }
});

// ── Static analysis: verify VHS cache patterns in source ──

test('static: VHSCoverGenerator.ts has data cache for fetchVHSCoverData', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../../src/utils/VHSCoverGenerator.ts', import.meta.url), 'utf8'
  );

  assert.ok(
    source.includes('VHS_DATA_CACHE'),
    'VHSCoverGenerator must have VHS_DATA_CACHE Map'
  );
  assert.ok(
    /VHS_DATA_CACHE\.get\(/.test(source),
    'fetchVHSCoverData must check VHS_DATA_CACHE'
  );
  assert.ok(
    /VHS_DATA_CACHE\.set\(/.test(source),
    'fetchVHSCoverData must write to VHS_DATA_CACHE'
  );
});

test('static: VHSCoverGenerator.ts has LRU texture cache for generateVHSCoverTexture', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../../src/utils/VHSCoverGenerator.ts', import.meta.url), 'utf8'
  );

  assert.ok(
    source.includes('VHS_TEXTURE_CACHE'),
    'VHSCoverGenerator must have VHS_TEXTURE_CACHE Map'
  );
  assert.ok(
    source.includes('VHS_TEXTURE_LRU'),
    'VHSCoverGenerator must have VHS_TEXTURE_LRU array'
  );
  assert.ok(
    source.includes('VHS_TEXTURE_MAX'),
    'VHSCoverGenerator must define VHS_TEXTURE_MAX constant'
  );

  // Verify eviction logic: dispose() called on evicted textures
  assert.ok(
    /evicted\s*\)\s*\{[\s\S]*?\.dispose\(\)/.test(source) ||
    source.includes('evicted.dispose()'),
    'LRU eviction must call dispose() on evicted textures'
  );
});

test('static: VHSCaseViewer does NOT dispose cached cover textures', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../../src/components/interior/VHSCaseViewer.tsx', import.meta.url), 'utf8'
  );

  // The old pattern was: coverTextureRef.current.dispose()
  // After our change, this should NOT exist (LRU manages lifecycle)
  const disposeCount = (source.match(/coverTextureRef\.current\.dispose\(\)/g) || []).length;
  assert.equal(
    disposeCount, 0,
    'VHSCaseViewer must NOT call coverTextureRef.current.dispose() — LRU cache manages texture lifecycle'
  );

  // Verify the comment explains why
  assert.ok(
    source.includes('LRU') || source.includes('cache'),
    'VHSCaseViewer should mention cache/LRU in comments'
  );
});
