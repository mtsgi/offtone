<script setup vapor lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { computed, nextTick, useTemplateRef, watch } from "vue";
import {
  buildFolderTree,
  folderAncestors,
  matchingFolderPaths,
  parentFolderPath,
  type Track,
} from "../lib/library";
import { sortTracks } from "../lib/library-sort";
import { useSettingsStore } from "../stores/settings";
import TrackList from "./TrackList.vue";

const props = defineProps<{
  tracks: Track[];
  matches?: Track[];
  path: string;
  rootName?: string;
}>();
const emit = defineEmits<{ navigateFolder: [path: string] }>();
const settings = useSettingsStore();
const panel = useTemplateRef("panel");
const tree = computed(() => buildFolderTree(props.tracks));
const breadcrumbs = computed(() => folderAncestors(tree.value, props.path));
const folder = computed(() => breadcrumbs.value[breadcrumbs.value.length - 1]!);
const visiblePaths = computed(() => props.matches && matchingFolderPaths(props.matches));
const matchingTracks = computed(() => props.matches && new Set(props.matches));
const children = computed(() =>
  folder.value.children.filter((child) => visiblePaths.value?.has(child.path) ?? true),
);
const tracks = computed(() =>
  sortTracks(
    folder.value.tracks.filter((track) => matchingTracks.value?.has(track) ?? true),
    settings.librarySort.tracks,
  ),
);

watch([() => props.path, () => folder.value.path], async ([requested, path], [, previous]) => {
  if (path !== requested) emit("navigateFolder", path);
  if (path === previous || !panel.value?.contains(document.activeElement)) return;
  await nextTick();
  const opener = [
    ...(panel.value?.querySelectorAll<HTMLButtonElement>("[data-folder-path]") ?? []),
  ].find(
    ({ dataset }) =>
      previous === dataset.folderPath || previous.startsWith(`${dataset.folderPath}/`),
  );
  (opener ?? panel.value?.querySelector<HTMLHeadingElement>("h2"))?.focus();
});
</script>

<template>
  <div ref="panel" class="space-y-2">
    <div class="flex flex-wrap items-center gap-x-2">
      <UButton
        v-if="folder.path"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        class="min-h-11"
        @click="emit('navigateFolder', parentFolderPath(folder.path))"
      >
        上の階層へ
      </UButton>
      <nav aria-label="フォルダーの階層" class="min-w-0 flex-1 basis-48">
        <ol class="flex flex-wrap items-center gap-x-2">
          <li
            v-for="crumb in breadcrumbs"
            :key="crumb.path"
            class="flex min-w-0 items-center gap-2"
          >
            <UIcon
              v-if="crumb.path"
              name="i-lucide-chevron-right"
              class="shrink-0 text-muted"
              aria-hidden="true"
            />
            <h2
              v-if="crumb.path === folder.path"
              tabindex="-1"
              aria-current="location"
              class="min-w-0 rounded py-2 font-semibold wrap-anywhere whitespace-pre-wrap focus-visible:outline-2"
            >
              {{ crumb.path ? crumb.name : rootName || "ルート" }}
            </h2>
            <button
              v-else
              type="button"
              class="min-h-11 min-w-0 rounded text-left text-sm wrap-anywhere whitespace-pre-wrap text-primary focus-visible:outline-2"
              @click="emit('navigateFolder', crumb.path)"
            >
              {{ crumb.path ? crumb.name : rootName || "ルート" }}
            </button>
          </li>
        </ol>
      </nav>
    </div>
    <ul v-if="children.length" aria-label="サブフォルダー" class="divide-y divide-default">
      <li v-for="child in children" :key="child.path">
        <button
          type="button"
          :data-folder-path="child.path"
          class="flex min-h-12 w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-elevated focus-visible:outline-2"
          @click="emit('navigateFolder', child.path)"
        >
          <UIcon name="i-lucide-folder-open" class="shrink-0 text-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1 wrap-anywhere whitespace-pre-wrap">{{ child.name }}</span>
          <UIcon name="i-lucide-chevron-right" class="shrink-0 text-muted" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <TrackList v-if="tracks.length" :tracks="tracks" />
    <p v-else-if="!children.length" class="py-6 text-sm text-muted" role="status">
      {{ matches ? "検索に一致する曲がありません。" : "このフォルダーに曲がありません。" }}
    </p>
  </div>
</template>
