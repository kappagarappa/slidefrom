<script setup>
import SlidefromSlide from '../components/SlidefromSlide.vue'

defineProps({
  slide: {
    type: Object,
    required: true,
  },
})
</script>

<template>
  <div class="slidev-layout slidefrom-page">
    <SlidefromSlide :slide="slide" />
  </div>
</template>
