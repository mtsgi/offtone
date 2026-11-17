<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import UButton from "@nuxt/ui/components/Button.vue";
import { onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useSettingsStore } from "../stores/settings";
import type { AlbumGrouping } from "../lib/music-catalog";

const emit = defineEmits<{ back: [] }>();
const settings = useSettingsStore();
const { albumGrouping, ready, saving, saveFailed, status } = storeToRefs(settings);
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
      <p role="status" class="text-sm text-muted">
        {{ !ready ? "設定を読み込んでいます。" : saving ? "設定を保存しています。" : status }}
      </p>
      <UButton
        v-if="saveFailed"
        color="neutral"
        variant="outline"
        class="min-h-11"
        @click="settings.setAlbumGrouping(albumGrouping)"
        >保存を再試行</UButton
      >
    </section>
  </UContainer>
</template>
