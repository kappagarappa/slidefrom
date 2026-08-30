import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
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

test('危険なリンクを実行可能なURLとして出力しない', () => {
  const nodes = parseMarkdown('# 安全性\n\n## リンク\n\n[実行](javascript:alert(1))')
  const markdown = renderDeck(nodes, planSlides(nodes))
  assert.ok(!markdown.includes('href=\\"javascript:'))
  assert.ok(markdown.includes('href=\\"#\\"'))
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

test('CLIは指定したMarkdownだけを変換してSlidevへ渡す', async () => {
  const { runCli } = await import('../src/slidefrom.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-cli-'))
  const input = join(directory, 'target.md')
  await writeFile(input, '# 対象')
  let launched, launchOptions
  await runCli([input, '--open'], async (outputPath, options) => { launched = outputPath; launchOptions = options })
  assert.equal(launched, join(directory, 'target.slidev.md'))
  assert.deepEqual(launchOptions, { open: true })
  assert.match(await readFile(launched, 'utf8'), /theme: ".*\/theme"/)
})
