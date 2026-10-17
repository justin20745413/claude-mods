import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { MockClock } from 'claude-code/testing'
import { GAMES } from '../hooks/features'

// Game tests run only in the copy that ships the games.
const gameTest: typeof test = GAMES ? test : () => {}

// 2026-10-17 20:00 UTC is 04:00 on the 18th in +0800, so the day key must be local.
const NOW = Date.UTC(2026, 9, 17, 20, 0)

type Day = { path: string; kind: string; session: string }[]

let clock: MockClock
let runs: string[][]
let opens: unknown[]

function world(on: On, existing: string[], offset: string) {
  const store = new Map<string, unknown>()
  clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/Users/me' })
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', async () => ({ value: [...store.keys()] }))
  on('store.delete', async (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('session.id', async () => ({ value: 'session-abc' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('fs.exists', async (_$, e) => ({ value: existing.includes(e.path) }))
  runs = []
  opens = []
  on('ui.open', async (_$, e) => {
    opens.push(e)
    return { value: { isPlaced: true } as never }
  })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'open') runs.push([...e.argv])
    return { value: { stdout: offset + '\n', stderr: '', exitCode: 0 } as never }
  })
  return store
}

test('records new and modified files under the local day', async ($, on) => {
  const store = world(on, ['/repo/old.ts'], '+0800')
  on('tool.call', async () => ({ result: {} as never }))

  await $.tool.call({ tool: 'Write', file_path: '/repo/new.ts', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/old.ts', content: 'y' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/old.ts', old_string: 'y', new_string: 'z' })

  expect([...store.keys()]).toEqual(['day:2026-10-18'])
  const day = store.get('day:2026-10-18') as Day
  expect(day.map(d => [d.path, d.kind, d.session])).toEqual([
    ['/repo/new.ts', 'created', 'session-abc'],
    ['/repo/old.ts', 'modified', 'session-abc'],
  ])
})

test('older days are deleted, today and other keys are kept', async ($, on) => {
  const store = world(on, [], '+0800')
  store.set('day:2026-10-16', [{ path: '/repo/x.ts' }])
  store.set('day:2026-10-17', [{ path: '/repo/y.ts' }])
  store.set('other', 1)
  on('tool.call', async () => ({ result: {} as never }))

  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' })

  expect([...store.keys()].sort()).toEqual(['day:2026-10-18', 'other'])
})

test('a refused call is not recorded', async ($, on) => {
  const store = world(on, [], '+0000')
  on('tool.call', async () => ({ deny: 'no' }))

  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' })

  expect(store.size).toBe(0)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the pane lists the session's files and switches to today on ${surface}`, async ($, on) => {
    world(on, [], '+0800')
    on('tool.call', async () => ({ result: {} as never }))
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'x' })

    const ui = await $.ui.mount({
      plugin: 'file-log-nogame',
      surface,
      component: 'Pane',
      requestId: 'file-log-nogame',
      props: { title: '檔案紀錄', isFocused: false, bodyColumns: 40, placement: 'dock' } as never,
    })
    expect(await ui.find({ text: 'new.ts' })).toBeDefined()

    await ui.press({ key: 'tab-today' })
    expect(await ui.find({ text: '這個專案今天 1 個檔案 · 1 個對話' })).toBeDefined()
  })

  test(`the project tab hides other projects, the all tab shows them on ${surface}`, async ($, on) => {
    const store = world(on, [], '+0800')
    store.set('day:2026-10-18', [
      { path: '/other/x.ts', kind: 'created', session: 'session-old', cwd: '/other', at: NOW - 1000 },
      { path: '/repo/from-elsewhere.ts', kind: 'created', session: 'session-old', cwd: '/other', at: NOW - 500 },
    ])
    on('tool.call', async () => ({ result: {} as never }))
    await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' })
    // Changed from this session, but outside the project folder: not in "all".
    await $.tool.call({ tool: 'Write', file_path: '/Users/me/mods/b.ts', content: 'x' })

    const ui = await $.ui.mount({
      plugin: 'file-log-nogame',
      surface,
      component: 'Pane',
      requestId: 'file-log-nogame',
      props: { title: '檔案紀錄', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
    })
    await ui.press({ key: 'tab-today' })
    expect(await ui.find({ text: '這個專案今天 2 個檔案 · 2 個對話' })).toBeDefined()
    expect(await ui.find({ text: 'from-elsewhere.ts' })).toBeDefined()
    expect(await ui.find({ text: 'b.ts' })).toBeUndefined()

    await ui.press({ key: 'tab-all' })
    expect(await ui.find({ text: '今天 4 個檔案 · 2 個專案 · 2 個對話' })).toBeDefined()
  })
}

const PANE_PROPS = { title: '檔案紀錄', isFocused: false, bodyColumns: 40, placement: 'dock' } as never

