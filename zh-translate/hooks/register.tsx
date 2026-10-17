import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// 中文模式：
// 1. Claude 之後的回覆直接用繁體中文寫（每個提示旁邊附一句只有模型看得到的指示）
// 2. 最新一則英文回覆翻譯後顯示（只改顯示，對話紀錄不變）；翻譯只留這一則，下一輪就清掉
// 3. 選擇題（AskUserQuestion）在跳出前先翻成中文

const isOn = atom({ plugin: 'zh-translate', key: 'isOn' } as const, false)
const translations = atom({ plugin: 'zh-translate', key: 'translations' } as const, {} as Record<string, string>)
const latest = atom({ plugin: 'zh-translate', key: 'latest' } as const, '')

const STORE_KEY = 'isOn'
// The cheapest Claude model ($0.10 / $0.50 per million tokens), thinking kept to a minimum.
const MODEL = 'claude-haiku-5-5'
const EFFORT = 'low' as const
const MAX_PARALLEL = 3

const REPLY_IN_CHINESE =
  'The user has turned on Chinese mode: write every reply to the user in Traditional Chinese (繁體中文, Taiwan usage), ' +
  'including AskUserQuestion questions, headers, option labels and descriptions. ' +
  'Keep code, commands, file paths and identifiers as they are.'

const TRANSLATE_SYSTEM =
  'You translate text into Traditional Chinese (繁體中文, Taiwan usage). ' +
  'Keep Markdown structure, code blocks, inline code, commands, file paths, URLs, numbers and product names unchanged. ' +
  'Reply with the translation only, no preamble.'

// Text that is already mostly Chinese, or has no letters to translate, is left alone.
export function needsTranslation(text: string): boolean {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  const cjk = (prose.match(/[㐀-鿿]/g) ?? []).length
  const latinWords = (prose.match(/[A-Za-z]{2,}/g) ?? []).length
  if (latinWords < 3) return false
  return latinWords > cjk / 2
}

// A block belongs to the newest reply when its text is part of that reply's final text.
export function isLatestReply(text: string, latestAnswer: string): boolean {
  const t = text.trim()
  return t !== '' && latestAnswer !== '' && latestAnswer.includes(t)
}

function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36) + ':' + text.length
}

// ---- Reply blocks: translated in the background, a few at a time ----

const pending = new Set<string>()
const queue: { key: string; text: string }[] = []
let running = 0

function requestTranslation($: EngineInterface, key: string, text: string): void {
  if (pending.has(key)) return
  pending.add(key)
  queue.push({ key, text })
  pump($)
}

function pump($: EngineInterface): void {
  while (running < MAX_PARALLEL && queue.length > 0) {
    const job = queue.shift()!
    running++
    void translateBlock($, job.key, job.text).finally(() => {
      running--
      pending.delete(job.key)
      pump($)
    })
  }
}

async function translateBlock($: EngineInterface, key: string, text: string): Promise<void> {
  const reply = await $.model.complete({
    model: MODEL,
    effort: EFFORT,
    system: TRANSLATE_SYSTEM,
    prompt: text,
    maxTokens: Math.min(16000, text.length * 2 + 256),
  })
  if (!reply.isAnswered || !reply.text.trim()) return
  // A newer reply arrived while this one was translating: drop it.
  if (!isLatestReply(text, await read($, latest))) return
  await update($, translations, all => ({ ...all, [key]: reply.text.trim() }))
}

// ---- Questions: every shown string translated in one call, before the dialog opens ----

type Option = { label?: unknown; description?: unknown; [k: string]: unknown }
type Question = { question?: unknown; header?: unknown; options?: unknown; [k: string]: unknown }

