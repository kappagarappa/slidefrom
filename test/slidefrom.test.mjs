import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { compile, parseMarkdown, planSlides, renderDeck, runCli } from '../src/slidefrom.mjs'

const execFileAsync = promisify(execFile)

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
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-cli-'))
  const input = join(directory, 'target.md')
  await writeFile(input, '# 対象')
  let launched, launchOptions
  await runCli([input, '--open'], async (outputPath, options) => { launched = outputPath; launchOptions = options })
  assert.equal(launched, join(directory, 'target.slidev.md'))
  assert.deepEqual(launchOptions, { open: true })
  assert.match(await readFile(launched, 'utf8'), /theme: ".*\/theme"/)
})

test('CLIは未展開の再帰globから一意のMarkdownを解決する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-glob-'))
  const nested = join(directory, 'nested')
  await mkdir(nested, { recursive: true })
  await writeFile(join(nested, 'target.md'), '# 対象')
  let launched
  await runCli([join(directory, '**.md')], async outputPath => { launched = outputPath })
  await runCli([join(directory, '**.md')], async outputPath => { launched = outputPath })
  assert.equal(launched, join(nested, 'target.slidev.md'))
})

test('CLIは指定出力を未展開globの候補から除外する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-glob-output-'))
  const input = join(directory, '**.md')
  const output = join(directory, 'deck.md')
  await writeFile(join(directory, 'target.md'), '# 対象')
  let launched
  await runCli([input, '-o', output], async outputPath => { launched = outputPath })
  await runCli([input, '-o', output], async outputPath => { launched = outputPath })
  assert.equal(launched, output)
})

test('CLIはglobの複数候補を勝手に選ばない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-glob-many-'))
  await Promise.all([writeFile(join(directory, 'a.md'), '# A'), writeFile(join(directory, 'b.md'), '# B')])
  await assert.rejects(runCli([join(directory, '**.md')], async () => {}), /Markdownファイルが複数見つかりました/)
})

test('CLIはbashの先行展開後も指定出力と同じglobを連続実行できる', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'slidefrom-bash-glob-'))
  await writeFile(join(directory, 'target.md'), '# 対象')
  await writeFile(join(directory, 'runner.mjs'), `import { runCli } from ${JSON.stringify(new URL('../src/slidefrom.mjs', import.meta.url).href)}
let launched
await runCli(process.argv.slice(2), async (outputPath, options) => { launched = { outputPath, options } })
console.log(JSON.stringify(launched))
`)
  const defaultCommand = 'node runner.mjs **.md --open'
  const defaultFirst = await execFileAsync('bash', ['-c', defaultCommand], { cwd: directory })
  const defaultSecond = await execFileAsync('bash', ['-c', defaultCommand], { cwd: directory })
  const defaultOutput = await realpath(join(directory, 'target.slidev.md'))
  for (const result of [defaultFirst, defaultSecond]) {
    const launched = JSON.parse(result.stdout.trim().split('\n').at(-1))
    assert.equal(launched.outputPath, defaultOutput)
    assert.deepEqual(launched.options, { open: true })
  }
  await unlink(join(directory, 'target.md'))
  await assert.rejects(execFileAsync('bash', ['-c', defaultCommand], { cwd: directory }), /生成済みの \*\.slidev\.md は入力できません/)
  await assert.rejects(readFile(join(directory, 'target.slidev.slidev.md')))

  await writeFile(join(directory, 'target.md'), '# 対象')
  const outputCommand = 'node runner.mjs **.md -o deck.md --open'
  const outputFirst = await execFileAsync('bash', ['-c', outputCommand], { cwd: directory })
  const outputSecond = await execFileAsync('bash', ['-c', outputCommand], { cwd: directory })
  const expectedOutput = await realpath(join(directory, 'deck.md'))
  for (const result of [outputFirst, outputSecond]) {
    const launched = JSON.parse(result.stdout.trim().split('\n').at(-1))
    assert.equal(launched.outputPath, expectedOutput)
    assert.deepEqual(launched.options, { open: true })
  }
  await unlink(join(directory, 'target.md'))
  await assert.rejects(execFileAsync('bash', ['-c', outputCommand], { cwd: directory }), /指定した出力先は入力にできません/)
})

test('CLIヘルプはglobの実行条件と一致する', async () => {
  const result = await execFileAsync(process.execPath, [fileURLToPath(new URL('../src/slidefrom.mjs', import.meta.url)), '--help'])
  assert.match(result.stdout, /候補が1ファイルならそのファイルを実行し/)
  assert.doesNotMatch(result.stdout, /引用符で囲み/)
})
