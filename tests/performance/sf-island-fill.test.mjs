import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readText } from '../helpers/repo.mjs'

const ROOT = process.cwd()
const aislePath = path.join(ROOT, 'src', 'components', 'interior', 'Aisle.tsx')

test('sf island fill: use the full SF slice and stop when the list is exhausted', () => {
  const aisle = readText(aislePath)

  assert.ok(
    aisle.includes('const sfIslandLeft = useMemo(() => sfSlice, [sfSlice])'),
    'SF island must use the full SF slice'
  )
  assert.ok(
    aisle.includes('if (!repeatWhenShort && index >= films.length) break'),
    'Island fill must stop when there are no more films to place'
  )
  assert.ok(
    aisle.includes("[0.65, 0, -0.3], [0, 0, 0], sfIslandLeft, classiquesIslandRight, 'island2', false"),
    'SF/Classiques island must disable row looping'
  )
})
