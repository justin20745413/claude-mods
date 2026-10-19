import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { GAMES } from './features'
import type { DayEntry, FileEntry, FileKind, FileLogTab, GameCmd, GameView } from '../types'

const PANE = 'file-log'
const TITLE = '檔案紀錄'

const files = atom({ plugin: 'file-log', key: 'files' } as const, [] as FileEntry[])
const tab = atom({ plugin: 'file-log', key: 'tab' } as const, 'session' as FileLogTab)
const today = atom({ plugin: 'file-log', key: 'today' } as const, [] as DayEntry[])
// The last key typed into the game controller, numbered so the board applies each once.
const gameCmd = atom({ plugin: 'file-log', key: 'gameCmd' } as const, { seq: 0, key: '' } as GameCmd)
// What the controller field shows: '' and ' ' in turn, so each redraw empties what was typed.
const pad = atom({ plugin: 'file-log', key: 'pad' } as const, '')
// What the game tab shows: its menu, or one game.
const game = atom({ plugin: 'file-log', key: 'game' } as const, 'menu' as GameView)

// The dino's field is never shorter than the dinosaur at the top of its jump (MIN_SKY in dino.tsx).
const MIN_SKY = 14
const bestKey = (game: string) => game + ':best'
const GAME_NAMES = ['snake', 'dino'] as const
// A high score is kept for 7 days from when it was set, then cleared.
const BEST_KEEP_MS = 7 * 24 * 60 * 60 * 1000

// The game's high score, or 0 once it is more than 7 days old (the old record is deleted then).
async function readBest($: EngineInterface, gameName: string): Promise<number> {
  const key = bestKey(gameName)
  const stored = await $.store.get(key)
  const now = await $.clock.now()
  // A plain number is a record from before the 7-day rule: its 7 days start now.
  if (typeof stored === 'number') {
    await $.store.set(key, { score: stored, at: now })
    return stored
  }
  const best = stored as { score?: unknown; at?: unknown } | undefined
  if (!best || typeof best.score !== 'number' || typeof best.at !== 'number') return 0
  if (now - best.at > BEST_KEEP_MS) {
    await $.store.delete(key)
    return 0
  }
  return best.score
}

async function saveBest($: EngineInterface, gameName: string, score: number): Promise<void> {
  if (score > (await readBest($, gameName))) await $.store.set(bestKey(gameName), { score, at: await $.clock.now() })
}

async function switchTab($: EngineInterface, value: FileLogTab): Promise<void> {
  if (value === 'today' || value === 'all') {
    const day = await loadToday($)
    await update($, today, () => day)
  }
  await update($, tab, () => value)
  // The game tab opens on its menu and takes the keyboard at once: no click needed
  // (clicks reach the app only in fullscreen).
  if (value === 'game') {
    await update($, game, () => 'menu' as const)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
  }
}

async function chooseGame($: EngineInterface, view: GameView): Promise<void> {
  await update($, game, () => view)
  // The menu's buttons are gone: hand the keyboard to the controller, or back to the menu.
  try {
    await $.ui.focus({ requestId: PANE, key: view === 'menu' ? 'menu-snake' : 'game-pad' })
  } catch { }
}

// Every key typed into the controller goes to the game on screen.
async function onPad($: EngineInterface, value: string): Promise<void> {
  const shown = await read($, pad)
  const typed = value.startsWith(shown) ? value.slice(shown.length) : value.slice(-1)
  await update($, pad, p => (p === '' ? ' ' : ''))
  for (const ch of typed) await update($, gameCmd, c => ({ seq: c.seq + 1, key: ch.toLowerCase() }))
}

// Both separators count: Windows paths use '\'.
function lastSep(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
}

function dirname(path: string): string {
  const i = lastSep(path)
  return i <= 0 ? '/' : path.slice(0, i)
}

function basename(path: string): string {
  return path.slice(lastSep(path) + 1)
}

// A drive path (C:\…, c:/…) or a network path (\\server\share\…).
function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

