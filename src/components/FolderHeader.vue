<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import { storeToRefs } from "pinia";
import { useLibraryStore } from "../stores/library";

defineProps<{ settingsOpen?: boolean }>();
const emit = defineEmits<{ settings: [] }>();
const library = useLibraryStore();
const { folderName, busy } = storeToRefs(library);
</script>

<template>
  <header class="border-b border-default">
    <UContainer class="flex max-w-3xl items-center justify-between gap-2 py-4">
      <h1 class="flex items-center gap-2 text-lg font-semibold">
        <UIcon name="i-lucide-music-2" aria-hidden="true" />
        offtone
      </h1>
      <div class="flex min-w-0 items-center gap-2">
        <UButton
          icon="i-lucide-folder-open"
          class="min-h-11"
          :disabled="!library.supported || busy"
          @click="library.selectFolder"
        >
          {{ folderName ? "フォルダーを変更" : "フォルダーを選択" }}
        </UButton>
        <UButton
          id="settings-button"
          color="neutral"
          variant="ghost"
          icon="i-lucide-settings"
          aria-label="設定を開く"
          :aria-pressed="!!settingsOpen"
          :disabled="settingsOpen"
          class="min-h-11 min-w-11 shrink-0"
          @click="emit('settings')"
        />
      </div>
    </UContainer>
  </header>
</template>
