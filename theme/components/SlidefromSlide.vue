<script setup>
import { computed } from 'vue'
import SlidefromContent from './SlidefromContent.vue'

const props = defineProps({
  slide: {
    type: Object,
    required: true,
  },
})

const bodyOf = type => computed(() => props.slide.body.filter(node => node.type === type))
const paragraphs = bodyOf('paragraph')
const images = bodyOf('image')
const quotes = bodyOf('quote')
const codes = bodyOf('code')
const list = computed(() => props.slide.body.find(node => node.type === 'list'))
const table = computed(() => props.slide.body.find(node => node.type === 'table'))
const firstSubsection = computed(() => props.slide.body.findIndex(node => node.type === 'heading' && node.level === 3))
const beforeSubsections = computed(() => firstSubsection.value < 0 ? [] : props.slide.body.slice(0, firstSubsection.value))
const sections = computed(() => {
  const result = []
  let current
  for (const node of props.slide.body) {
    if (node.type === 'heading' && node.level === 3) {
      current = { title: node, body: [] }
      result.push(current)
    } else if (current) current.body.push(node)
  }
  return result
})
const imageTextBody = computed(() => props.slide.body.filter(node => node !== images.value[0]))
const sourceLines = node => `${node.source.startLine}-${node.source.endLine}`
const slideSourceLines = computed(() => {
  const nodes = [props.slide.title, ...props.slide.body].filter(Boolean)
  return `${nodes[0]?.source.startLine || 0}-${nodes.at(-1)?.source.endLine || 0}`
})
const numberFrom = value => Number(String(value).replace(/[,，\s%％¥￥$€£]/g, ''))
const chartValues = computed(() => table.value?.rows.flatMap(row => row.slice(1).map(numberFrom)) || [])
const barMax = computed(() => Math.max(...chartValues.value.map(Math.abs), 1))
const lineMin = computed(() => Math.min(...chartValues.value))
const lineMax = computed(() => Math.max(...chartValues.value))
const lineX = index => table.value.rows.length === 1 ? 50 : 5 + index * 90 / (table.value.rows.length - 1)
const lineY = value => lineMax.value === lineMin.value ? 50 : 90 - (numberFrom(value) - lineMin.value) * 80 / (lineMax.value - lineMin.value)
const linePoints = series => table.value.rows.map((row, index) => `${lineX(index)},${lineY(row[series + 1])}`).join(' ')
</script>

