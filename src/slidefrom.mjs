#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadDefaultJapaneseParser } from 'budoux'

const CONTENT_TYPES = new Set(['heading', 'paragraph', 'list', 'table', 'image', 'code', 'quote'])
const japaneseParser = loadDefaultJapaneseParser()
const themePath = fileURLToPath(new URL('../theme', import.meta.url))
const slidevBin = fileURLToPath(import.meta.resolve('@slidev/cli/bin/slidev.mjs'))

export function parseMarkdown(source, file = 'input.md') {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const nodes = []
  let id = 0
  const add = (type, start, end, data = {}) => nodes.push({ id: ++id, type, source: { file, startLine: start + 1, endLine: end + 1 }, ...data })

  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    const fence = line.match(/^\s*(```+|~~~+)\s*([^ ]*)\s*$/)
    if (fence) {
      const start = i++
      const value = []
      while (i < lines.length && !new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) value.push(lines[i++])
      if (i >= lines.length) throw new Error(`${file}:${start + 1}: コードブロックが閉じられていません。`)
      add('code', start, i, { lang: fence[2], value: value.join('\n') })
      i++
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) { add('heading', i, i, { level: heading[1].length, text: heading[2] }); i++; continue }
    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) { add('hr', i, i); i++; continue }

    const image = line.trim().match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)$/)
    if (image) { add('image', i, i, { alt: image[1], url: image[2], title: image[3] || '' }); i++; continue }

    if (i + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const start = i
      const rows = [splitTableRow(line)]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitTableRow(lines[i++]))
      const width = rows[0].length
      if (width < 2 || rows.some(row => row.length !== width)) throw new Error(`${file}:${start + 1}: 表の列数が揃っていません。`)
      add('table', start, i - 1, { header: rows[0], rows: rows.slice(1) })
      continue
    }

    const listMatch = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/)
    if (listMatch) {
      const start = i
      const ordered = /^\d/.test(listMatch[2])
      const items = []
      while (i < lines.length) {
        const match = lines[i].match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/)
        if (!match || /^\d/.test(match[2]) !== ordered) break
        items.push({ text: match[3], depth: Math.floor(match[1].replace(/\t/g, '    ').length / 2), line: i + 1 })
        i++
      }
      add('list', start, i - 1, { ordered, items })
      continue
    }

    if (/^\s*>/.test(line)) {
      const start = i
      const value = []
      while (i < lines.length && /^\s*>/.test(lines[i])) value.push(lines[i++].replace(/^\s*>\s?/, ''))
      add('quote', start, i - 1, { value: value.join('\n') })
      continue
    }

    const start = i
    const value = []
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) value.push(lines[i++].trim())
    if (!value.length) throw new Error(`${file}:${i + 1}: 解釈できないMarkdownです。`)
    add('paragraph', start, i - 1, { text: value.join(' ') })
  }
  return nodes
}

function startsBlock(lines, i) {
  const line = lines[i]
  return /^#{1,6}\s+/.test(line) || /^\s*(```+|~~~+)/.test(line) || /^\s*>/.test(line) || /^(\s*)([-+*]|\d+[.)])\s+/.test(line) || /^!\[[^\]]*\]\(/.test(line.trim()) || /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line) || (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]))
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
}

export function planSlides(nodes) {
  const units = []
  let unit = null
  let seenCover = false
  let role = 'main'
  const flush = () => {
    if (unit && (unit.title || unit.body.length)) units.push(unit)
    unit = null
  }

  for (const node of nodes) {
    if (node.type === 'heading' && node.level === 1) {
      flush()
      const nextRole = sectionRole(node.text)
      if (seenCover) role = nextRole === 'main' ? 'main' : nextRole
      unit = { kind: seenCover ? 'section' : 'cover', role, title: node, body: [] }
      seenCover = true
    } else if (node.type === 'heading' && node.level === 2) {
      flush()
      unit = { kind: 'content', role, title: node, body: [] }
    } else if (node.type === 'hr') {
      flush()
    } else {
      unit ||= { kind: 'content', role, title: null, body: [] }
      unit.body.push(node)
    }
  }
  flush()

  const slides = units.map((item, index) => ({ ...item, index, layout: chooseLayout(item), nodeIds: [item.title, ...item.body].filter(Boolean).filter(node => CONTENT_TYPES.has(node.type)).map(node => node.id) }))
  validatePlan(nodes, slides)
  return slides
}

function sectionRole(text) {
  const value = plain(text).toLowerCase()
  if (/^(appendix|付録|補足資料)/i.test(value)) return 'appendix'
  if (/^(references?|sources?|出典|参考文献)/i.test(value)) return 'references'
  return 'main'
}

