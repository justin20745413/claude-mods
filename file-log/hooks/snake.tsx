import type { ClientModule } from 'claude-code'

// The snake runs here, on the drawing side: its own clock and keys, no round trip per move.

type Dir = 'up' | 'down' | 'left' | 'right'
type Cell = [number, number]
type Status = 'ready' | 'running' | 'paused' | 'over'

// `cmd` carries a key pressed through the pane's buttons (WASD / P hotkeys), numbered so each is applied once.
export type SnakeProps = { cols: number; rows: number; best: number; cmd?: { seq: number; key: string } }

type Game = {
  status: Status
  w: number
  h: number
  body: Cell[]
  dir: Dir
  nextDir: Dir
  food: Cell
  score: number
  best: number
  cmdSeq?: number
}

const ROWS = 10
const TICK_MS = 150
const DELTA: Record<Dir, Cell> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const KEY_DIR: Record<string, Dir> = {
  up: 'up', down: 'down', left: 'left', right: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
  W: 'up', S: 'down', A: 'left', D: 'right',
}

function placeFood(w: number, h: number, body: Cell[]): Cell {
  const free: Cell[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!body.some(b => b[0] === x && b[1] === y)) free.push([x, y])
  return free[Math.floor(Math.random() * free.length)] ?? [-1, -1]
}

export function newGame(cols: number, best: number, status: Status = 'ready', dir: Dir = 'right', rows: number = ROWS): Game {
  const y = Math.floor(rows / 2)
  const body: Cell[] = [[3, y], [2, y], [1, y]]
  return { status, w: cols, h: rows, body, dir: 'right', nextDir: dir === 'left' ? 'right' : dir, food: placeFood(cols, rows, body), score: 0, best }
}

export function step(g: Game): Game {
  const dir = OPPOSITE[g.nextDir] === g.dir ? g.dir : g.nextDir
  const [hx, hy] = g.body[0]!
  const head: Cell = [hx + DELTA[dir][0], hy + DELTA[dir][1]]
  const eats = head[0] === g.food[0] && head[1] === g.food[1]
  const rest = eats ? g.body : g.body.slice(0, -1)
  const hitsWall = head[0] < 0 || head[1] < 0 || head[0] >= g.w || head[1] >= g.h
  if (hitsWall || rest.some(b => b[0] === head[0] && b[1] === head[1])) {
    return { ...g, dir, status: 'over', best: Math.max(g.best, g.score) }
  }
  const body = [head, ...rest]
  return { ...g, dir, body, score: g.score + (eats ? 1 : 0), food: eats ? placeFood(g.w, g.h, body) : g.food }
}

// One key, from the board's own focus or from the pane's buttons.
function applyKey(g: Game, key: string): Game {
  const dir = KEY_DIR[key]
  if (dir) {
    if (g.status === 'ready' || g.status === 'over') return newGame(g.w, g.best, 'running', dir, g.h)
    return { ...g, nextDir: dir, status: 'running' }
  }
  if (key === ' ') {
    if (g.status === 'running') return { ...g, status: 'paused' }
    if (g.status === 'paused') return { ...g, status: 'running' }
    return newGame(g.w, g.best, 'running', 'right', g.h)
  }
  return g
}

const Snake: ClientModule<SnakeProps, Game> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ ...newGame(props.cols, props.best, 'ready', 'right', props.rows), cmdSeq: props.cmd?.seq ?? 0 })

    surface.every(TICK_MS, () => {
      const g = surface.state
      if (!g || g.status !== 'running') return
      const next = step(g)
      surface.setState(next)
      if (next.status === 'over' && next.score > 0) surface.post({ score: next.score })
    })

    surface.onKey(k => {
      const g = surface.state
      if (g) surface.setState({ ...applyKey(g, k.key), cmdSeq: g.cmdSeq })
    })
  }

  let g = surface.state ?? newGame(props.cols, props.best, 'ready', 'right', props.rows)
  // A key pressed through the pane's buttons arrives as new props.
  if (surface.state && props.cmd && props.cmd.seq !== g.cmdSeq) {
    g = { ...applyKey(g, props.cmd.key), cmdSeq: props.cmd.seq }
    surface.setState(g)
  }
    // The pane changed size while no game runs: the next board fills it.
  if ((g.status === 'ready' || g.status === 'over') && (g.w !== props.cols || g.h !== props.rows)) {
    g = { ...newGame(props.cols, Math.max(g.best, props.best), 'ready', 'right', props.rows), cmdSeq: g.cmdSeq }
    surface.setState(g)
  }
  const best = Math.max(g.best, props.best)

  const rows = []
  for (let y = 0; y < g.h; y++) {
    const cells = []
    for (let x = 0; x < g.w; x++) {
      const i = g.body.findIndex(b => b[0] === x && b[1] === y)
      // Plain spaces on a colored background: the same width in every terminal, so what you see is where it is.
      if (i === 0) cells.push(<Text backgroundColor="greenBright">{'  '}</Text>)
      else if (i > 0) cells.push(<Text backgroundColor="green">{'  '}</Text>)
      else if (g.food[0] === x && g.food[1] === y) cells.push(<Text backgroundColor="red">{'  '}</Text>)
      else cells.push(<Text dimColor>{'. '}</Text>)
    }
    rows.push(<Text>{cells}</Text>)
  }

  const status =
    g.status === 'running'
      ? '進行中 · 吃紅點 +1 分'
      : g.status === 'paused'
        ? '暫停中 · 空白鍵繼續'
        : g.status === 'over'
          ? `遊戲結束，得 ${g.score} 分 · 按 W A S D 再玩一次`
          : '按 W A S D 開始'

  return (
    <Box flexDirection="column">
      <Text>
        分數 <Text bold>{g.score}</Text>
        <Text dimColor>  最高 {best}</Text>
      </Text>
      <Box flexDirection="column" borderStyle="classic" alignSelf="flex-start">
        {rows}
      </Box>
      <Text color={g.status === 'over' ? 'red' : undefined} dimColor={g.status !== 'over'}>
        {status}
      </Text>
    </Box>
  )
}

export default Snake