// The same Windows file can arrive as 'c:\…', 'C:\…' or 'C:/…': a Windows path is
// recorded with '\' separators and an upper-case drive letter. Other paths are kept as is.
function normPath(path: string): string {
  if (!isWindowsPath(path)) return path
  const p = path.replace(/\//g, '\\')
  return /^[a-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p
}

// What two paths are compared by. Windows ignores case in file names, so a Windows
// path compares lower-cased. macOS and Linux paths compare as they are: a volume
// there can be case-sensitive, and the system already reports a file's own case.
function pathKey(path: string): string {
  return isWindowsPath(path) ? normPath(path).toLowerCase() : path
}

function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

function isUnder(path: string, dir: string): boolean {
  const p = pathKey(path)
  // 'C:\' and '/' end in a separator already.
  const d = pathKey(dir).replace(/[\\/]+$/, '')
  return p.startsWith(d + '/') || p.startsWith(d + '\\')
}

async function isWindows($: EngineInterface): Promise<boolean> {
  return (await $.env.get('OS')) === 'Windows_NT'
}

// Files Windows would run rather than show when handed to their default app.
const RUNNABLE = /\.(bat|cmd|exe|com|msi|ps1|vbs|vbe|js|jse|wsf|wsh|scr|lnk|reg)$/i

// Opens a file in the editor this terminal runs inside (a VS Code-family app), else the default app.
async function openFile($: EngineInterface, path: string): Promise<void> {
  try {
    if (!(await $.fs.exists(path))) {
      $.ui.toast(`檔案已不存在：${path}`)
      return
    }
    const termProgram = await $.env.get('TERM_PROGRAM')
    if (await isWindows($)) {
      // `code` is a .cmd on Windows, so it goes through cmd.
      if (termProgram === 'vscode') {
        const run = await $.process.run(['cmd', '/c', 'code', '-r', path], { timeoutMs: 5000 })
        if (run.exitCode === 0) return
      }
      // A runnable file is shown selected in Explorer instead of being run.
      const argv = RUNNABLE.test(path)
        ? ['explorer', '/select,' + path]
        : ['rundll32', 'url.dll,FileProtocolHandler', path]
      await $.process.run(argv, { timeoutMs: 5000 })
      return
    }
    const bundle = await $.env.get('__CFBundleIdentifier')
    const argv = termProgram === 'vscode' && bundle ? ['open', '-b', bundle, path] : ['open', path]
    const run = await $.process.run(argv, { timeoutMs: 5000 })
    if (run.exitCode !== 0) $.ui.toast(`打不開檔案：${run.stderr.trim() || path}`)
  } catch {
    $.ui.toast(`打不開檔案：${path}`)
  }
}

// Shows a folder in Finder, or Explorer on Windows.
async function openFolder($: EngineInterface, dir: string): Promise<void> {
  try {
    if (!(await $.fs.exists(dir))) {
      $.ui.toast(`資料夾已不存在：${dir}`)
      return
    }
    // explorer.exe exits 1 even when it opened the folder, so its exit code says nothing.
    if (await isWindows($)) {
      await $.process.run(['explorer', dir], { timeoutMs: 5000 })
      return
    }
    const run = await $.process.run(['open', dir], { timeoutMs: 5000 })
    if (run.exitCode !== 0) $.ui.toast(`打不開資料夾：${run.stderr.trim() || dir}`)
  } catch {
    $.ui.toast(`打不開資料夾：${dir}`)
  }
}

// Local time offset in minutes, read once from the system clock.
let offsetMinutes: number | undefined

async function localOffset($: EngineInterface): Promise<number> {
  if (offsetMinutes !== undefined) return offsetMinutes
  try {
    const run = await $.process.run(['date', '+%z'], { timeoutMs: 3000 })
    const m = /^([+-])(\d\d)(\d\d)/.exec(run.stdout.trim())
    offsetMinutes = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
  } catch {
    offsetMinutes = 0
  }
  return offsetMinutes
}

function shifted(ms: number, offset: number): Date {
  return new Date(ms + offset * 60_000)
}

function dayKey(ms: number, offset: number): string {
  return 'day:' + shifted(ms, offset).toISOString().slice(0, 10)
}

function clockText(ms: number, offset: number): string {
  return shifted(ms, offset).toISOString().slice(11, 16)
}

// The part of a path below dir, once isUnder(path, dir) holds.
function below(path: string, dir: string): string {
  return path.slice(dir.replace(/[\\/]+$/, '').length + 1)
}

function shortPath(path: string, cwd: string, home: string): string {
  if (cwd && isUnder(path, cwd)) return below(path, cwd)
  if (home && isUnder(path, home)) return '~/' + below(path, home)
  return path
}

// Keep only today's records: every other day's key is deleted.
// Runs when a session starts and on each record, so it never depends on a clean shutdown.
async function pruneOldDays($: EngineInterface, keep: string): Promise<void> {
  for (const key of await $.store.keys()) {
    if (key.startsWith('day:') && key !== keep) await $.store.delete(key)
  }
}

async function loadToday($: EngineInterface): Promise<DayEntry[]> {
  const offset = await localOffset($)
  const now = await $.clock.now()
  const value = await $.store.get(dayKey(now, offset))
  return Array.isArray(value) ? (value as DayEntry[]) : []
}

async function record($: EngineInterface, rawPath: string, kind: FileKind): Promise<void> {
  const path = normPath(rawPath)
  const at = await $.clock.now()

  await update($, files, list => {
    const found = list.find(f => samePath(f.path, path))
    if (!found) return [...list, { path, kind, count: 1, at }]
    return list.map(f => (samePath(f.path, path) ? { ...f, count: f.count + 1, at } : f))
  })

  const offset = await localOffset($)
  const key = dayKey(at, offset)
  const session = await $.session.id()
  const cwd = normPath(await $.session.cwd())
  const stored = await $.store.get(key)
  const day: DayEntry[] = Array.isArray(stored) ? (stored as DayEntry[]) : []
  const index = day.findIndex(d => d.session === session && samePath(d.path, path))
  const old = index === -1 ? undefined : day[index]
  if (old) {
    day[index] = { ...old, at }
  } else {
    day.push({ path, kind, session, cwd, at })
  }
  await $.store.set(key, day)
  await pruneOldDays($, key)
  await update($, today, () => day)
}

async function home($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? ''
}

function todayText(day: DayEntry[], offset: number, homeDir: string): string {
  if (day.length === 0) return '今天還沒有任何對話修改或新增檔案。'
  const bySession = new Map<string, DayEntry[]>()
  for (const d of [...day].sort((a, b) => a.at - b.at)) {
    bySession.set(d.session, [...(bySession.get(d.session) ?? []), d])
  }
  const created = day.filter(d => d.kind === 'created').length
  const lines = [`**今天共 ${day.length} 個檔案**（新增 ${created}、修改 ${day.length - created}），${bySession.size} 個對話`, '']
  for (const [session, list] of bySession) {
    const cwd = list[0]?.cwd ?? ''
    lines.push(`### 對話 ${session.slice(0, 8)} · ${shortPath(cwd, '', homeDir) || cwd}`)
    for (const d of list) {
      const mark = d.kind === 'created' ? '＋ 新增' : '✎ 修改'
      lines.push(`- ${clockText(d.at, offset)} ${mark} \`${shortPath(d.path, d.cwd, homeDir)}\``)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'files', description: '打開右側的檔案紀錄面板' })
    await $.command.register({ name: 'files-today', description: '列出今天所有對話修改與新增的檔案' })
    await update($, today, () => [])
    try {
      await pruneOldDays($, dayKey(await $.clock.now(), await localOffset($)))
      if (GAMES) for (const name of GAME_NAMES) await readBest($, name)
    } catch {}
    const day = await loadToday($)
    await update($, today, () => day)
    void $.ui.open({ id: PANE, title: TITLE })
    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? '已打開檔案紀錄面板。' : `面板暫時無法顯示：${opened.reason}` }
  })

  on('command.run', { command: 'files-today' }, async $ => {
    const day = await loadToday($)
    await update($, today, () => day)
    return { text: todayText(day, await localOffset($), await home($)) }
  })

  // Write: new when the file did not exist before the call.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    let existed = true
    try {
      existed = await $.fs.exists(e.file_path)
    } catch { }
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await record($, e.file_path, existed ? 'modified' : 'created')
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await record($, e.file_path, 'modified')
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) await record($, e.notebook_path, 'modified')
    return ran
  }).catch(($, e, next) => next(e))

  // A game board reports a finished game's score; the best one per game is kept.
  on('ui.message', async ($, e, next) => {
    if (!GAMES || (e.element !== 'snake' && e.element !== 'dino')) return next(e)
    const data = e.data as { score?: unknown } | null
    const score = typeof data?.score === 'number' ? data.score : 0
    await saveBest($, e.element, score)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const current = await read($, tab)
    const cwd = await $.session.cwd()
    const homeDir = await home($)
    const offset = await localOffset($)
    const width = Math.max(10, (e.props.bodyColumns ?? 40) - 2)
    const fit = (text: string, room = width) => (text.length > room ? '…' + text.slice(text.length - room + 1) : text)

    const tabButton = (key: string, hotkey: string, value: FileLogTab, label: string) => (
      <Button
        key={key}
        hotkey={hotkey}
        variant={current === value ? 'primary' : 'secondary'}
        label={label}
        onPress={() => switchTab($, value)}
      />
    )
    // The 中文 switch belongs to the zh-translate mod; shown only when that mod is loaded.
    const zh = (await $.state.get({ plugin: 'zh-translate', key: 'isOn' } as never)) as { value?: unknown; version: number }
    const zhButton =
      zh.version > 0 ? (
        <Button
          key="zh-toggle"
          variant={zh.value === true ? 'primary' : 'secondary'}
          label={zh.value === true ? '中文 開' : '中文 關'}
          onPress={() => $.command.run({ command: 'zh' })}
        />
      ) : null
    const tabs = (
      <Box flexDirection="row" gap={1}>
        {zhButton}
        {tabButton('tab-session', '1', 'session', 'talk')}
        {tabButton('tab-today', '2', 'today', 'project')}
        {tabButton('tab-all', '3', 'all', 'all')}
        {GAMES && tabButton('tab-game', '4', 'game', 'game')}
      </Box>
    )

    // GAMES:BEGIN (scripts/make-nogame.sh leaves out everything from here to GAMES:END)
    if (GAMES && current === 'game') {
      const view = await read($, game)
      if (view === 'menu') {
        // Each item's number is its key: on the menu, 1 and 2 pick a game (they win over the tabs' 1 and 2,
        // being drawn later). Clicks don't reach the pane in every terminal; the keys always do.
        const item = (key: GameView, hotkey: string, name: string, first: boolean) => (
          <Button
            key={'menu-' + key}
            hotkey={hotkey}
            plain
            autoFocus={first ? true : undefined}
            label={name}
            onPress={() => chooseGame($, key)}
          />
        )
        return (
          <Box flexDirection="column">
            {tabs}
            {item('snake', '1', '貪吃蛇', true)}
            {item('dino', '2', '小恐龍', false)}
          </Box>
        )
      }
      if (!('Client' in elements) || !('Input' in elements)) {
        return (
          <Box flexDirection="column">
            {tabs}
            <Text dimColor>這個介面不能玩遊戲，請在終端機或桌面版打開。</Text>
          </Box>
        )
      }
      const { Client, Input } = elements
      const isSnake = view === 'snake'
      // The board grows with the pane: everything but the tabs, score, frame, status, controller and hint.
      const roomCols = (e.props.bodyColumns ?? 40) - 4
      const roomRows = (e.props.scroll?.bodyRows ?? 20) - 8
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(n)))
      // Both games draw each cell two columns wide.
      const cols = isSnake ? clamp(roomCols / 2, 8, 60) : clamp(roomCols / 2, 20, 100)
      const rows = isSnake ? clamp(roomRows, 8, 40) : clamp(roomRows, MIN_SKY, 30)
      const best = await readBest($, view)
      const cmd = await read($, gameCmd)
      return (
        <Box flexDirection="column">
          {tabs}
          {isSnake ? (
            <Client key="snake" module="./snake.tsx" props={{ cols, rows, best, cmd }} />
          ) : (
            <Client key="dino" module="./dino.tsx" props={{ cols, rows, best, cmd }} />
          )}
          <Input
            key="game-pad"
            label="🎮"
            autoFocus
            value={await read($, pad)}
            placeholder="遊戲按鍵在這裡"
            submitLabel="空白鍵"
            onInput={value => onPad($, value)}
            onSubmit={() => update($, gameCmd, c => ({ seq: c.seq + 1, key: ' ' }))}
          />
          <Text dimColor>
            {isSnake ? 'W A S D 移動 · 空白鍵暫停' : '空白鍵或 W 跳'}
          </Text>
        </Box>
      )
    }
    // GAMES:END

    // Files grouped under their folder: the folder tag opens the folder, a file row opens the file.
    type Row = { path: string; kind: FileKind; at: number; count: number }
    const fileList = (rows: Row[], base: string, withTime: boolean) => {
      // Keyed by pathKey so one Windows folder spelled in two cases is one group.
      const groups = new Map<string, { dir: string; list: Row[] }>()
      for (const r of rows) {
        const dir = dirname(r.path)
        const group = groups.get(pathKey(dir))
        if (group) group.list.push(r)
        else groups.set(pathKey(dir), { dir, list: [r] })
      }
      const out = []
      for (const { dir, list } of groups.values()) {
        const label = base && samePath(dir, base) ? basename(base) : shortPath(dir, base, homeDir)
        out.push(
          <Button key={'dir:' + dir} plain onPress={() => openFolder($, dir)}>
            <Text color="cyan">📁 {fit(label + '/', width - 3)}</Text>
          </Button>,
        )
        for (const r of list) {
          const time = withTime ? clockText(r.at, offset) + ' ' : ''
          out.push(
            <Button key={'file:' + r.path} plain onPress={() => openFile($, r.path)}>
              {'  '}
              <Text color={r.kind === 'created' ? 'green' : 'yellow'}>{r.kind === 'created' ? '＋' : '✎'}</Text>
              <Text dimColor> {time}</Text>
              {fit(basename(r.path), width - 6 - time.length)}
              {r.count > 1 && <Text dimColor> ×{r.count}</Text>}
            </Button>,
          )
        }
      }
      return out
    }

    if (current === 'today' || current === 'all') {
      const everyProject = current === 'all'
      const latest = new Map<string, DayEntry>()
      for (const d of await read($, today)) {
        // "project" keeps files that live inside this project's folder, whichever session changed them.
        // Records from before normPath may still carry another spelling of the same path.
        const path = normPath(d.path)
        if (!everyProject && !samePath(path, cwd) && !isUnder(path, cwd)) continue
        const seen = latest.get(pathKey(path))
        if (!seen || seen.at < d.at) latest.set(pathKey(path), { ...d, path })
      }
      const day = [...latest.values()].sort((a, b) => b.at - a.at)
      const all = await read($, today)
      const sessions = new Set(all.filter(d => latest.has(pathKey(d.path))).map(d => d.session)).size
      const projects = new Set(day.map(d => pathKey(d.cwd))).size
      return (
        <Box flexDirection="column">
          {tabs}
          <Text dimColor>
            {everyProject
              ? `今天 ${day.length} 個檔案 · ${projects} 個專案 · ${sessions} 個對話`
              : `這個專案今天 ${day.length} 個檔案 · ${sessions} 個對話`}
          </Text>
          {day.length === 0 && <Text dimColor>今天還沒有紀錄。</Text>}
          {fileList(day.map(d => ({ ...d, count: 1 })), everyProject ? '' : cwd, true)}
        </Box>
      )
    }

    const list = await read($, files)
    const created = list.filter(f => f.kind === 'created').length
    return (
      <Box flexDirection="column">
        {tabs}
        {list.length === 0 ? (
          <Text dimColor>這次對話還沒有修改檔案。</Text>
        ) : (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>
              <Text color="green">＋ 新增 {created}</Text> · <Text color="yellow">✎ 修改 {list.length - created}</Text>
            </Text>
            {/* Empties this tab only: today's records under project / all stay. */}
            <Button
              key="clear-talk"
              hotkey="c"
              variant="secondary"
              label="清除"
              onPress={() => update($, files, () => [])}
            />
          </Box>
        )}
        {fileList(list, cwd, false)}
      </Box>
    )
  })
}
