<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import { storeToRefs } from "pinia";
import { useLibraryStore } from "../stores/library";

const library = useLibraryStore();
const { folderName, busy } = storeToRefs(library);
</script>

<template>
  <header class="border-b border-default">
    <UContainer class="flex max-w-3xl items-center justify-between gap-4 py-4">
      <h1 class="flex items-center gap-2 text-lg font-semibold">
        <UIcon name="i-lucide-music-2" aria-hidden="true" />
        offtone
      </h1>
      <UButton
        icon="i-lucide-folder-open"
        :disabled="!library.supported || busy"
        @click="library.selectFolder"
      >
        {{ folderName ? "フォルダーを変更" : "フォルダーを選択" }}
      </UButton>
    </UContainer>
  </header>
</template>
