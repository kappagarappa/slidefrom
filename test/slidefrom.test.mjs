import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compile, parseMarkdown, planSlides, renderDeck } from '../src/slidefrom.mjs'

const markdown = `# 表紙

副題

## 箇条書き

- A
- B

## 手順

1. 読む
2. 選ぶ
3. 出す

## 比較

### A案

- 速い

### B案

- 丁寧

## 月別推移

| 月 | 数 |
|---|---:|
| 4月 | 10 |
| 5月 | 20 |

# Appendix

## 詳細

補足
`

test('Markdownの順序を保ってレイアウトを選ぶ', () => {
  const nodes = parseMarkdown(markdown)
  const slides = planSlides(nodes)
  assert.deepEqual(slides.map(slide => slide.layout), ['cover', 'bullets', 'flow-horizontal', 'comparison', 'line-chart', 'appendix-section', 'statement'])
  assert.deepEqual(slides.flatMap(slide => slide.nodeIds), nodes.filter(node => node.type !== 'hr').map(node => node.id))
})

test('時系列ラベルの複数箇条書きだけをタイムラインとして表示する', () => {
  const arrowNodes = parseMarkdown('# 表紙\n\n## 予定\n\n- 7月 → 8月 → 9月')
  const arrowSlides = planSlides(arrowNodes)
  assert.equal(arrowSlides[1].layout, 'bullets')
  const arrowRendered = renderDeck(arrowNodes, arrowSlides)
  const arrowRenderedSlides = [...arrowRendered.matchAll(/^slide: (.+)$/gm)].map(match => JSON.parse(match[1]))
  assert.deepEqual(arrowRenderedSlides[1].body.find(node => node.type === 'list').items.map(item => item.text), ['7月 → 8月 → 9月'])

  const monthlyNodes = parseMarkdown('# 表紙\n\n## 予定\n\n- 7月：企画\n- 8月：制作\n- 9月：公開')
  assert.equal(planSlides(monthlyNodes)[1].layout, 'timeline')

  const datedNodes = parseMarkdown(`# 表紙

## 予定

- 7月1日：企画
- 2026年7月1日：制作
- 2026/07/01：公開
- 2026-07-01：振り返り`)
  const datedSlides = planSlides(datedNodes)
  assert.equal(datedSlides[1].layout, 'timeline')
  const datedRenderedSlides = [...renderDeck(datedNodes, datedSlides).matchAll(/^slide: (.+)$/gm)].map(match => JSON.parse(match[1]))
  const datedItems = datedRenderedSlides[1].body.find(node => node.type === 'list').items
  assert.deepEqual(datedItems.map(item => item.text), [
    '7月1日：企画',
    '2026年7月1日：制作',
    '2026/07/01：公開',
    '2026-07-01：振り返り',
  ])
  assert.deepEqual(datedItems.map(item => item.labelHtml), ['7月1日：', '2026年7月1日：', '2026/07/01：', '2026-07-01：'])
  assert.deepEqual(datedItems.map(item => item.detailHtml.replace(/<[^>]+>/g, '')), ['企画', '制作', '公開', '振り返り'])

  const numericNodes = parseMarkdown('# 表紙\n\n## 数値\n\n- 1件：売上\n- 2件：利益')
  assert.equal(planSlides(numericNodes)[1].layout, 'bullets')
})

test('危険なリンクを実行可能なURLとして出力しない', () => {
  const nodes = parseMarkdown('# 安全性\n\n## リンク\n\n[実行](javascript:alert(1))')
  const markdown = renderDeck(nodes, planSlides(nodes))
  assert.ok(!markdown.includes('href=\\"javascript:'))
  assert.ok(markdown.includes('href=\\"#\\"'))
})

test('出典ではリンク先URLを印刷できる文字として併記する', () => {
  const nodes = parseMarkdown('# 出典\n\n## 出典一覧\n\n- [デジタル庁デザインシステム](https://design.digital.go.jp/dads/)')
  const rendered = renderDeck(nodes, planSlides(nodes))
  const renderedSlides = [...rendered.matchAll(/^slide: (.+)$/gm)].map(match => JSON.parse(match[1]))
  const html = renderedSlides[1].body.find(node => node.type === 'list').items[0].html
  assert.match(html, /href="https:\/\/design\.digital\.go\.jp\/dads\/"/)
  assert.match(html, /<span class="reference-url">https:\/\/design\.digital\.go\.jp\/dads\/<\/span>/)
})

