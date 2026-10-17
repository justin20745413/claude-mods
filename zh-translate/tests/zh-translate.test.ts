import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = { hasSurvey: false } as never

function world(on: On, translate: (prompt: string) => string) {
  const store = new Map<string, unknown>()
  const calls: string[] = []
  mock.clock(on, { now: 0 })
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  // The engine's own drawing: a reply row shows its text, the band shows nothing.
  on('ui.render', async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (e.component !== 'AssistantMessage') return Box({}) as never
    return Text({ children: (e.props as { text: string }).text }) as never
  })
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('model.complete', async (_$, e) => {
    calls.push(e.prompt)
    return { value: { isAnswered: true, text: translate(e.prompt), usage: {} } as never }
  })
  return { store, calls }
}

async function turnOn($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop') {
  const band = await $.ui.mount({ plugin: 'zh-translate', surface, component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'zh-toggle' })
  return band
}

async function finishTurn($: Parameters<Parameters<typeof test>[1]>[0], answer: string) {
  await $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't-' + answer.length, reason: 'answer' } as never)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the button turns Chinese mode on and remembers it on ${surface}`, async ($, on) => {
    const { store } = world(on, p => p)
    const band = await $.ui.mount({ plugin: 'zh-translate', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ key: 'zh-toggle' })).toBeDefined()
    expect((await band.find({ key: 'zh-toggle' }))?.text).toContain('中文 關')

    await band.press({ key: 'zh-toggle' })
    expect((await band.find({ key: 'zh-toggle' }))?.text).toContain('中文 開')
    expect(store.get('isOn')).toBe(true)
  })

  test(`with the mode on, each prompt asks for Chinese replies on ${surface}`, async ($, on) => {
    world(on, p => p)
    let context: readonly string[] | undefined
    on('prompt.submit', async (_$, e) => {
      context = e.context
      return { text: e.text }
    })

    await $.prompt.submit({ text: 'hello' })
    expect(context ?? []).toEqual([])

    await turnOn($, surface)
    await $.prompt.submit({ text: 'hello' })
    expect(context?.[0]).toContain('繁體中文')
  })

  test(`with the mode on, a question is translated before it opens on ${surface}`, async ($, on) => {
    const { calls } = world(on, () => JSON.stringify(['要用哪個資料庫？', '資料庫', 'Postgres 推薦', '穩定', 'SQLite', '簡單']))
    let shown: unknown
    on('tool.call', async (_$, e) => {
      shown = (e as { questions?: unknown }).questions
      return { result: {} as never }
    })
    await turnOn($, surface)

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [
        {
          question: 'Which database should we use?',
          header: 'Database',
          multiSelect: false,
          options: [
            { label: 'Postgres (Recommended)', description: 'Reliable and well known' },
            { label: 'SQLite', description: 'Simple file based storage' },
          ],
        },
      ],
    } as never)

    expect(calls.length).toBe(1)
    expect(shown).toEqual([
      {
        question: '要用哪個資料庫？',
        header: '資料庫',
        multiSelect: false,
        options: [
          { label: 'Postgres 推薦', description: '穩定' },
          { label: 'SQLite', description: '簡單' },
        ],
      },
    ])
  })

  test(`with the mode on, the newest English reply is shown translated on ${surface}`, async ($, on) => {
    const { calls } = world(on, () => '這是翻譯後的回覆。')
    await turnOn($, surface)
    await finishTurn($, 'The mod is updated and all tests pass now.')

    const row = await $.ui.mount({
      plugin: 'zh-translate',
      surface,
      component: 'AssistantMessage',
      props: { text: 'The mod is updated and all tests pass now.', isFirstOfReply: true } as never,
    })
    await row.redraw()
    expect(calls.length).toBe(1)
    expect(await row.find({ text: '這是翻譯後的回覆。' })).toBeDefined()
  })

  test(`a Chinese reply is left alone on ${surface}`, async ($, on) => {
    const { calls } = world(on, () => 'x')
    await turnOn($, surface)
    await $.ui.mount({
      plugin: 'zh-translate',
      surface,
      component: 'AssistantMessage',
      props: { text: '已經更新好了，測試都通過。', isFirstOfReply: true } as never,
    })
    expect(calls.length).toBe(0)
  })

  test(`an older reply is not translated, and its old translation is dropped on ${surface}`, async ($, on) => {
    const { calls } = world(on, () => '舊的翻譯。')
    await turnOn($, surface)
    const OLD = 'The first reply is finished and ready to read.'
    await finishTurn($, OLD)
    const row = await $.ui.mount({
      plugin: 'zh-translate',
      surface,
      component: 'AssistantMessage',
      props: { text: OLD, isFirstOfReply: true } as never,
    })
    await row.redraw()
    expect(calls.length).toBe(1)
    expect(await row.find({ text: '舊的翻譯。' })).toBeDefined()

    await finishTurn($, 'The second reply has arrived and replaces the first one.')
    await row.redraw()
    expect(calls.length).toBe(1)
    expect(await row.find({ text: OLD })).toBeDefined()
  })
}