function chooseLayout(unit) {
  if (unit.kind === 'cover') return 'cover'
  if (unit.kind === 'section') return unit.role === 'appendix' ? 'appendix-section' : 'section'
  const title = plain(unit.title?.text || '').toLowerCase()
  if (/^(目次|agenda|contents|アジェンダ)$/.test(title)) return 'agenda'
  if (/^(まとめ|要約|結論|summary|takeaways?)$/.test(title)) return 'summary'
  if (unit.role === 'references' || /^(出典一覧|参考文献|references?|sources?)$/.test(title)) return 'references'

  const images = unit.body.filter(node => node.type === 'image')
  const table = unit.body.find(node => node.type === 'table')
  const list = unit.body.find(node => node.type === 'list')
  if (images.length >= 2) return 'images'
  if (images.length === 1) return 'image-text'
  if (unit.body.some(node => node.type === 'quote')) return 'quote'
  if (unit.body.some(node => node.type === 'code')) return 'code'
  if (subsections(unit.body).length === 2) return 'comparison'
  if (table) {
    if (numericTable(table) && /(推移|時系列|月別|年別|週別|日別|trend|over time)/i.test(title)) return 'line-chart'
    if (numericTable(table) && /(件数|売上|利用数|割合|構成|内訳|比較|chart|graph|グラフ)/i.test(title)) return 'bar-chart'
    return 'table'
  }
  if (list && looksLikeTimeline(list)) return 'timeline'
  if (list?.ordered) return list.items.length <= 4 ? 'flow-horizontal' : 'flow-vertical'
  if (list) return 'bullets'
  return 'statement'
}

function subsections(nodes) {
  const result = []
  let current = null
  for (const node of nodes) {
    if (node.type === 'heading' && node.level === 3) {
      current = { title: node, body: [] }
      result.push(current)
    } else if (current) current.body.push(node)
  }
  return result
}

function numericTable(table) {
  return table.rows.length > 1 && table.rows.every(row => row.slice(1).length && row.slice(1).every(cell => Number.isFinite(numberFrom(cell))))
}

function looksLikeTimeline(list) {
  return list.items.length > 1 && list.items.every(item => /(^|\s)(\d{4}年|\d{1,2}月|\d{1,2}[/-]\d{1,2}|Q[1-4]|第\d+[期章]|春|夏|秋|冬)(\s|[:：]|$)/i.test(plain(item.text)))
}

function validatePlan(nodes, slides) {
  const expected = nodes.filter(node => CONTENT_TYPES.has(node.type)).map(node => node.id)
  const actual = slides.flatMap(slide => slide.nodeIds)
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) throw new Error('入力内容の順序または対応関係を保持できませんでした。')
}

export function renderDeck(nodes, slides, options = {}) {
  const title = plain(slides[0]?.title?.text || 'slidefrom')
  const total = slides.length
  const sections = slides.slice(1).map((slide, offset) => {
    const index = offset + 1
    return `---\nlayout: slidefrom\ntitle: ${JSON.stringify(plain(slide.title?.text || `スライド ${index + 1}`))}\nslide: ${JSON.stringify(viewSlide(slide, index, total, options.imageSources))}\n---`
  }).join('\n\n')
  return `---
theme: ${JSON.stringify(options.theme || 'default')}
title: ${JSON.stringify(title)}
aspectRatio: 297/210
canvasWidth: 1587
colorSchema: light
layout: slidefrom
defaults:
  layout: slidefrom
slide: ${JSON.stringify(viewSlide(slides[0], 0, total, options.imageSources))}
---

${sections}
`
}

function viewSlide(slide, index, total, imageSources) {
  return {
    ...slide,
    index,
    total,
    label: plain(slide.title?.text || `スライド ${index + 1}`),
    title: slide.title && viewNode(slide.title, imageSources),
    body: slide.body.map(node => viewNode(node, imageSources)),
  }
}

function viewNode(node, imageSources) {
  if (node.type === 'heading' || node.type === 'paragraph') return { ...node, html: kumi(node.text) }
  if (node.type === 'list') return { ...node, items: node.items.map(item => {
    const timeline = item.text.match(/^(.+?)([:：]\s*)(.+)$/)
    return { ...item, html: kumi(item.text), labelHtml: inline(timeline ? timeline[1] + timeline[2] : ''), detailHtml: kumi(timeline ? timeline[3] : item.text) }
  }) }
  if (node.type === 'table') return { ...node, headerHtml: node.header.map(kumi), rowsHtml: node.rows.map(row => row.map(kumi)) }
  if (node.type === 'image') return { ...node, src: imageSources?.get(node.url) || safeUrl(node.url, true), captionHtml: kumi(node.title || node.alt) }
  if (node.type === 'quote') return { ...node, html: kumi(node.value).replace(/\n/g, '<br>') }
  return node
}