test('すべての本文ノードで外部リンクURLを併記しコードと内部リンクは除外する', () => {
  const markdown = `# 表紙 [表紙リンク](https://cover.example/日本語)

本文の前[本文リンク](https://body.example/one)本文の後と[二つ目](https://body.example/two?lang=ja)。

危険な[危険](javascript:alert(1))リンクも安全化する。

## 本文[本文タイトル](https://main.example/title)

本文[見出し本文](https://heading.example/path)の前後。

- 箇条書きの前[箇条書き](https://list.example/item)の後

## 表

| 項目 | 値 |
|---|---|
| 行[表](https://table.example/row) | [表URL](https://table.example/value) |

## 引用

> 引用の[リンク](https://quote.example/source)です。

## 画像

![画像](https://image.example/image.png "キャプション[画像](https://caption.example/text)")

## 予定

- 1月：[予定](https://timeline.example/january)
- 2月：[予定二](https://timeline.example/february)

## コード

\`[コード](https://code.example/raw)\`

# Appendix

## 付録[見出し](https://appendix.example/title)

付録の[本文](https://appendix.example/body)。

# 出典

## 出典一覧

- [出典](https://references.example/source)
- [https://same.example/url](https://same.example/url)
- [内部](#本文)`
  const nodes = parseMarkdown(markdown)
  const rendered = renderDeck(nodes, planSlides(nodes))
  const slides = [...rendered.matchAll(/^slide: (.+)$/gm)].map(match => JSON.parse(match[1]))
  const htmlValues = []
  const collectHtml = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('html') || key.endsWith('Html')) htmlValues.push(child)
      else if (child && typeof child === 'object') collectHtml(child)
    }
  }
  collectHtml(slides)
  const html = htmlValues.flat(Infinity).join('\n')

  for (const url of [
    'https://cover.example/日本語',
    'https://body.example/one',
    'https://body.example/two?lang=ja',
    'https://heading.example/path',
    'https://main.example/title',
    'https://list.example/item',
    'https://table.example/row',
    'https://table.example/value',
    'https://quote.example/source',
    'https://caption.example/text',
    'https://timeline.example/january',
    'https://timeline.example/february',
    'https://appendix.example/title',
    'https://appendix.example/body',
    'https://references.example/source',
  ]) {
    assert.match(html, new RegExp(`<span class="reference-url">${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/span>`))
  }
  assert.doesNotMatch(html, /<span class="reference-url">https:\/\/same\.example\/url<\/span>/)
  assert.doesNotMatch(html, /<span class="reference-url">#本文<\/span>/)
  assert.match(html, /<a href="#">/) // keep unsafe schemes inert when rendered
  assert.doesNotMatch(html, /href="https:\/\/code\.example\/raw"/)
  assert.match(html.replace(/\u200b/g, ''), /本文の前.*本文の後/)
})

test('CLIと同じ経路でSlidev Markdownとソースマップを生成する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-'))
  const input = join(directory, 'input.md')
  const output = join(directory, 'deck.slidev.md')
  await writeFile(input, markdown)
  const result = await compile(input, output)
  const slidev = await readFile(output, 'utf8')
  const sourceMap = JSON.parse(await readFile(result.mapPath, 'utf8'))
  assert.equal(result.slides.length, 7)
  assert.match(slidev, /aspectRatio: 297\/210/)
  assert.match(slidev, /layout: slidefrom/)
  assert.match(slidev, /"layout":"comparison"/)
  assert.ok(!slidev.includes('<div class="slidefrom'))
  assert.equal(sourceMap.nodes.length, 16)
})

test('閉じていないコードブロックは場所と対処が分かるエラーにする', () => {
  assert.throws(() => parseMarkdown('# 題\n\n```js\nalert(1)', 'broken.md'), /broken\.md:3: コードブロックが閉じられていません/)
})

test('日本語の見出しと本文をBudouXで文字組する', () => {
  const nodes = parseMarkdown('# 問い合わせ基盤の構成\n\nサイト側とバックエンドを分ける。')
  const slidev = renderDeck(nodes, planSlides(nodes))
  assert.match(slidev, /"html":"<span style=\\"word-break:keep-all;overflow-wrap:anywhere\\">/)
  assert.ok(slidev.includes('\u200b'))
})

test('ローカル画像をSlidevの表示とビルドで使える形にする', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-image-'))
  const input = join(directory, 'input.md')
  const output = join(directory, 'deck.slidev.md')
  await Promise.all([writeFile(input, '# 表紙\n\n## 画像\n\n![代替](image.png)'), writeFile(join(directory, 'image.png'), Buffer.from('image'))])
  await compile(input, output)
  assert.match(await readFile(output, 'utf8'), /"src":"data:image\/png;base64,aW1hZ2U="/)
})

