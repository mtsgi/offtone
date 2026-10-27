<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import { storeToRefs } from "pinia";
import { useLibraryStore } from "../stores/library";
import { usePlayerStore } from "../stores/player";

const library = useLibraryStore();
const player = usePlayerStore();
const { directory, folderName, status, busy, needsPermission } = storeToRefs(library);
const { tracks, index, playing, error: playerError } = storeToRefs(player);
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
      :description="folderName"
    >
      <template #actions>
        <UButton size="sm" @click="library.restorePermission">アクセスを許可</UButton>
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

    <UCard v-if="busy" aria-live="polite"> フォルダーを読み込んでいます。 </UCard>
    <UCard v-else-if="!tracks.length && !needsPermission">
      <p class="flex items-start gap-2 text-sm text-muted">
        <UIcon name="i-lucide-file-music" class="mt-0.5 shrink-0" aria-hidden="true" />
        {{
          folderName
            ? "MP3・M4A・FLAC ファイルが見つかりませんでした。"
            : "音楽が入ったフォルダーを選択してください。"
        }}
      </p>
    </UCard>
    <UCard v-else-if="tracks.length" :ui="{ body: 'p-0 sm:p-0' }">
      <ul aria-label="曲一覧" class="divide-y divide-default">
        <li v-for="(track, trackIndex) in tracks" :key="track.path">
          <UButton
            block
            color="neutral"
            :variant="index === trackIndex ? 'soft' : 'ghost'"
            class="justify-start rounded-none text-left"
            :aria-current="index === trackIndex ? 'true' : undefined"
            @click="player.playAt(trackIndex)"
          >
            <span class="w-8 shrink-0 text-center text-muted">{{ trackIndex + 1 }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{
                track.name.replace(/\.[^.]+$/, "")
              }}</span>
              <span class="block truncate text-xs text-muted">{{ track.path }}</span>
            </span>
            <UBadge v-if="index === trackIndex" color="neutral" variant="subtle">
              {{ playing ? "再生中" : "選択中" }}
            </UBadge>
          </UButton>
        </li>
      </ul>
    </UCard>
  </UContainer>
</template>