function numberFrom(value) {
  const number = Number(String(value).replace(/[,，\s%％¥￥$€£]/g, ''))
  return Number.isFinite(number) ? number : NaN
}

function inline(value = '') {
  let text = escapeHtml(value)
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/\[([^\]]+)\]\(([^ )]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, url) => `<a href="${safeUrl(decodeEntities(url), false)}">${label}</a>`)
  return text
}

const kumi = value => japaneseParser.translateHTMLString(inline(value))

function plain(value = '') {
  return value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim()
}

function safeUrl(value, imageUrl) {
  const url = String(value).trim()
  if (/^(https?:|mailto:|#|\.\.?\/|\/)/i.test(url) || (!/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith('//')) || (imageUrl && /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);/i.test(url))) {
    return escapeHtml(imageUrl && !/^(?:[a-z][a-z\d+.-]*:|#|\.?\.?\/)/i.test(url) ? `./${url}` : url)
  }
  return imageUrl ? '' : '#'
}

function decodeEntities(value) {
  return value.replace(/&amp;/g, '&')
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

export async function compile(input, output) {
  const inputPath = resolve(input)
  if (extname(inputPath).toLowerCase() !== '.md') throw new Error(`${input}: 入力には.mdファイルを指定してください。`)
  const source = await readFile(inputPath, 'utf8')
  const nodes = parseMarkdown(source, inputPath)
  if (!nodes.length) throw new Error(`${input}: 内容がありません。`)
  const slides = planSlides(nodes)
  const imageSources = await embedLocalImages(slides, inputPath)
  const outputPath = resolve(output || inputPath.replace(/\.md$/i, '.slidev.md'))
  if (extname(outputPath).toLowerCase() !== '.md') throw new Error(`${outputPath}: 出力には.mdファイルを指定してください。`)
  const mapPath = outputPath.replace(/\.md$/i, '.map.json')
  const sourceMap = nodes.filter(node => CONTENT_TYPES.has(node.type)).map(node => ({ id: node.id, type: node.type, source: node.source, slide: slides.findIndex(slide => slide.nodeIds.includes(node.id)) + 1 }))
  await Promise.all([
    writeFile(outputPath, renderDeck(nodes, slides, { theme: themePath, imageSources }), 'utf8'),
    writeFile(mapPath, JSON.stringify({ input: inputPath, slides: slides.length, nodes: sourceMap }, null, 2) + '\n', 'utf8'),
  ])
  return { outputPath, mapPath, slides }
}

async function embedLocalImages(slides, inputPath) {
  const sources = new Map()
  const images = slides.flatMap(slide => slide.body).filter(node => node.type === 'image' && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(node.url))
  for (const image of images) {
    if (sources.has(image.url)) continue
    const path = resolve(dirname(inputPath), image.url)
    const mime = ({ '.avif': 'image/avif', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' })[extname(path).toLowerCase()]
    if (!mime) throw new Error(`${image.source.file}:${image.source.startLine}: 対応していない画像形式です: ${image.url}`)
    try {
      sources.set(image.url, `data:${mime};base64,${(await readFile(path)).toString('base64')}`)
    } catch {
      throw new Error(`${image.source.file}:${image.source.startLine}: 画像を読み込めません: ${image.url}`)
    }
  }
  return sources
}

function usage() {
  return `使い方: slidefrom <input.md> [-o output.slidev.md] [--open]\n\n指定したMarkdownを組版し、Slidevで表示します。`
}

export function startSlidev(outputPath, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const args = [slidevBin, outputPath]
    if (options.open) args.push('--open')
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') resolvePromise()
      else reject(new Error(`Slidevが終了しました（終了コード: ${code ?? signal}）。`))
    })
  })
}

export async function runCli(argv, launch = startSlidev) {
  if (argv.includes('-h') || argv.includes('--help')) { console.log(usage()); return }
  let input, output, open = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' || argv[i] === '--output') output = argv[++i]
    else if (argv[i] === '--open') open = true
    else if (argv[i].startsWith('-')) throw new Error(`不明なオプションです: ${argv[i]}`)
    else if (!input) input = argv[i]
    else throw new Error(`入力は1ファイルだけ指定できます: ${argv[i]}`)
  }
  if (!input) throw new Error('入力Markdownが指定されていません。\n' + usage())
  if ((argv.includes('-o') || argv.includes('--output')) && !output) throw new Error('出力先が指定されていません。')
  const { outputPath, slides } = await compile(input, output)
  console.log(`${slides.length}枚を生成しました: ${outputPath}`)
  console.log(slides.map((slide, index) => `${String(index + 1).padStart(2, '0')}  ${slide.layout}  ${plain(slide.title?.text || '')}`).join('\n'))
  await launch(outputPath, { open })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runCli(process.argv.slice(2)).catch(error => { console.error(`slidefrom: ${error.message}`); process.exitCode = 1 })
