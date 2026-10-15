#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { loadDefaultJapaneseParser } from 'budoux'

const CONTENT_TYPES = new Set(['heading', 'paragraph', 'list', 'table', 'image', 'code', 'quote'])
const REFERENCE_PAGE_MAX_ITEMS = 8
const REFERENCE_PAGE_MAX_CHARS = 560
const TIMELINE_TOKEN = '(?:\\d{4}年\\d{1,2}月\\d{1,2}日|\\d{4}年\\d{1,2}月|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{1,2}月\\d{1,2}日|\\d{1,2}月|\\d{4}年|\\d{1,2}[/-]\\d{1,2}|Q[1-4]|第\\d+[期章]|春|夏|秋|冬)'
const japaneseParser = loadDefaultJapaneseParser()
const themePath = fileURLToPath(new URL('../theme', import.meta.url))
const slidevBin = fileURLToPath(import.meta.resolve('@slidev/cli/bin/slidev.mjs'))
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 }
let runningSlidev = null

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

  const { entries, existingUrls } = collectReferences(units)
  const generatedReferences = entries
    .filter(entry => !existingUrls.has(entry.url))
    .map((entry, index) => createReferenceNode(entry, index))
  const splitSlides = slides.flatMap(splitReferenceSlide)
  const finalSlides = generatedReferences.length
    ? [...splitSlides, ...referenceSlides(generatedReferences)]
    : splitSlides
  validatePlan(nodes, finalSlides)
  return finalSlides.map((slide, index) => ({ ...slide, index }))
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
  if (list && analyzeTimeline(list).isTimeline) return 'timeline'
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

function normalizeTimelineDigits(value) {
  return value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - '０'.charCodeAt(0) + 48))
}

function rawGapKind(value, start, gap) {
  if (!gap) return ''
  if (gap.startsWith('[') || gap.startsWith('`')) return 'opening'
  if (gap.startsWith(']')) return 'closing'
  const marker = gap.match(/^(\*\*|__|[*_~])/i)?.[1]
  if (!marker) return ''
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const priorMarkers = [...value.slice(0, start).matchAll(new RegExp(escaped, 'g'))].length
  return priorMarkers % 2 ? 'closing' : 'opening'
}

