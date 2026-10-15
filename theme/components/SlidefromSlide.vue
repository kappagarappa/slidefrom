<script setup>
import { computed } from 'vue'
import SlidefromContent from './SlidefromContent.vue'
import SlidefromPageFrame from './SlidefromPageFrame.vue'
import SlidefromReferences from './SlidefromReferences.vue'

const props = defineProps({
  slide: {
    type: Object,
    required: true,
  },
})

const body = computed(() => props.slide.body || [])
const bodyOf = type => computed(() => body.value.filter(node => node.type === type))
const images = bodyOf('image')
const table = computed(() => body.value.find(node => node.type === 'table'))
const tableIndex = computed(() => body.value.findIndex(node => node.type === 'table'))
const beforeTable = computed(() => tableIndex.value < 0 ? body.value : body.value.slice(0, tableIndex.value))
const afterTable = computed(() => tableIndex.value < 0 ? [] : body.value.slice(tableIndex.value + 1))
const firstSubsection = computed(() => body.value.findIndex(node => node.type === 'heading' && node.level === 3))
const beforeSubsections = computed(() => firstSubsection.value < 0 ? body.value : body.value.slice(0, firstSubsection.value))
const sections = computed(() => {
  const result = []
  let current
  for (const node of body.value) {
    if (node.type === 'heading' && node.level === 3) {
      current = { title: node, body: [] }
      result.push(current)
    } else if (current) current.body.push(node)
  }
  return result
})
const imageTextBody = computed(() => body.value.filter(node => node !== images.value[0]))
const sourceLines = node => node?.source ? `${node.source.startLine}-${node.source.endLine}` : undefined
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
  <SlidefromPageFrame :slide="slide">
        <div v-if="slide.layout === 'cover'" class="center">
        <h1 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <i class="accent-rule" />
        <SlidefromContent :nodes="body" />
      </div>

      <div v-else-if="slide.layout === 'section' || slide.layout === 'appendix-section'" class="center">
        <p class="eyebrow">{{ slide.layout === 'appendix-section' ? 'APPENDIX' : '' }}</p>
        <h1 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <i class="accent-rule long" />
        <SlidefromContent :nodes="body" />
      </div>

      <template v-else-if="['agenda', 'summary', 'references', 'bullets'].includes(slide.layout)">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <div class="rule" />
        <div :class="slide.layout">
          <SlidefromReferences v-if="slide.layout === 'references'" :nodes="body" />
          <SlidefromContent v-else :nodes="body" :presentation="slide.layout" />
        </div>
      </template>

      <template v-else-if="slide.layout === 'flow-horizontal' || slide.layout === 'flow-vertical'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <div class="rule" />
        <template v-for="node in body" :key="node.id">
          <div
            v-if="node.type === 'list'"
            :class="['flow', slide.layout === 'flow-horizontal' ? 'horizontal' : 'vertical']"
            :data-node-id="node.id"
            :data-source-lines="sourceLines(node)"
          >
            <template v-for="(item, index) in node.items" :key="item.line">
              <div class="step" :data-source-line="item.line">
                <b>{{ index + 1 }}</b>
                <span class="step-text" v-html="item.html" />
              </div>
              <i v-if="index < node.items.length - 1">{{ slide.layout === 'flow-horizontal' ? '→' : '↓' }}</i>
            </template>
          </div>
          <SlidefromContent v-else :nodes="[node]" />
        </template>
      </template>

      <template v-else-if="slide.layout === 'timeline'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <div class="rule" />
        <SlidefromContent :nodes="body" presentation="timeline" />
      </template>

      <template v-else-if="slide.layout === 'comparison'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
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
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <SlidefromContent :nodes="body" />
      </template>

      <template v-else-if="slide.layout === 'bar-chart'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <SlidefromContent :nodes="beforeTable" />
        <div v-if="table" class="chart bar" :data-node-id="table.id" :data-source-lines="sourceLines(table)">
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
        <SlidefromContent :nodes="afterTable" />
      </template>

      <template v-else-if="slide.layout === 'line-chart'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <SlidefromContent :nodes="beforeTable" />
        <div v-if="table" class="chart line" :data-node-id="table.id" :data-source-lines="sourceLines(table)">
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
        <SlidefromContent :nodes="afterTable" />
      </template>

      <div v-else-if="slide.layout === 'image-text'" class="image-text">
        <SlidefromContent :nodes="images.slice(0, 1)" />
        <article>
          <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
          <SlidefromContent :nodes="imageTextBody" />
        </article>
      </div>

      <template v-else-if="slide.layout === 'images'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <SlidefromContent :nodes="body.filter(node => node.type !== 'image')" />
        <div class="images"><SlidefromContent :nodes="images" /></div>
      </template>

      <template v-else-if="slide.layout === 'quote'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <template v-for="node in body" :key="node.id">
          <div v-if="node.type === 'quote'" class="quote">
            <SlidefromContent :nodes="[node]" />
          </div>
          <SlidefromContent v-else :nodes="[node]" />
        </template>
      </template>

      <template v-else-if="slide.layout === 'code'">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <SlidefromContent :nodes="body" />
      </template>

      <div v-else class="center statement">
        <h2 :data-node-id="slide.title?.id" :data-source-lines="sourceLines(slide.title)" v-html="slide.title?.html" />
        <SlidefromContent :nodes="body" />
      </div>
  </SlidefromPageFrame>
</template>