<template>
  <div
    :class="['slidefrom', `layout-${slide.layout}`, { 'is-appendix': slide.role === 'appendix' }]"
    :data-layout="slide.layout"
    :data-source-lines="slideSourceLines"
    :aria-label="slide.label"
  >
    <div class="slide-content">
      <div v-if="slide.layout === 'cover'" class="center">
        <h1 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <i class="accent-rule" />
        <SlidefromContent :nodes="slide.body" />
      </div>

      <div v-else-if="slide.layout === 'section' || slide.layout === 'appendix-section'" class="center">
        <p class="eyebrow">{{ slide.layout === 'appendix-section' ? 'APPENDIX' : '' }}</p>
        <h1 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <i class="accent-rule long" />
        <SlidefromContent :nodes="slide.body" />
      </div>

      <template v-else-if="['agenda', 'summary', 'references', 'bullets'].includes(slide.layout)">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <div class="rule" />
        <div :class="slide.layout"><SlidefromContent :nodes="slide.body" /></div>
      </template>

      <template v-else-if="slide.layout === 'flow-horizontal' || slide.layout === 'flow-vertical'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <div class="rule" />
        <SlidefromContent :nodes="paragraphs" />
        <div
          v-if="list"
          :class="['flow', slide.layout === 'flow-horizontal' ? 'horizontal' : 'vertical']"
          :data-node-id="list.id"
          :data-source-lines="sourceLines(list)"
        >
          <template v-for="(item, index) in list.items" :key="item.line">
            <div class="step" :data-source-line="item.line"><b>{{ index + 1 }}</b><span v-html="item.html" /></div>
            <i v-if="index < list.items.length - 1">{{ slide.layout === 'flow-horizontal' ? '→' : '↓' }}</i>
          </template>
        </div>
      </template>

      <template v-else-if="slide.layout === 'timeline'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <div class="rule" />
        <SlidefromContent :nodes="paragraphs" />
        <div v-if="list" class="timeline" :data-node-id="list.id" :data-source-lines="sourceLines(list)">
          <div v-for="item in list.items" :key="item.line" :data-source-line="item.line">
            <b v-html="item.labelHtml" /><span v-html="item.detailHtml" />
          </div>
        </div>
      </template>

      <template v-else-if="slide.layout === 'comparison'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <div class="rule" />
        <SlidefromContent :nodes="beforeSubsections" />
        <div class="comparison">
          <article v-for="section in sections" :key="section.title.id">
            <h3 :data-node-id="section.title.id" :data-source-lines="sourceLines(section.title)" v-html="section.title.html" />
            <SlidefromContent :nodes="section.body" />
          </article>
        </div>
      </template>

      <template v-else-if="slide.layout === 'table'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <SlidefromContent :nodes="paragraphs" />
        <SlidefromContent :nodes="[table]" />
      </template>

      <template v-else-if="slide.layout === 'bar-chart'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <SlidefromContent :nodes="paragraphs" />
        <div class="chart bar" :data-node-id="table.id" :data-source-lines="sourceLines(table)">
          <div class="legend">
            <span class="category-title" v-html="table.headerHtml[0]" />
            <span v-for="(name, index) in table.headerHtml.slice(1)" :key="index"><i :style="{ '--series': index }" /><span v-html="name" /></span>
          </div>
          <div v-for="(row, rowIndex) in table.rows" :key="rowIndex" class="bar-row">
            <b v-html="table.rowsHtml[rowIndex][0]" />
            <div>
              <span v-for="(value, index) in row.slice(1)" :key="index" :style="{ '--width': `${Math.abs(numberFrom(value)) / barMax * 82}%`, '--series': index }">
                <i /><em v-html="table.rowsHtml[rowIndex][index + 1]" />
              </span>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="slide.layout === 'line-chart'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <SlidefromContent :nodes="paragraphs" />
        <div class="chart line" :data-node-id="table.id" :data-source-lines="sourceLines(table)">
          <div class="legend">
            <span class="category-title" v-html="table.headerHtml[0]" />
            <span v-for="(name, index) in table.headerHtml.slice(1)" :key="index"><i :style="{ '--series': index }" /><span v-html="name" /></span>
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline v-for="(_, index) in table.header.slice(1)" :key="index" :class="`series-${index}`" :points="linePoints(index)" />
          </svg>
          <div class="line-labels">
            <div v-for="(row, rowIndex) in table.rowsHtml" :key="rowIndex" :style="{ left: `${lineX(rowIndex)}%` }">
              <b v-html="row[0]" /><span v-for="(value, index) in row.slice(1)" :key="index" :class="`series-${index}`" v-html="value" />
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="slide.layout === 'image-text'" class="image-text">
        <SlidefromContent :nodes="images.slice(0, 1)" />
        <article>
          <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
          <SlidefromContent :nodes="imageTextBody" />
        </article>
      </div>

      <template v-else-if="slide.layout === 'images'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <SlidefromContent :nodes="slide.body.filter(node => node.type !== 'image')" />
        <div class="images"><SlidefromContent :nodes="images" /></div>
      </template>

      <template v-else-if="slide.layout === 'quote'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <SlidefromContent :nodes="paragraphs" />
        <div class="quote"><SlidefromContent :nodes="quotes" /></div>
      </template>

      <template v-else-if="slide.layout === 'code'">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <SlidefromContent :nodes="paragraphs" />
        <SlidefromContent :nodes="codes" />
      </template>

      <div v-else class="center statement">
        <h2 :data-node-id="slide.title.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title.html" />
        <SlidefromContent :nodes="slide.body" />
      </div>
    </div>

    <footer>
      <span>{{ slide.role === 'appendix' ? 'APPENDIX' : '' }}</span>
      <span><b>{{ String(slide.index + 1).padStart(2, '0') }}</b> / {{ String(slide.total).padStart(2, '0') }}</span>
    </footer>
  </div>
</template>
