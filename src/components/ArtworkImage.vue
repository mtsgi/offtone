<script setup vapor lang="ts">
import { ref } from "vue";

const props = defineProps<{ src?: string }>();
const failedSrc = ref<string>();
function onError(event: Event): void {
  const failed = (event.currentTarget as HTMLImageElement).getAttribute("src");
  if (failed && failed === props.src) failedSrc.value = failed;
}
</script>

<template>
  <img
    v-if="src && failedSrc !== src"
    :key="src"
    :src="src"
    alt=""
    class="absolute inset-0 h-full w-full object-cover"
    @error="onError"
  />
</template>
