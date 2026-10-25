import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/* ───────────────────────── 语料与画像 ─────────────────────────
 * 语料由桥接（或任何写入方）追加到 ~/.dsh/fish-voice/corpus.jsonl，
 * 一行一条：{"t":"2026-10-25T21:30:00Z","text":"……"}
 * 本插件只读，不碰聊天链路。
 */

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DIR = path.join(HOME, 'fish-voice')
const CORPUS = path.join(DIR, 'corpus.jsonl')
const CONFIG = path.join(DIR, 'config.json')

const DEFAULTS = { enabled: true, exemplars: 5, minMessages: 30, maxChars: 700, order: 915 }

function readConfig(host = {}) {
  const out = { ...DEFAULTS }
  try { Object.assign(out, JSON.parse(fs.readFileSync(CONFIG, 'utf8'))) } catch { /* 没配置就用默认 */ }
  for (const k of ['enabled']) if (typeof host[k] === 'boolean') out[k] = host[k]
  for (const k of ['exemplars', 'minMessages', 'maxChars', 'order']) if (Number.isFinite(host[k])) out[k] = host[k]
  return out
}

function loadCorpus() {
  let raw = ''
  try { raw = fs.readFileSync(CORPUS, 'utf8') } catch { return [] }
  const rows = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const j = JSON.parse(t)
      const text = String(j.text || '').trim()
      if (text) rows.push(text)
    } catch { /* 坏行跳过 */ }
  }
  return rows
}

const FILLERS = ['哈哈', '哈', '草', '就', '那个', '话说', '服了', '呃', '嗯', '啊', '吧', '呗']

/** 把一批句子算成一份说话画像。 */
export function profile(messages) {
  const texts = messages.map((s) => String(s || '').trim()).filter(Boolean)
  const n = texts.length
  if (!n) return null

  const lens = []
  let noPeriod = 0
  let tails = new Map()
  for (const t of texts) {
    for (const part of t.split(/[。！？!?~\n]+/)) {
      const s = part.trim()
      if (s) lens.push([...s].length)
    }
    if (!/[。！？!?]$/.test(t)) noPeriod += 1
    const first = [...t][0] || ''
    tails.set(first, (tails.get(first) || 0) + 1)
  }
  const sorted = [...lens].sort((a, b) => a - b)
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))] || 0

  const fillerRate = {}
  for (const f of FILLERS) {
    const hit = texts.reduce((acc, t) => acc + (t.split(f).length - 1), 0)
    if (hit) fillerRate[f] = +(hit / n).toFixed(2)
  }

  const openers = [...tails.entries()]
    .filter(([ch]) => ch && !' \t'.includes(ch))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([ch, c]) => ({ char: ch, count: c }))

  return {
    messages: n,
    sentences: sorted.length,
    avgChars: +(lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length)).toFixed(1),
    medianChars: pick(0.5),
    p90Chars: pick(0.9),
    longest: sorted[sorted.length - 1] || 0,
    noPeriodRatio: +(noPeriod / n).toFixed(2),
    fillerRate,
    openers,
  }
}

/** 抽几条“像样本”的原话：不太短也不太长，别全是同一句。 */
export function pickExemplars(messages, k = 5, seed = 7) {
  const pool = [...new Set(messages.map((s) => String(s || '').trim()))]
    .filter((t) => [...t].length >= 4 && [...t].length <= 40)
  if (!pool.length) return []
  const out = []
  let x = seed >>> 0
  const rand = () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 2 ** 32
  }
  while (out.length < Math.min(k, pool.length)) {
    const t = pool[Math.floor(rand() * pool.length)]
    if (!out.includes(t)) out.push(t)
  }
  return out
}

export function buildPrompt(prof, examples) {
  if (!prof) return ''
  const lines = [
    '## 他平时怎么说话（从真实聊天里统计的，不是编的）',
    `- 消息 ${prof.messages} 条；分句 ${prof.sentences} 个；平均每句 ${prof.avgChars} 字，中位 ${prof.medianChars} 字，最长 ${prof.longest} 字。`,
    `- ${Math.round(prof.noPeriodRatio * 100)}% 的消息结尾不带句号。`,
  ]
  const fr = Object.entries(prof.fillerRate).sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (fr.length) lines.push(`- 口头语密度（每条出现几次）：${fr.map(([w, r]) => `${w} ${r}`).join('、')}。`)
  if (prof.openers.length) lines.push(`- 最常拿来开头的字：${prof.openers.map((o) => `${o.char}(${o.count})`).join('、')}。`)
  if (examples.length) {
    lines.push('', '他真这么说过（照着这个语感说话，不要复述内容）：')
    for (const e of examples) lines.push(`“${e}”`)
  }
  lines.push('', '模仿的是节奏、断句、口头语和结尾习惯；不要学他的口误，也不要提这份统计。')
  return lines.join('\n')
}

/* ───────────────────────── 插件入口 ───────────────────────── */

export function apply(root, config = {}) {
  let live = readConfig(config)
  let disposePrompt = null
  let lastPrompt = ''

  function refresh() {
    const messages = loadCorpus()
    const prof = profile(messages)
    if (!prof || prof.messages < live.minMessages) {
      lastPrompt = ''
      if (disposePrompt) { disposePrompt(); disposePrompt = null }
      return { ok: true, registered: false, messages: messages.length, need: live.minMessages }
    }
    const text = buildPrompt(prof, pickExemplars(messages, live.exemplars)).slice(0, live.maxChars)
    lastPrompt = text
    if (disposePrompt) { disposePrompt(); disposePrompt = null }
    return { ok: true, registered: false, text, prof, messages: messages.length }
  }

  root.inject(['systemPrompt'], (ctx) => {
    const sync = () => {
      if (disposePrompt) { disposePrompt(); disposePrompt = null }
      const r = refresh()
      if (!r.text || !live.enabled) return
      disposePrompt = ctx.systemPrompt.section({ name: 'fish-voice:owner', order: live.order, text: r.text })
    }
    sync()
    const timer = setInterval(sync, 10 * 60 * 1000)
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer), 'dsh-fish-voice: 定时刷新画像')
  })

  root.inject(['tools'], (ctx) => {
    ctx.tools.register({
      name: 'fish_voice',
      description: '看/刷新“从真人语料里学到的说话画像”。返回句长、结尾习惯、口头语、开头字和几句原话样本。',
      parameters: {
        type: 'object',
        properties: { refresh: { type: 'boolean', description: 'true = 重新读语料再算一遍' } },
      },
      async handler(args = {}) {
        const messages = loadCorpus()
        const prof = profile(messages)
        if (!prof) return { ok: false, say: '语料还是空的（~/.dsh/fish-voice/corpus.jsonl）' }
        return {
          ok: true,
          messages: messages.length,
          need: live.minMessages,
          injected: Boolean(lastPrompt),
          profile: prof,
          exemplars: pickExemplars(messages, live.exemplars),
          refreshed: args.refresh === true,
        }
      },
    })

    ctx.tools.register({
      name: 'fish_voice_add',
      description: '手动把一句话加进真人语料（用于“教她学我说话”）。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '要收录的一句原话' } },
        required: ['text'],
      },
      async handler(args = {}) {
        const text = String(args.text || '').trim()
        if (!text) return { ok: false, say: 'text 不能为空' }
        fs.mkdirSync(DIR, { recursive: true })
        fs.appendFileSync(CORPUS, JSON.stringify({ t: new Date().toISOString(), text }) + '\n', 'utf8')
        return { ok: true, messages: loadCorpus().length }
      },
    })
  })
}