function visibleTextWithMap(value = '') {
  const text = []
  const map = []
  const rawEnd = []
  const gapKind = []
  let trailingRawStart = value.length
  let trailingRawKind = ''
  const append = (char, offset) => {
    const previousEnd = rawEnd.at(-1) || 0
    const gap = value.slice(previousEnd, offset)
    text.push(char)
    map.push(offset)
    gapKind.push(rawGapKind(value, previousEnd, gap))
    rawEnd.push(offset + 1)
    trailingRawStart = value.length
    trailingRawKind = ''
  }
  const markSkipped = (offset, kind = 'opening') => {
    if (trailingRawStart === value.length) {
      trailingRawStart = offset
      trailingRawKind = kind
    }
  }
  const appendRange = (start, end) => {
    for (let i = start; i < end;) {
      if (value[i] === '`') {
        const fence = value.slice(i).match(/^`+/)[0]
        const close = value.indexOf(fence, i + fence.length)
        if (close >= 0 && close + fence.length <= end) {
          markSkipped(i, 'opening')
          i = close + fence.length
          continue
        }
      }
      if (value[i] === '[') {
        const close = value.indexOf(']', i + 1)
        if (close >= 0 && close + 1 < end && value[close + 1] === '(') {
          let linkEnd = close + 2
          let depth = 1
          while (linkEnd < value.length && depth) {
            if (value[linkEnd] === '(') depth++
            else if (value[linkEnd] === ')') depth--
            linkEnd++
          }
          if (depth === 0 && linkEnd <= end) {
            const before = text.length
            appendRange(i + 1, close)
            if (text.length === before) markSkipped(i, 'opening')
            i = linkEnd
            continue
          }
        }
      }
      if (value.startsWith('**', i) || value.startsWith('__', i)) {
        markSkipped(i, 'closing')
        i += 2
        continue
      }
      if (/[*_~]/.test(value[i])) {
        markSkipped(i, 'closing')
        i++
        continue
      }
      append(value[i], i)
      i++
    }
  }
  appendRange(0, value.length)
  return { text: text.join(''), map, rawEnd, gapKind, trailingRawStart, trailingRawKind }
}

function rawSliceFromVisible(value, visible, start, end, options = {}) {
  if (start > end) return ''
  if (start === end) {
    return start === visible.text.length && visible.trailingRawStart < value.length
      ? value.slice(visible.trailingRawStart)
      : ''
  }
  const rawStart = start === 0 ? 0 : visible.rawEnd[start - 1] ?? visible.map[start] ?? value.length
  let rawEnd = end === visible.text.length
    ? options.includeTrailing === false && visible.trailingRawKind === 'opening'
      ? visible.trailingRawStart
      : value.length
    : visible.map[end] ?? value.length
  if (end < visible.text.length && end > 0) {
    const previousEnd = visible.rawEnd[end - 1] ?? rawEnd
    const gap = value.slice(previousEnd, rawEnd)
    if (gap.startsWith('[') || gap.startsWith('`')) rawEnd = previousEnd
    else {
      const marker = gap.match(/^(\*\*|__|[*_~])/i)?.[1]
      if (marker) {
        const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const priorMarkers = [...value.slice(0, previousEnd).matchAll(new RegExp(escaped, 'g'))].length
        if (priorMarkers % 2 === 0) rawEnd = previousEnd
      }
    }
  }
  return value.slice(rawStart, rawEnd)
}

function trimVisibleRange(value, visible, start, end) {
  while (start < end && /\s/.test(visible.text[start])) start++
  while (end > start && /\s/.test(visible.text[end - 1])) end--
  return { start, end, raw: rawSliceFromVisible(value, visible, start, end) }
}

function parseTimelineStage(value) {
  const visible = visibleTextWithMap(value)
  const normalized = normalizeTimelineDigits(visible.text)
  const match = normalized.match(new RegExp(`^(${TIMELINE_TOKEN})(.*)$`, 'i'))
  if (!match) return null
  const tokenLength = match[1].length
  const remainder = visible.text.slice(tokenLength)
  if (remainder && !/^\s*$/.test(remainder)) {
    const delimiter = remainder.match(/^(\s*[:：]\s*|\s*[-‐‑–—]\s*|\s+)/)
    if (!delimiter) return null
    let labelEnd = tokenLength + delimiter[0].length
    const delimiterWhitespaceStart = labelEnd
      - delimiter[0].match(/\s*$/)[0].length
    if (delimiterWhitespaceStart < labelEnd && visible.gapKind.slice(delimiterWhitespaceStart, labelEnd).includes('opening')) {
      labelEnd = delimiterWhitespaceStart
    }
    const labelRaw = rawSliceFromVisible(value, visible, 0, labelEnd, { includeTrailing: false })
    const detailRaw = rawSliceFromVisible(value, visible, labelEnd, visible.text.length).trim()
    return { labelHtml: inline(labelRaw), detailHtml: detailRaw ? kumi(detailRaw) : '', labelRaw, detailRaw }
  }
  const labelRaw = rawSliceFromVisible(value, visible, 0, tokenLength)
  return { labelHtml: inline(labelRaw), detailHtml: '', labelRaw, detailRaw: '' }
}

function parseTimelineItem(value) {
  const visible = visibleTextWithMap(value)
  const normalized = normalizeTimelineDigits(visible.text)
  const arrowMatches = [...normalized.matchAll(/(?:→|⇒|->)/g)]
  if (arrowMatches.length) {
    const ranges = []
    let start = 0
    for (const arrow of arrowMatches) {
      ranges.push(trimVisibleRange(value, visible, start, arrow.index))
      start = arrow.index + arrow[0].length
    }
    ranges.push(trimVisibleRange(value, visible, start, visible.text.length))
    const stages = ranges.map(range => parseTimelineStage(range.raw))
    if (stages.length > 1 && stages.every(Boolean)) return stages
  }
  const stage = parseTimelineStage(value)
  return stage ? [stage] : null
}

function analyzeTimeline(list) {
  if (!list?.items?.length) return { isTimeline: false, stages: [], itemStages: new Map() }
  const rootDepth = Math.min(...list.items.map(item => item.depth))
  const groups = []
  let current = null
  for (const item of list.items) {
    if (item.depth > rootDepth) {
      if (!current) return { isTimeline: false, stages: [], itemStages: new Map() }
      current.nested.push(item)
      continue
    }
    const parsed = parseTimelineItem(item.text)
    if (!parsed) return { isTimeline: false, stages: [], itemStages: new Map() }
    current = { item, parsed, nested: [] }
    groups.push(current)
  }

  const stages = []
  const itemStages = new Map()
  for (const group of groups) {
    const endLine = group.nested.at(-1)?.line || group.item.line
    const nestedHtml = group.nested.map(item => kumi(item.text)).join('<br>')
    const parsedStages = group.parsed.map((stage, index) => {
      const detailHtml = index === group.parsed.length - 1 && nestedHtml
        ? [stage.detailHtml, nestedHtml].filter(Boolean).join('<br>')
        : stage.detailHtml
      return {
        ...stage,
        line: group.item.line,
        source: { ...list.source, startLine: group.item.line, endLine },
        detailHtml,
      }
    })
    itemStages.set(group.item, parsedStages)
    stages.push(...parsedStages)
  }
  return { isTimeline: stages.length > 1, stages, itemStages }
}

function validatePlan(nodes, slides) {
  const expected = nodes.filter(node => CONTENT_TYPES.has(node.type)).map(node => node.id)
  const actual = slides.flatMap(slide => slide.nodeIds)
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) throw new Error('入力内容の順序または対応関係を保持できませんでした。')
}

function isReferenceUnit(unit) {
  return unit.role === 'references' || /^(出典|参考文献|references?|sources?)/i.test(plain(unit.title?.text || ''))
}

function maskCodeSpans(value = '') {
  return value.replace(/`+[^`]*`+/g, match => ' '.repeat(match.length))
}

function externalLinks(value = '') {
  const links = []
  const masked = maskCodeSpans(value)
  const pattern = /\[([^\]]+)\]\(([^ )]+)(?:\s+["'][^"']*["'])?\)/g
  for (const match of masked.matchAll(pattern)) {
    const url = decodeEntities(match[2])
    if (/^https?:\/\//i.test(url)) links.push({ url, label: decodeEntities(match[1]) })
  }
  return links
}

function externalUrls(value = '') {
  return [...maskCodeSpans(value).matchAll(/https?:\/\/[^\s<>)"']+/gi)]
    .map(match => decodeEntities(match[0]).replace(/[.,、。]+$/g, ''))
    .filter(url => /^https?:\/\//i.test(url))
}

function sourceForItem(node, item) {
  return { ...node.source, startLine: item.line, endLine: item.line }
}

function collectReferences(units) {
  const entries = new Map()
  const existingUrls = new Set()
  const add = (value, source, isReference) => {
    if (isReference) for (const url of externalUrls(value)) existingUrls.add(url)
    for (const link of externalLinks(value)) {
      if (isReference) existingUrls.add(link.url)
      const entry = entries.get(link.url) || { url: link.url, labels: [], source, sources: [] }
      if (!entry.labels.includes(link.label)) entry.labels.push(link.label)
      entry.sources.push(source)
      entries.set(link.url, entry)
    }
  }
  for (const unit of units) {
    const isReference = isReferenceUnit(unit)
    if (unit.title) add(unit.title.text, unit.title.source, isReference)
    for (const node of unit.body) {
      if (node.type === 'heading' || node.type === 'paragraph') add(node.text, node.source, isReference)
      else if (node.type === 'list') for (const item of node.items) add(item.text, sourceForItem(node, item), isReference)
      else if (node.type === 'table') {
        for (const value of node.header) add(value, node.source, isReference)
        for (const row of node.rows) for (const value of row) add(value, node.source, isReference)
      } else if (node.type === 'quote') add(node.value, node.source, isReference)
      else if (node.type === 'image') add(node.title || node.alt, node.source, isReference)
    }
  }
  return { entries: [...entries.values()], existingUrls }
}

function createReferenceNode(entry, index) {
  const labels = entry.labels.length ? entry.labels : [entry.url]
  return {
    type: 'reference',
    id: `reference-${index + 1}`,
    derived: true,
    source: entry.source,
    labelHtml: labels.map(label => inline(label)).join(' / '),
    url: entry.url,
    labels,
  }
}

function referenceWeight(item) {
  const links = externalLinks(item.text || '')
  return plain(item.text || '').length + links.reduce((total, link) => total + link.url.length, 0)
}

function referenceNodeWeight(reference) {
  return reference.labels.join(' ').length + reference.url.length
}

function referenceContentWeight(node) {
  const values = node.type === 'heading' || node.type === 'paragraph'
    ? [node.text]
    : node.type === 'quote' || node.type === 'code'
      ? [node.value]
      : node.type === 'image'
        ? [node.alt, node.title]
        : node.type === 'table'
          ? [...node.header, ...node.rows.flat()]
          : []
  return values.filter(Boolean).reduce((total, value) => total + plain(value).length + externalLinks(value).reduce((sum, link) => sum + link.url.length, 0), 0)
}

function referencePageBudget(mixedWeight = 0) {
  if (!mixedWeight) return { maxItems: REFERENCE_PAGE_MAX_ITEMS, maxChars: REFERENCE_PAGE_MAX_CHARS }
  const reservedItems = Math.min(4, Math.max(3, Math.ceil(mixedWeight / 24)))
  return {
    maxItems: Math.max(4, REFERENCE_PAGE_MAX_ITEMS - reservedItems),
    maxChars: Math.max(320, REFERENCE_PAGE_MAX_CHARS - Math.min(240, mixedWeight * 2)),
  }
}

function referenceChunks(items, weightOf = referenceWeight, budget = referencePageBudget()) {
  const chunks = []
  let chunk = []
  let weight = 0
  for (const item of items) {
    const itemWeight = weightOf(item)
    if (chunk.length && (chunk.length >= budget.maxItems || weight + itemWeight > budget.maxChars)) {
      chunks.push(chunk)
      chunk = []
      weight = 0
    }
    chunk.push(item)
    weight += itemWeight
  }
  if (chunk.length) chunks.push(chunk)
  return chunks
}

function derivedReferenceTitle(title, pageIndex) {
  if (pageIndex === 0) return title
  return {
    ...title,
    id: `reference-title-${title?.id || 'generated'}-${pageIndex + 1}`,
    derived: true,
  }
}

function splitReferenceSlide(slide) {
  if (slide.layout !== 'references') return [slide]
  const pages = [{ body: [], nodeIds: [], weight: 0, mixedWeight: 0, listItems: 0, listWeight: 0 }]
  const sourceNodeIds = node => CONTENT_TYPES.has(node.type) ? [node.id] : []
  const currentPage = () => pages.at(-1)
  const newPage = () => pages.push({ body: [], nodeIds: [], weight: 0, mixedWeight: 0, listItems: 0, listWeight: 0 })
  pages[0].nodeIds.push(...(slide.title && CONTENT_TYPES.has(slide.title.type) ? [slide.title.id] : []))

  for (const node of slide.body) {
    if (node.type !== 'list') {
      const weight = referenceContentWeight(node)
      const page = currentPage()
      if (page.body.length && page.weight && page.weight + weight > REFERENCE_PAGE_MAX_CHARS) newPage()
      currentPage().body.push(node)
      currentPage().nodeIds.push(...sourceNodeIds(node))
      currentPage().weight += weight
      currentPage().mixedWeight += weight
      continue
    }

    let remaining = node.items
    let chunkIndex = 0
    while (remaining.length) {
      const page = currentPage()
      const pageBudget = referencePageBudget(page.mixedWeight)
      if (page.listItems && (page.listItems >= pageBudget.maxItems || page.listWeight >= pageBudget.maxChars)) {
        newPage()
        continue
      }
      const availableBudget = {
        maxItems: Math.max(1, pageBudget.maxItems - page.listItems),
        maxChars: Math.max(1, pageBudget.maxChars - page.listWeight),
      }
      const chunk = referenceChunks(remaining, referenceWeight, availableBudget)[0]
      const listChunk = { ...node, items: chunk, ...(chunkIndex ? { id: `reference-list-${node.id}-${chunkIndex + 1}`, derived: true } : {}) }
      page.body.push(listChunk)
      if (!chunkIndex) page.nodeIds.push(node.id)
      const chunkWeight = chunk.reduce((total, item) => total + referenceWeight(item), 0)
      page.weight += chunkWeight
      page.listItems += chunk.length
      page.listWeight += chunkWeight
      remaining = remaining.slice(chunk.length)
      chunkIndex++
      if (remaining.length) newPage()
    }
  }

  return pages.map((page, index) => ({
    ...slide,
    title: derivedReferenceTitle(slide.title, index),
    body: page.body,
    nodeIds: page.nodeIds,
  }))
}

function referenceSlides(references) {
  const chunks = referenceChunks(references, referenceNodeWeight)
  return chunks.map((items, index) => {
    const first = items[0]
    return {
      kind: 'generated-references',
      role: 'references',
      layout: 'references',
      title: {
        type: 'heading',
        id: `reference-title-generated-${index + 1}`,
        derived: true,
        source: first.source,
        level: 2,
        text: '出典',
      },
      body: items,
      nodeIds: [],
    }
  })
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
  const showLinkUrls = slide.layout === 'references'
  return {
    ...slide,
    index,
    total,
    label: plain(slide.title?.text || `スライド ${index + 1}`),
    title: slide.title && viewNode(slide.title, imageSources, showLinkUrls),
    body: slide.body.map(node => viewNode(node, imageSources, showLinkUrls)),
  }
}

function viewNode(node, imageSources, showLinkUrls = false) {
  if (node.type === 'heading' || node.type === 'paragraph') return { ...node, html: kumi(node.text, { showLinkUrls }) }
  if (node.type === 'list') {
    const timeline = analyzeTimeline(node)
    return {
      ...node,
      stages: timeline.isTimeline ? timeline.stages : [],
      items: node.items.map(item => {
        const stages = timeline.itemStages.get(item) || []
        const first = stages[0]
        return {
          ...item,
          html: kumi(item.text, { showLinkUrls }),
          labelHtml: first?.labelHtml || '',
          detailHtml: first?.detailHtml || kumi(item.text, { showLinkUrls }),
        }
      }),
    }
  }
  if (node.type === 'table') return { ...node, headerHtml: node.header.map(value => kumi(value, { showLinkUrls })), rowsHtml: node.rows.map(row => row.map(value => kumi(value, { showLinkUrls }))) }
  if (node.type === 'image') return { ...node, src: imageSources?.get(node.url) || safeUrl(node.url, true), captionHtml: kumi(node.title || node.alt, { showLinkUrls }) }
  if (node.type === 'quote') return { ...node, html: kumi(node.value, { showLinkUrls }).replace(/\n/g, '<br>') }
  return node
}

function numberFrom(value) {
  const number = Number(String(value).replace(/[,，\s%％¥￥$€£]/g, ''))
  return Number.isFinite(number) ? number : NaN
}

function inline(value = '', options = {}) {
  let text = escapeHtml(value)
  const codeSpans = []
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(code)
    return `\u0000code${codeSpans.length - 1}\u0000`
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/\[([^\]]+)\]\(([^ )]+)(?:\s+["'][^"']*["'])?\)/g, (_, label, url) => {
    const decodedUrl = decodeEntities(url)
    const visibleUrl = escapeHtml(decodedUrl)
    const isExternal = /^https?:\/\//i.test(decodedUrl)
    const suffix = options.showLinkUrls && isExternal && decodeEntities(label) !== decodedUrl ? `<span class="reference-url">${visibleUrl}</span>` : ''
    return `<a href="${safeUrl(decodedUrl, false)}">${label}${suffix}</a>`
  })
  return text.replace(/\u0000code(\d+)\u0000/g, (_, index) => `<code>${codeSpans[index]}</code>`)
}

const kumi = (value, options = {}) => japaneseParser.translateHTMLString(inline(value, options)).replace(/(<span class="reference-url">)(.*?)(<\/span>)/g, (_, start, url, end) => `${start}${url.replace(/\u200b/g, '')}${end}`)

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
  const derivedMap = slides.flatMap((slide, index) => slide.body.filter(node => node.type === 'reference').map(node => ({ id: node.id, type: node.type, source: node.source, slide: index + 1 })))
  await Promise.all([
    writeFile(outputPath, renderDeck(nodes, slides, { theme: themePath, imageSources }), 'utf8'),
    writeFile(mapPath, JSON.stringify({ input: inputPath, slides: slides.length, nodes: sourceMap, derivedNodes: derivedMap }, null, 2) + '\n', 'utf8'),
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
    const child = spawn(process.execPath, args, { cwd: dirname(outputPath), stdio: 'inherit' })
    runningSlidev = child
    const clearRunningSlidev = () => {
      if (runningSlidev === child) runningSlidev = null
    }
    child.once('error', error => {
      clearRunningSlidev()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearRunningSlidev()
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
  const outputPath = resolve(output || input.replace(/\.md$/i, '.slidev.md'))
  if (outputPath && extname(outputPath).toLowerCase() !== '.md') throw new Error(`${outputPath}: 出力には.mdファイルを指定してください。`)
  const workingDirectory = await mkdtemp(join(tmpdir(), 'slidefrom-'))
  const workingDeck = join(workingDirectory, 'deck.slidev.md')
  let receivedSignal = null
  const handleSignal = signal => {
    receivedSignal ||= signal
    runningSlidev?.kill(signal)
  }
  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)
  try {
    const { slides } = await compile(input, workingDeck)
    await copyFile(workingDeck, outputPath)
    console.log(`${slides.length}枚を生成しました: ${outputPath}`)
    console.log(slides.map((slide, index) => `${String(index + 1).padStart(2, '0')}  ${slide.layout}  ${plain(slide.title?.text || '')}`).join('\n'))
    if (!receivedSignal) await launch(workingDeck, { open })
  } finally {
    try {
      await rm(workingDirectory, { recursive: true, force: true })
    } finally {
      process.off('SIGINT', handleSignal)
      process.off('SIGTERM', handleSignal)
      if (receivedSignal) process.exitCode = signalExitCodes[receivedSignal]
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(process.argv.slice(2)).catch(error => { console.error(`slidefrom: ${error.message}`); process.exitCode = 1 })
