<script setup>
defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
})

const sourceLines = node => `${node.source.startLine}-${node.source.endLine}`
</script>

<template>
  <template v-for="node in nodes" :key="node.id">
    <h3
      v-if="node.type === 'heading'"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
      v-html="node.html"
    />
    <p
      v-else-if="node.type === 'paragraph'"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
      v-html="node.html"
    />
    <component
      :is="node.ordered ? 'ol' : 'ul'"
      v-else-if="node.type === 'list'"
      :data-node-id="node.id"
      :data-source-lines="sourceLines(node)"
    >
      <li
        v-for="item in node.items"
        :key="item.line"
        :data-source-line="item.line"
        :style="{ '--depth': item.depth }"
        v-html="item.html"
      />
    </component>
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
