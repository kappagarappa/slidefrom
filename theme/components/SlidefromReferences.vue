<script setup>
import SlidefromContent from './SlidefromContent.vue'

defineProps({
  nodes: {
    type: Array,
    default: () => [],
  },
})
</script>

<template>
  <section class="references-content" aria-label="出典">
    <SlidefromContent :nodes="nodes" presentation="references" />
  </section>
</template>
