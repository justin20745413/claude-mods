import type { ClientModule } from 'claude-code'

// Dinosaur jumping over cacti, like Chrome's offline game. Runs on the drawing side like the snake.
// Every cell is one plain space on a colored background, so the drawing lines up in any terminal.

type Status = 'ready' | 'running' | 'over'
type Cactus = { x: number; h: number }

export type DinoProps = { cols: number; rows: number; best: number; cmd?: { seq: number; key: string } }

export type DinoGame = {
  status: Status
  w: number
  sky: number // rows above the ground
  y: number // height of the dino's feet above the ground, in rows
  vy: number
  cacti: Cactus[]
  gap: number // ticks until the next cactus
  ticks: number
  score: number
  best: number
  cmdSeq?: number
}

// The dinosaur, facing right, top row first: X body, E eye, M mouth.
// Two leg rows take turns while it runs.
const BODY = [
  '     XXXX', //
  '     XEXX', //
  '     XXXX', //
  'X   XXXM ', //
  'XX XXXXX ', //
  ' XXXXXX  ', //
]
const LEGS = ['  X   X  ', '  XX  X  ', '  X  XX  ']
export const DINO_W = 9
export const DINO_H = BODY.length + 1
const DINO_X = 2

const TICK_MS = 60
const JUMP = 1.8
const GRAVITY = 0.27
// The field is never shorter than the dinosaur at the top of its jump.
export const MIN_SKY = 14
const CACTUS_W = 3

function sprite(g: DinoGame): string[] {
  const legs = g.y > 0 || g.status !== 'running' ? LEGS[0]! : LEGS[1 + (Math.floor(g.ticks / 3) % 2)]!
  return [...BODY, legs]
}

// Whether the cell (x, h) above the ground holds the dinosaur, and what part.
function dinoAt(g: DinoGame, rows: string[], x: number, h: number): string | undefined {
  const feet = Math.round(g.y)
  const col = x - DINO_X
  const row = DINO_H - 1 - (h - feet)
  if (col < 0 || col >= DINO_W || row < 0 || row >= DINO_H) return undefined
  const c = rows[row]![col]
  return c === ' ' ? undefined : c
}

// A cactus: a trunk with an arm on each side, partway up.
function cactusAt(c: Cactus, x: number, h: number): boolean {
  if (h >= c.h || x < c.x || x >= c.x + CACTUS_W) return false
  if (x === c.x + 1) return true
  return c.h >= 3 && h >= 1 && h <= c.h - 2
}

export function newDino(cols: number, best: number, status: Status = 'ready', rows = 10): DinoGame {
  return { status, w: cols, sky: rows, y: 0, vy: 0, cacti: [], gap: 12, ticks: 0, score: 0, best }
}

export function hits(g: DinoGame): boolean {
  const rows = sprite(g)
  for (const c of g.cacti) {
    for (let x = c.x; x < c.x + CACTUS_W; x++) {
      for (let h = 0; h < c.h; h++) if (cactusAt(c, x, h) && dinoAt(g, rows, x, h)) return true
    }
  }
  return false
}

export function stepDino(g: DinoGame, random: () => number = Math.random): DinoGame {
  let y = g.y + g.vy
  let vy = g.vy - GRAVITY
  if (y <= 0) {
    y = 0
    vy = 0
  }
  let cacti = g.cacti.map(c => ({ ...c, x: c.x - 1 })).filter(c => c.x + CACTUS_W > 0)
  let gap = g.gap - 1
  if (gap <= 0) {
    cacti = [...cacti, { x: g.w, h: 2 + Math.floor(random() * 2) }]
    // Gaps shrink as the score grows, never below what one jump clears.
    gap = Math.max(18, 34 - Math.floor(g.score / 40)) + Math.floor(random() * 14)
  }
  const ticks = g.ticks + 1
  const next = { ...g, y, vy, cacti, gap, ticks, score: Math.floor(ticks / 2) }
  if (hits(next)) return { ...next, status: 'over', best: Math.max(g.best, next.score) }
  return next
}

export function applyDinoKey(g: DinoGame, key: string): DinoGame {
  if (key !== ' ' && key !== 'w') return g
  if (g.status !== 'running') return newDino(g.w, g.best, 'running', g.sky)
  if (g.y === 0) return { ...g, vy: JUMP }
  return g
}

const Dino: ClientModule<DinoProps, DinoGame> = (props, surface) => {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    surface.setState({ ...newDino(props.cols, props.best, 'ready', props.rows), cmdSeq: props.cmd?.seq ?? 0 })
    surface.every(TICK_MS, () => {
      const g = surface.state
      if (!g || g.status !== 'running') return
      const next = stepDino(g)
      surface.setState(next)
      if (next.status === 'over' && next.score > 0) surface.post({ score: next.score })
    })
  }

  let g = surface.state ?? newDino(props.cols, props.best, 'ready', props.rows)
  if (surface.state && props.cmd && props.cmd.seq !== g.cmdSeq) {
    g = { ...applyDinoKey(g, props.cmd.key), cmdSeq: props.cmd.seq }
    surface.setState(g)
  }
  // The pane changed size while no game runs: the next field fills it.
  if (g.status !== 'running' && (g.w !== props.cols || g.sky !== props.rows)) {
    g = { ...newDino(props.cols, Math.max(g.best, props.best), 'ready', props.rows), cmdSeq: g.cmdSeq }
    surface.setState(g)
  }
  const best = Math.max(g.best, props.best)

  const rows = sprite(g)
  const dinoColor = g.status === 'over' ? 'red' : 'gray'
  const lines = []
  // (Not named `h`: that is the JSX factory.)
  for (let level = g.sky - 1; level >= 0; level--) {
    const cells = []
    for (let x = 0; x < g.w; x++) {
      const part = dinoAt(g, rows, x, level)
      // Each pixel is two columns wide: terminal cells are about twice as tall as they are wide.
      if (part === 'E') cells.push(<Text backgroundColor="white">{'  '}</Text>)
      else if (part === 'M') cells.push('  ')
      else if (part) cells.push(<Text backgroundColor={dinoColor}>{'  '}</Text>)
      else if (g.cacti.some(c => cactusAt(c, x, level))) cells.push(<Text backgroundColor="green">{'  '}</Text>)
      else cells.push('  ')
    }
    lines.push(<Text>{cells}</Text>)
  }
  lines.push(<Text dimColor>{'_'.repeat(g.w * 2)}</Text>)

  const status =
    g.status === 'running' ? '空白鍵或 W 跳過仙人掌' : g.status === 'over' ? `撞到了，得 ${g.score} 分 · 空白鍵再玩一次` : '按空白鍵開始'

  return (
    <Box flexDirection="column">
      <Text>
        分數 <Text bold>{g.score}</Text>
        <Text dimColor>  最高 {best}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="classic" alignSelf="flex-start">
        {lines}
      </Box>
      <Text color={g.status === 'over' ? 'red' : undefined} dimColor={g.status !== 'over'}>
        {status}
      </Text>
    </Box>
  )
}

export default Dino
