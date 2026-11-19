<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import { onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "../stores/settings";
import type { AlbumGrouping } from "../lib/music-catalog";
import { SORT_KEYS, type SortKey, type SortView, type Theme } from "../lib/settings";

const emit = defineEmits<{ back: [] }>();
const settings = useSettingsStore();
const { albumGrouping, librarySort, theme, ready, saving, saveFailed, status } =
  storeToRefs(settings);
const heading = ref<HTMLHeadingElement>();
const choices: { value: AlbumGrouping; label: string; description: string }[] = [
  {
    value: "metadata",
    label: "タグ優先（初期設定）",
    description:
      "アルバム名とアルバムアーティストで分類します。アルバムアーティストがない場合は曲のアーティストを使います。",
  },
  {
    value: "folder",
    label: "フォルダー優先",
    description:
      "選択した音楽ルートからの親フォルダーとアルバム名で分類します。同じフォルダーの同名アルバムは、曲のアーティストが異なっていてもまとまります。",
  },
];
const sortViews: { id: SortView; label: string }[] = [
  { id: "tracks", label: "曲" },
  { id: "albums", label: "アルバム" },
  { id: "artists", label: "アーティスト" },
];
const sortLabels: Record<SortKey<SortView>, string> = {
  library: "ライブラリ順",
  title: "曲名",
  artist: "アーティスト名",
  album: "アルバム名",
};
const themeChoices: { value: Theme; label: string }[] = [
  { value: "system", label: "システム設定に合わせる（初期設定）" },
  { value: "light", label: "ライト" },
  { value: "dark", label: "ダーク" },
];
const selectClass =
  "mt-1 block min-h-11 w-full rounded-md border border-(--ui-text-muted) bg-default px-3 text-base text-default focus-visible:outline-2 focus-visible:outline-primary";
onMounted(() => heading.value?.focus());
</script>

<template>
  <UContainer
    as="main"
    class="w-full max-w-3xl flex-1 space-y-6 py-6"
    aria-labelledby="settings-title"
  >
    <div class="space-y-3">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        class="min-h-11"
        @click="emit('back')"
      >
        ライブラリに戻る
      </UButton>
      <h2
        id="settings-title"
        ref="heading"
        tabindex="-1"
        class="text-xl font-semibold focus-visible:outline-2"
      >
        設定
      </h2>
    </div>
    <div
      class="flex flex-wrap items-center gap-2 bg-default py-2"
      :class="{ 'sr-only': ready && !saving && !status, 'sticky top-0 z-20': saving || saveFailed }"
    >
      <p
        role="status"
        class="text-sm"
        :class="saveFailed ? 'font-medium text-default' : 'text-muted'"
      >
        {{ !ready ? "設定を読み込んでいます。" : saving ? "設定を保存しています。" : status }}
      </p>
      <UButton
        v-if="saveFailed"
        color="neutral"
        variant="outline"
        class="min-h-11"
        @click="settings.retrySave()"
        >保存を再試行</UButton
      >
    </div>
    <section aria-labelledby="settings-library" class="space-y-4">
      <h3 id="settings-library" class="font-semibold">ライブラリ</h3>
      <fieldset class="space-y-3" :disabled="!ready" aria-describedby="grouping-note">
        <legend class="mb-3 font-medium">アルバムの分類方式</legend>
        <label
          v-for="choice in choices"
          :key="choice.value"
          class="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-default p-4 has-checked:border-primary has-focus-visible:outline-2"
        >
          <input
            type="radio"
            name="album-grouping"
            :value="choice.value"
            :checked="albumGrouping === choice.value"
            class="mt-1 shrink-0 accent-primary"
            @change="settings.setAlbumGrouping(choice.value)"
          />
          <span class="min-w-0 space-y-1">
            <span class="block font-medium">{{ choice.label }}</span>
            <span class="block text-sm text-muted">{{ choice.description }}</span>
          </span>
        </label>
      </fieldset>
      <p id="grouping-note" class="text-sm text-muted">
        フォルダー優先でアルバム名がない曲は、誤ってまとめないよう1曲ずつ表示します。分類を変えても、音楽タグやファイル、再生キューは変更しません。
      </p>
      <fieldset
        v-for="view in sortViews"
        :key="view.id"
        :disabled="!ready"
        class="grid gap-3 min-[320px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:grid-cols-2"
      >
        <legend class="mb-2 font-medium">{{ view.label }}の並び順</legend>
        <label class="min-w-0 text-sm">
          並び替えの基準
          <select
            :class="selectClass"
            :value="librarySort[view.id].key"
            @change="settings.setSortKey(view.id, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="key in SORT_KEYS[view.id]" :key="key" :value="key">
              {{ sortLabels[key] }}
            </option>
          </select>
        </label>
        <label class="min-w-0 text-sm">
          昇順・降順
          <select
            :class="selectClass"
            :value="librarySort[view.id].direction"
            @change="settings.setSortDirection(view.id, ($event.target as HTMLSelectElement).value)"
          >
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </label>
      </fieldset>
    </section>
    <section aria-labelledby="settings-appearance" class="space-y-4">
      <h3 id="settings-appearance" class="font-semibold">外観</h3>
      <fieldset class="space-y-3" :disabled="!ready">
        <legend class="mb-3 font-medium">テーマ</legend>
        <label
          v-for="choice in themeChoices"
          :key="choice.value"
          class="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-default p-4 has-checked:border-primary has-focus-visible:outline-2"
        >
          <input
            type="radio"
            name="theme"
            :value="choice.value"
            :checked="theme === choice.value"
            class="shrink-0 accent-primary"
            @change="settings.setTheme(choice.value)"
          />
          <span class="font-medium">{{ choice.label }}</span>
        </label>
      </fieldset>
    </section>
  </UContainer>
</template>
