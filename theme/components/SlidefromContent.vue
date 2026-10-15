<script setup>
import { defineComponent, h } from 'vue'
import SlidefromTimeline from './SlidefromTimeline.vue'

const props = defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
  presentation: {
    type: String,
    default: 'normal',
  },
})

const sourceLines = node => {
  const source = node?.source
  return source ? `${source.startLine}-${source.endLine}` : undefined
}

const headingTag = level => `h${Math.min(6, Math.max(1, Number(level) || 3))}`

const buildListTree = items => {
  const roots = []
  const stack = []
  for (const item of items || []) {
    const entry = { ...item, children: [] }
    const requestedDepth = Math.max(0, Number(item.depth) || 0)
    const depth = Math.min(requestedDepth, stack.length)
    stack.length = depth
    if (stack.length) stack.at(-1).children.push(entry)
    else roots.push(entry)
    stack.push(entry)
  }
  return roots
}

const ListBranch = defineComponent({
  name: 'SlidefromListBranch',
  props: {
    items: {
      type: Array,
      default: () => [],
    },
    ordered: Boolean,
    rootAttrs: {
      type: Object,
      default: () => ({}),
    },
    root: Boolean,
  },
  setup(branchProps) {
    return () => h(
      branchProps.ordered ? 'ol' : 'ul',
      {
        ...branchProps.rootAttrs,
        class: [
          branchProps.root && 'slidefrom-list',
          'nested-list',
          branchProps.ordered ? 'is-ordered' : 'is-unordered',
        ],
      },
      branchProps.items.map(item => h(
        'li',
        {
          key: item.line,
          'data-source-line': item.line,
          'data-depth': item.depth ?? 0,
          style: { '--depth': item.depth ?? 0 },
        },
        [
          h('div', {
            class: 'list-item-content',
            innerHTML: item.html ?? item.text ?? '',
          }),
          item.children.length
            ? h(ListBranch, { items: item.children, ordered: branchProps.ordered })
            : null,
        ],
      )),
    )
  },
})

const listAttrs = node => ({
  'data-node-id': node.id,
  'data-source-lines': sourceLines(node),
})

const isTimelineNode = node => {
  if (node.type !== 'list' || props.presentation === 'references') return false
  if (Array.isArray(node.stages)) return node.stages.length > 1
  return props.presentation === 'timeline'
}
</script>

<template>
  <template v-for="node in props.nodes" :key="node.id">
    <component
      :is="headingTag(node.level)"
      v-if="node.type === 'heading'"
      class="content-heading"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
      v-html="node.html"
    />
    <p
      v-else-if="node.type === 'paragraph'"
      class="content-paragraph"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
      v-html="node.html"
    />
    <SlidefromTimeline
      v-else-if="isTimelineNode(node)"
      :node="node"
    />
    <ListBranch
      v-else-if="node.type === 'list'"
      :items="buildListTree(node.items)"
      :ordered="node.ordered"
      :root-attrs="listAttrs(node)"
      root
    />
    <p
      v-else-if="node.type === 'reference'"
      class="reference-entry"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
    >
      <span class="reference-label" v-html="node.labelHtml || node.html || node.label || ''" />
      <a
        v-if="node.url"
        class="reference-url"
        :href="node.url"
        v-text="node.url"
      />
    </p>
    <table
      v-else-if="node.type === 'table'"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
    >
      <thead>
        <tr><th v-for="(cell, index) in node.headerHtml" :key="index" v-html="cell" /></tr>
      </thead>
      <tbody>
        <tr v-for="(row, rowIndex) in node.rowsHtml" :key="rowIndex">
          <td
            v-for="(cell, cellIndex) in row"
            :key="cellIndex"
            :class="{ 'row-head': cellIndex === 0 }"
            v-html="cell"
          />
        </tr>
      </tbody>
    </table>
    <figure
      v-else-if="node.type === 'image'"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
    >
      <img :src="node.src" :alt="node.alt">
      <figcaption v-html="node.captionHtml" />
    </figure>
    <blockquote
      v-else-if="node.type === 'quote'"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
      v-html="node.html"
    />
    <pre
      v-else-if="node.type === 'code'"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
      :data-lang="node.lang"
    ><code>{{ node.value }}</code></pre>
  </template>
</template>
