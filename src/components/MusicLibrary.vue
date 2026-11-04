<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import { storeToRefs } from "pinia";
import { useLibraryStore } from "../stores/library";
import { usePlayerStore } from "../stores/player";
import LibraryBrowser from "./LibraryBrowser.vue";

const library = useLibraryStore();
const player = usePlayerStore();
const {
  directory,
  folderName,
  permissionFolderName,
  status,
  busy,
  needsPermission,
  permissionState,
  analysis,
  analysisStatus,
  analysisCancelled,
} = storeToRefs(library);
const { tracks, error: playerError } = storeToRefs(player);
</script>

<template>
  <UContainer as="main" class="w-full max-w-3xl flex-1 space-y-4 py-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-base font-semibold">ライブラリ</h2>
        <p class="truncate text-sm text-muted">
          {{ folderName || "フォルダーが選択されていません" }}
          <span v-if="folderName && !needsPermission"> · {{ tracks.length }} 曲</span>
        </p>
      </div>
      <UButton
        v-if="directory && !needsPermission"
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :disabled="busy"
        @click="library.refresh"
      >
        更新
      </UButton>
    </div>

    <UAlert
      v-if="!library.supported"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="フォルダーを選択できません"
      description="HTTPS で開き、Chrome や Edge などの対応ブラウザーをご利用ください。"
      role="alert"
    />
    <UAlert
      v-else-if="needsPermission"
      color="warning"
      variant="soft"
      icon="i-lucide-shield-check"
      title="フォルダーへのアクセスを再許可してください"
      :description="`${permissionFolderName}：${permissionState === 'denied' ? 'アクセスが拒否されています。ブラウザーの設定を確認するか、フォルダーを選び直してください。' : permissionState === 'unavailable' ? '再許可できない場合はフォルダーを選び直してください。' : 'アクセスを許可するか、フォルダーを選び直してください。'}`"
    >
      <template #actions>
        <UButton size="sm" :disabled="busy" @click="library.restorePermission"
          >再許可を試す</UButton
        >
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="library.selectFolder"
          >フォルダーを選び直す</UButton
        >
      </template>
    </UAlert>
    <UAlert
      v-if="status"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="status"
      role="alert"
    />
    <UAlert
      v-if="playerError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="playerError"
      role="alert"
    />

    <div v-if="analysis.active" class="flex items-center gap-3 text-sm text-muted">
      <span>タグを解析中 {{ analysis.done }} / {{ analysis.total }}</span>
      <UButton size="xs" color="neutral" variant="outline" @click="library.cancelAnalysis"
        >キャンセル</UButton
      >
    </div>
    <UButton
      v-if="analysisCancelled && !analysis.active && !busy"
      size="xs"
      color="neutral"
      variant="outline"
      @click="library.analyze"
      >タグ解析を再開</UButton
    >
    <p v-if="analysisStatus" class="text-sm text-muted" role="status">{{ analysisStatus }}</p>
    <p v-if="busy && tracks.length" class="text-sm text-muted" role="status">
      フォルダーを更新しています。
    </p>
    <UCard v-if="busy && !tracks.length" aria-live="polite"> フォルダーを読み込んでいます。 </UCard>
    <UCard v-if="!busy && !tracks.length && !needsPermission">
      <p class="flex items-start gap-2 text-sm text-muted">
        <UIcon name="i-lucide-file-music" class="mt-0.5 shrink-0" aria-hidden="true" />
        {{
          folderName
            ? "MP3・M4A・FLAC ファイルが見つかりませんでした。"
            : "音楽が入ったフォルダーを選択してください。"
        }}
      </p>
    </UCard>
    <LibraryBrowser v-else-if="tracks.length" :tracks="tracks" :directory="directory" />
  </UContainer>
</template>