test('CLIは既定出力を入力の隣に保存し一時deckをSlidevへ渡す', async () => {
  const { runCli } = await import('../src/slidefrom.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-cli-'))
  const input = join(directory, 'target.md')
  await writeFile(input, '# 対象')
  let launched, launchOptions
  const messages = []
  const originalLog = console.log
  console.log = (...args) => messages.push(args.join(' '))
  try {
    await runCli([input, '--open'], async (outputPath, options) => { launched = outputPath; launchOptions = options })
  } finally {
    console.log = originalLog
  }
  assert.equal(messages[0], `1枚を生成しました: ${join(directory, 'target.slidev.md')}`)
  assert.notEqual(launched, join(directory, 'target.slidev.md'))
  assert.equal(launched.endsWith('/deck.slidev.md'), true)
  assert.deepEqual(launchOptions, { open: true })
  await assert.rejects(() => access(launched), { code: 'ENOENT' })
  await access(join(directory, 'target.slidev.md'))
  await assert.rejects(() => access(join(directory, 'target.slidev.map.json')), { code: 'ENOENT' })
  await assert.rejects(() => access(join(directory, 'node_modules', '.slidev')), { code: 'ENOENT' })
})

test('CLIの明示出力はdeckだけ残してSlidevを一時deckで起動する', async () => {
  const { runCli } = await import('../src/slidefrom.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-cli-output-'))
  const input = join(directory, 'target.md')
  const output = join(directory, 'output.slidev.md')
  await writeFile(input, '# 対象')
  let launched
  const messages = []
  const originalLog = console.log
  console.log = (...args) => messages.push(args.join(' '))
  try {
    await runCli([input, '-o', output], async outputPath => { launched = outputPath })
  } finally {
    console.log = originalLog
  }
  assert.equal(messages[0], `1枚を生成しました: ${output}`)
  assert.notEqual(launched, output)
  assert.match(await readFile(output, 'utf8'), /theme: ".*\/theme"/)
  await assert.rejects(() => access(join(directory, 'output.slidev.map.json')), { code: 'ENOENT' })
  await assert.rejects(() => access(join(directory, 'node_modules', '.slidev')), { code: 'ENOENT' })
  await assert.rejects(() => access(launched), { code: 'ENOENT' })
})

test('Ctrl-C相当のシグナル後に一時deckを削除しsignal handlerを外す', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-cli-signal-'))
  const input = join(directory, 'target.md')
  const started = join(directory, 'started.json')
  const finished = join(directory, 'finished.json')
  await writeFile(input, '# 対象')
  const script = `
import { writeFileSync } from 'node:fs'
import { runCli } from ${JSON.stringify(new URL('../src/slidefrom.mjs', import.meta.url).href)}

const [input, started, finished] = process.argv.slice(1)
await runCli([input], async outputPath => {
  writeFileSync(started, JSON.stringify({ outputPath, sigintHandlers: process.listenerCount('SIGINT') }))
  process.kill(process.pid, 'SIGINT')
  await new Promise(resolve => setImmediate(resolve))
})
writeFileSync(finished, JSON.stringify({
  sigintHandlers: process.listenerCount('SIGINT'),
  sigtermHandlers: process.listenerCount('SIGTERM'),
}))
`
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, input, started, finished], { encoding: 'utf8' })
    assert.equal(result.status, 130)
    const launched = JSON.parse(await readFile(started, 'utf8'))
    const completed = JSON.parse(await readFile(finished, 'utf8'))
    assert.equal(launched.sigintHandlers, 1)
    assert.equal(completed.sigintHandlers, 0)
    assert.equal(completed.sigtermHandlers, 0)
    await assert.rejects(() => access(launched.outputPath), { code: 'ENOENT' })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('CLIはシンボリックリンク経由でも起動する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-bin-'))
  const command = join(directory, 'slidefrom')
  await symlink(join(import.meta.dirname, '../src/slidefrom.mjs'), command)
  const result = spawnSync(command, ['--help'], { encoding: 'utf8', timeout: 2000 })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /使い方: slidefrom/)
})