export async function translateQuestions($: EngineInterface, questions: readonly Question[]): Promise<Question[] | undefined> {
  const strings: string[] = []
  const take = (v: unknown) => {
    if (typeof v === 'string') strings.push(v)
  }
  for (const q of questions) {
    take(q.question)
    take(q.header)
    for (const o of Array.isArray(q.options) ? (q.options as Option[]) : []) {
      take(o.label)
      take(o.description)
    }
  }
  if (!needsTranslation(strings.join('\n'))) return undefined

  const reply = await $.model.complete({
    model: MODEL,
    effort: EFFORT,
    system:
      TRANSLATE_SYSTEM +
      ' The input is a JSON array of strings; reply with a JSON array of the same length, each string translated in place. ' +
      'Strings that are short headers must stay at most 12 characters.',
    prompt: JSON.stringify(strings),
    maxTokens: Math.min(8000, JSON.stringify(strings).length * 2 + 256),
  })
  if (!reply.isAnswered) return undefined
  let out: unknown
  try {
    out = JSON.parse(reply.text.slice(reply.text.indexOf('['), reply.text.lastIndexOf(']') + 1))
  } catch {
    return undefined
  }
  if (!Array.isArray(out) || out.length !== strings.length || !out.every(s => typeof s === 'string')) return undefined

  let i = 0
  const next = (v: unknown) => (typeof v === 'string' ? (out as string[])[i++] : v)
  return questions.map(q => {
    const question = next(q.question)
    const header = next(q.header)
    const options = Array.isArray(q.options)
      ? (q.options as Option[]).map(o => {
          const label = next(o.label)
          const description = next(o.description)
          return { ...o, label, description }
        })
      : q.options
    return {
      ...q,
      question,
      header: typeof header === 'string' ? header.slice(0, 12) : header,
      options,
    }
  })
}

async function setOn($: EngineInterface, on: boolean): Promise<void> {
  await update($, isOn, () => on)
  await $.store.set(STORE_KEY, on)
  $.ui.toast(on ? '中文模式已開啟' : '中文模式已關閉')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = (await $.store.get(STORE_KEY)) === true
    await update($, isOn, () => stored)
    await $.command.register({ name: 'zh', description: '切換中文模式：Claude 的回覆和選擇題都變成繁體中文' })
    return next(e)
  })

  on('command.run', { command: 'zh' }, async $ => {
    const now = !(await read($, isOn))
    await setOn($, now)
    return { text: now ? '中文模式：開' : '中文模式：關' }
  })

  // Future replies: ask the model itself to write in Chinese.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || !(await read($, isOn))) return next(e)
    return next({ ...e, context: [...(e.context ?? []), REPLY_IN_CHINESE] })
  })

  // Questions: translate before the dialog opens, so the choices are Chinese too.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const translated = await translateQuestions($, e.questions as readonly Question[])
    return next(translated ? ({ ...e, questions: translated } as typeof e) : e)
  }).catch(($, e, next) => next(e))

  // Remember the newest reply and forget older translations.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const answer = e.answer.trim()
      await update($, latest, () => answer)
      await update($, translations, () => ({}))
    }
    return done
  })

  // The newest reply on screen: show the translation once it is ready.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)
    const text = e.props.text
    if (!needsTranslation(text)) return next(e)
    if (!isLatestReply(text, await read($, latest))) return next(e)
    const key = hash(text)
    const done = (await read($, translations))[key]
    if (done) return next({ ...e, props: { ...e.props, text: done } })
    // Only rows in view are translated; scrolling to the others brings them in.
    if (e.props.onScreen !== null) requestTranslation($, key, text)
    return next(e)
  })

  // The button above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const active = await read($, isOn)
    // Other mods' bands are drawn below this one, not replaced.
    const below = await next(e)
    return (
      <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Button key="zh-toggle" variant={active ? 'primary' : 'secondary'} label={active ? '中文 開' : '中文 關'} onPress={() => setOn($, !active)} />
        <Text dimColor>{active ? '回覆與選擇題會顯示成繁體中文' : '點一下或輸入 /zh 切換成中文'}</Text>
      </Box>
      {below}
      </Box>
    )
  })
}
