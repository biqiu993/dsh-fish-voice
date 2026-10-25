import test from 'node:test'
import assert from 'node:assert/strict'
import { profile, pickExemplars, buildPrompt } from '../lib/index.js'

const corpus = [
  '今天下班有点晚',
  '那个 明天几点出发',
  '这破电脑又卡了',
  '你先吃吧 别等我',
  '哈 这也太离谱了',
  '我周末想去爬山',
  '嗯 我知道了',
  '就 按你说的办',
]

test('profile 统计句长与结尾习惯', () => {
  const p = profile(corpus)
  assert.equal(p.messages, corpus.length)
  assert.ok(p.avgChars > 0)
  assert.ok(p.medianChars > 0)
  assert.ok(p.noPeriodRatio > 0.8, '这批句子几乎都不带句号')
})

test('profile 抓到口头语', () => {
  const p = profile(corpus)
  assert.ok('就' in p.fillerRate || '哈' in p.fillerRate || '那个' in p.fillerRate)
})

test('pickExemplars 不重复，且长度在合理区间', () => {
  const ex = pickExemplars(corpus, 4)
  assert.equal(new Set(ex).size, ex.length)
  assert.ok(ex.length <= 4)
  for (const e of ex) {
    const n = [...e].length
    assert.ok(n >= 4 && n <= 40)
  }
})

test('buildPrompt 带统计和原话样本', () => {
  const p = profile(corpus)
  const text = buildPrompt(p, pickExemplars(corpus, 3))
  assert.match(text, /平均每句/)
  assert.match(text, /他真这么说过/)
  assert.match(text, /不要提这份统计/)
})

test('quote/profile 空语料返回 null', () => {
  assert.equal(profile([]), null)
})
