import { expect, test } from 'claude-code/testing'
import { newGame, step } from '../hooks/snake'
import { DINO_W, applyDinoKey, newDino, stepDino } from '../hooks/dino'

test('eating the red dot adds a point and grows the snake', async () => {
  const g = { ...newGame(10, 0, 'running'), food: [4, 5] as [number, number] }
  expect(g.body[0]).toEqual([3, 5])
  const next = step(g)
  expect(next.score).toBe(1)
  expect(next.body.length).toBe(4)
  expect(next.body[0]).toEqual([4, 5])
})

test('the dino runs into a cactus when it never jumps', async () => {
  let g = { ...newDino(40, 0, 'running', 14), cacti: [{ x: 14, h: 3 }], gap: 999 }
  for (let i = 0; i < 20 && g.status === 'running'; i++) g = stepDino(g, () => 0.9)
  expect(g.status).toBe('over')
})

test('a well-timed jump clears every cactus for a long run', async () => {
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let g = newDino(60, 0, 'running', 14)
  for (let i = 0; i < 3000 && g.status === 'running'; i++) {
    const near = g.cacti.some(c => c.x - (2 + DINO_W) >= 0 && c.x - (2 + DINO_W) <= 1)
    if (near) g = applyDinoKey(g, ' ')
    g = stepDino(g, random)
  }
  expect(g.status).toBe('running')
  expect(g.score).toBeGreaterThan(1000)
})