for (const surface of ['terminal', 'desktop'] as const) {
  test(`clicking a file opens it, clicking its folder tag opens the folder on ${surface}`, async ($, on) => {
    world(on, ['/repo/src/a.ts', '/repo/src'], '+0800')
    on('tool.call', async () => ({ result: {} as never }))
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' })

    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    await ui.press({ key: 'file:/repo/src/a.ts' })
    await ui.press({ key: 'dir:/repo/src' })
    expect(runs).toEqual([
      ['open', '/repo/src/a.ts'],
      ['open', '/repo/src'],
    ])
  })

  gameTest(`snake is driven by arrow keys and keeps the best score on ${surface}`, async ($, on) => {
    const store = world(on, [], '+0800')
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    await ui.press({ key: 'tab-game' })
    await ui.press({ key: 'menu-snake' })
    expect(await ui.find({ text: '按 W A S D 開始', in: 'snake' })).toBeDefined()

    await ui.key({ key: 'right', in: 'snake' })
    await ui.advance(150)
    expect(await ui.find({ text: '進行中 · 吃紅點 +1 分', in: 'snake' })).toBeDefined()

    await ui.key({ key: ' ', in: 'snake' })
    expect(await ui.find({ text: '暫停中 · 空白鍵繼續', in: 'snake' })).toBeDefined()
    await ui.key({ key: ' ', in: 'snake' })

    // Heading right on an 18-wide board, the wall comes within 20 moves.
    await ui.advance(150 * 20)
    expect(await ui.find({ text: '遊戲結束', in: 'snake' })).toBeDefined()

    await ui.post({ score: 7 }, { in: 'snake' })
    expect(store.get('snake:best')).toEqual({ score: 7, at: NOW })
    await ui.post({ score: 3 }, { in: 'snake' })
    expect(store.get('snake:best')).toEqual({ score: 7, at: NOW })
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the 中文 switch shows when zh-translate is loaded and runs /zh on ${surface}`, async ($, on) => {
    world(on, [], '+0800')
    const ran: string[] = []
    on('state.get', async (_$, e, next) =>
      (e as { plugin: string }).plugin === 'zh-translate' ? { value: { value: false, version: 1 } as never } : next(e),
    )
    on('command.run', async (_$, e) => {
      ran.push(e.command)
      return { text: '' } as never
    })

    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    expect((await ui.find({ key: 'zh-toggle' }))?.text).toContain('中文 關')
    await ui.press({ key: 'zh-toggle' })
    expect(ran).toEqual(['zh'])
  })

  test(`without zh-translate there is no 中文 switch on ${surface}`, async ($, on) => {
    world(on, [], '+0800')
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    expect(await ui.find({ key: 'zh-toggle' })).toBeUndefined()
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  gameTest(`the snake tab takes the keyboard and the controller drives the board on ${surface}`, async ($, on) => {
    world(on, [], '+0800')
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    await ui.press({ key: 'tab-game' })
    await ui.press({ key: 'menu-snake' })
    expect(opens).toEqual([expect.objectContaining({ id: 'file-log-nogame', focus: true })])

    await ui.input({ key: 'game-pad', text: 'd', kind: 'change' })
    expect(await ui.find({ text: '進行中 · 吃紅點 +1 分', in: 'snake' })).toBeDefined()
    // The field was emptied to ' ', so the next key arrives after it.
    await ui.input({ key: 'game-pad', text: '  ', kind: 'change' })
    expect(await ui.find({ text: '暫停中 · 空白鍵繼續', in: 'snake' })).toBeDefined()
    await ui.input({ key: 'game-pad', text: ' ', kind: 'change' })
    await ui.advance(150 * 25)
    expect(await ui.find({ text: '遊戲結束', in: 'snake' })).toBeDefined()
  })

  gameTest(`the game menu opens the dino, space starts it and it scores on ${surface}`, async ($, on) => {
    world(on, [], '+0800')
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    await ui.press({ key: 'tab-game' })
    expect((await ui.find({ key: 'menu-snake' }))?.text).toContain('貪吃蛇')
    expect((await ui.find({ key: 'menu-dino' }))?.text).toContain('小恐龍')
    await ui.press({ key: 'menu-dino' })
    expect(await ui.find({ text: '按空白鍵開始', in: 'dino' })).toBeDefined()

    await ui.input({ key: 'game-pad', text: '  ', kind: 'change' })
    await ui.advance(70 * 10)
    expect(await ui.find({ text: '分數 5', in: 'dino' })).toBeDefined()
  })

}

for (const surface of ['terminal', 'desktop'] as const) {
  gameTest(`a bigger pane gets a bigger board on ${surface}`, async ($, on) => {
    world(on, [], '+0800')
    const big = { title: '檔案紀錄', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 40 } } as never
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: big })
    await ui.press({ key: 'tab-game' })
    await ui.press({ key: 'menu-dino' })
    // 80 columns less the frame: a 76-wide ground line.
    expect(await ui.find({ text: '_'.repeat(76), in: 'dino' })).toBeDefined()
  })
}

const DAY = 24 * 60 * 60 * 1000

for (const surface of ['terminal', 'desktop'] as const) {
  gameTest(`a high score is kept 7 days, then cleared on ${surface}`, async ($, on) => {
    const store = world(on, [], '+0800')
    store.set('snake:best', { score: 12, at: NOW - 6 * DAY })
    store.set('dino:best', { score: 300, at: NOW - 8 * DAY })
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    await ui.press({ key: 'tab-game' })

    await ui.press({ key: 'menu-snake' })
    expect(await ui.find({ text: '最高 12', in: 'snake' })).toBeDefined()

    await ui.press({ key: 'tab-game' })
    await ui.press({ key: 'menu-dino' })
    expect(await ui.find({ text: '最高 0', in: 'dino' })).toBeDefined()
    expect(store.has('dino:best')).toBe(false)
  })

  gameTest(`an old plain-number record starts its 7 days now on ${surface}`, async ($, on) => {
    const store = world(on, [], '+0800')
    store.set('snake:best', 5)
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    await ui.press({ key: 'tab-game' })
    await ui.press({ key: 'menu-snake' })
    expect(store.get('snake:best')).toEqual({ score: 5, at: NOW })
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the game tab is there only when the games ship on ${surface}`, async ($, on) => {
    world(on, [], '+0800')
    const ui = await $.ui.mount({ plugin: 'file-log-nogame', surface, component: 'Pane', requestId: 'file-log-nogame', props: PANE_PROPS })
    expect((await ui.find({ key: 'tab-game' })) !== undefined).toBe(GAMES)
    expect(await ui.find({ key: 'tab-session' })).toBeDefined()
  })
}
