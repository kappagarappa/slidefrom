<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  slide: {
    type: Object,
    required: true,
  },
})

const viewport = ref()
const content = ref()
const fitScale = ref(1)
let resizeObserver
let fitRequest = 0
let mounted = false

const slideSourceLines = () => {
  const nodes = [props.slide.title, ...(props.slide.body || [])].filter(node => node?.source)
  return nodes.length ? `${nodes[0].source.startLine}-${nodes.at(-1).source.endLine}` : '0-0'
}

const contentFits = () => {
  if (!viewport.value || !content.value || !viewport.value.clientWidth || !viewport.value.clientHeight) return true
  const viewportRect = viewport.value.getBoundingClientRect()
  const contentRect = content.value.getBoundingClientRect()
  let left = contentRect.left
  let top = contentRect.top
  let right = contentRect.left
  let bottom = contentRect.top
  for (const element of content.value.querySelectorAll('*')) {
    for (const rect of element.getClientRects()) {
      left = Math.min(left, rect.left)
      top = Math.min(top, rect.top)
      right = Math.max(right, rect.right)
      bottom = Math.max(bottom, rect.bottom)
    }
  }
  return contentRect.left - left <= 1
    && contentRect.top - top <= 1
    && right - contentRect.left <= viewportRect.width + 1
    && bottom - contentRect.top <= viewportRect.height + 1
}

const fitContent = async () => {
  const request = ++fitRequest
  fitScale.value = 1
  await nextTick()
  if (!mounted || request !== fitRequest || !viewport.value?.clientWidth || !viewport.value.clientHeight || !content.value) return
  if (contentFits()) return

  let low = .01
  let high = 1
  for (let pass = 0; pass < 8; pass++) {
    const candidate = (low + high) / 2
    fitScale.value = candidate
    await nextTick()
    if (!mounted || request !== fitRequest) return
    if (contentFits()) low = candidate
    else high = candidate
  }
  fitScale.value = low
  await nextTick()
}

onMounted(async () => {
  mounted = true
  await fitContent()
  const fontReady = document.fonts?.ready
  if (fontReady) fontReady.then(() => mounted && fitContent())
  if (typeof ResizeObserver === 'function' && viewport.value) {
    resizeObserver = new ResizeObserver(fitContent)
    resizeObserver.observe(viewport.value)
  }
})

onBeforeUnmount(() => {
  mounted = false
  fitRequest++
  resizeObserver?.disconnect()
})
</script>

<template>
  <div
    :class="['slidefrom', `layout-${slide.layout}`, { 'is-appendix': slide.role === 'appendix' }]"
    :style="{ '--fit-scale': fitScale }"
    :data-layout="slide.layout"
    :data-fit-scale="fitScale.toFixed(3)"
    :data-source-lines="slideSourceLines()"
    :aria-label="slide.label"
  >
    <div ref="viewport" class="slide-content">
      <div ref="content" class="slide-content-fit">
        <slot />
      </div>
    </div>

    <footer>
      <span>{{ slide.role === 'appendix' ? 'APPENDIX' : '' }}</span>
      <span><b>{{ String(slide.index + 1).padStart(2, '0') }}</b> / {{ String(slide.total).padStart(2, '0') }}</span>
    </footer>
  </div>
</template>
