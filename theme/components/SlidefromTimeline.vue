<script setup>
import { computed } from 'vue'

const props = defineProps({
  node: {
    type: Object,
    required: true,
  },
})

const sourceLines = node => {
  const source = node?.source
  return source ? `${source.startLine}-${source.endLine}` : undefined
}

const stages = computed(() => {
  if (Array.isArray(props.node.stages) && props.node.stages.length) return props.node.stages
  return (props.node.items || []).map(item => ({
    ...item,
    line: item.line,
    labelHtml: item.labelHtml || '',
    detailHtml: item.detailHtml || item.html || item.text || '',
  }))
})

const stageLine = stage => stage.line ?? stage.source?.startLine
</script>

<template>
  <div
    class="timeline"
    :data-node-id="node.id"
    :data-source-lines="sourceLines(node)"
  >
    <article
      v-for="(stage, index) in stages"
      :key="`${stage.line ?? stage.source?.startLine ?? index}-${index}`"
      class="timeline-stage"
      :data-source-line="stageLine(stage)"
    >
      <div class="timeline-label" v-html="stage.labelHtml || stage.label || ''" />
      <div class="timeline-detail" v-html="stage.detailHtml || stage.detail || ''" />
    </article>
  </div>
</template>
