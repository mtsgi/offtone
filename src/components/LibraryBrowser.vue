<script setup vapor lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { computed, nextTick, ref, watch } from "vue";
import type { MusicDirectory, Track } from "../lib/library";
import { buildCatalog, matchesTrack } from "../lib/music-catalog";
import ArtworkImage from "./ArtworkImage.vue";
import TrackList from "./TrackList.vue";

const props = defineProps<{ tracks: Track[]; directory?: MusicDirectory }>();
type View = "tracks" | "albums" | "artists";
const tabs: { id: View; label: string }[] = [
  { id: "tracks", label: "曲" },
  { id: "albums", label: "アルバム" },
  { id: "artists", label: "アーティスト" },
];
const view = ref<View>("tracks");
const query = ref("");
const selected = ref<string>();
let openerKey: string | undefined;
const catalog = computed(() => buildCatalog(props.tracks));
const filtered = computed(() => props.tracks.filter((track) => matchesTrack(track, query.value)));
const results = computed(() => buildCatalog(filtered.value));
const album = computed(() => catalog.value.albums.find((item) => item.key === selected.value));
const artist = computed(() => catalog.value.artists.find((item) => item.key === selected.value));
const detailTracks = computed(
  () =>
    (view.value === "albums" ? album.value?.tracks : artist.value?.tracks)?.filter((track) =>
      matchesTrack(track, query.value),
    ) ?? [],
);
function setView(id: View) {
  view.value = id;
  selected.value = undefined;
  openerKey = undefined;
}
function keyTab(event: KeyboardEvent, id: View) {
  const current = tabs.findIndex((tab) => tab.id === id);
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (current + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (current + tabs.length - 1) % tabs.length
            : -1;
  if (index < 0) return;
  event.preventDefault();
  setView(tabs[index]!.id);
  document.getElementById(`library-tab-${tabs[index]!.id}`)?.focus();
}
function open(key: string) {
  openerKey = key;
  selected.value = key;
}
async function back() {
  selected.value = undefined;
  await nextTick();
  const opener = [...document.querySelectorAll<HTMLButtonElement>("[data-library-group]")].find(
    (button) => button.dataset.libraryGroup === openerKey,
  );
  (opener ?? document.getElementById(`library-tab-${view.value}`))?.focus();
  openerKey = undefined;
}
watch(
  () => props.directory,
  () => {
    selected.value = undefined;
    openerKey = undefined;
  },
);
watch([catalog, selected, view], () => {
  if (
    selected.value &&
    ((view.value === "albums" && !album.value) || (view.value === "artists" && !artist.value))
  )
    void back();
});
</script>

<template>
  <section aria-label="ライブラリの閲覧" class="space-y-4">
    <div role="tablist" aria-label="ライブラリ表示" class="flex border-b border-default">
      <button
        v-for="tab in tabs"
        :id="`library-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="view === tab.id"
        aria-controls="library-panel"
        :tabindex="view === tab.id ? 0 : -1"
        class="min-h-11 flex-1 border-b-2 px-3 font-medium focus-visible:outline-2"
        :class="view === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted'"
        @click="setView(tab.id)"
        @keydown="keyTab($event, tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="flex items-center gap-2">
      <label for="library-search" class="sr-only">曲名・アーティスト・アルバムを検索</label>
      <input
        id="library-search"
        v-model="query"
        type="search"
        placeholder="曲名・アーティスト・アルバムを検索"
        class="min-h-11 min-w-0 flex-1 rounded-md border border-default bg-default px-3 text-sm"
      />
      <UButton
        v-if="query"
        color="neutral"
        variant="ghost"
        aria-label="検索をクリア"
        icon="i-lucide-x"
        class="min-h-11 min-w-11"
        @click="query = ''"
      />
    </div>
    <div id="library-panel" role="tabpanel" :aria-labelledby="`library-tab-${view}`">
      <template v-if="selected && ((view === 'albums' && album) || (view === 'artists' && artist))">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          class="min-h-11"
          @click="back"
          >一覧に戻る</UButton
        >
        <div class="flex items-center gap-4 py-5">
          <span
            class="relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated"
            aria-hidden="true"
            ><UIcon name="i-lucide-music-2" class="text-3xl text-muted" /><ArtworkImage
              :src="view === 'albums' ? album?.artworkUrl : artist?.artworkUrl"
          /></span>
          <div class="min-w-0">
            <h2 class="break-words text-xl font-semibold">
              {{ view === "albums" ? album?.name : artist?.name }}
            </h2>
            <p v-if="view === 'albums'" class="text-sm text-muted">{{ album?.artist }}</p>
            <p class="text-sm text-muted">{{ detailTracks.length }} 曲</p>
          </div>
        </div>
        <div v-if="view === 'artists' && artist" class="space-y-2 pb-5">
          <h3 class="font-semibold">アルバム</h3>
          <ul class="flex flex-wrap gap-2">
            <li
              v-for="item in artist.albums"
              :key="item.key"
              class="rounded bg-elevated px-3 py-2 text-sm"
            >
              {{ item.name }} · {{ item.artist }}
            </li>
          </ul>
        </div>
        <h3 class="mb-2 font-semibold">曲</h3>
        <p v-if="!detailTracks.length" class="py-6 text-sm text-muted">
          検索に一致する曲がありません。
        </p>
        <TrackList v-else :tracks="detailTracks" />
      </template>
      <template v-else-if="view === 'tracks'"
        ><p v-if="!filtered.length" class="py-6 text-sm text-muted">
          検索に一致する曲がありません。
        </p>
        <TrackList v-else :tracks="filtered"
      /></template>
      <template v-else-if="view === 'albums'"
        ><p v-if="!results.albums.length" class="py-6 text-sm text-muted">
          検索に一致するアルバムがありません。
        </p>
        <ul v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          <li v-for="item in results.albums" :key="item.key">
            <button
              type="button"
              class="w-full rounded text-left focus-visible:outline-2"
              :data-library-group="item.key"
              @click="open(item.key)"
            >
              <span
                class="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-elevated"
                aria-hidden="true"
                ><UIcon name="i-lucide-disc-3" class="text-4xl text-muted" /><ArtworkImage
                  :src="item.artworkUrl" /></span
              ><span class="mt-2 block truncate font-semibold">{{ item.name }}</span
              ><span class="block truncate text-sm text-muted"
                >{{ item.artist }} · {{ item.tracks.length }} 曲</span
              >
            </button>
          </li>
        </ul></template
      >
      <template v-else
        ><p v-if="!results.artists.length" class="py-6 text-sm text-muted">
          検索に一致するアーティストがありません。
        </p>
        <p class="mb-2 text-xs text-muted">曲のアーティストとアルバムアーティストを表示します。</p>
        <ul class="divide-y divide-default">
          <li v-for="item in results.artists" :key="item.key">
            <button
              type="button"
              class="flex min-h-16 w-full items-center gap-3 rounded px-2 py-2 text-left focus-visible:outline-2"
              :data-library-group="item.key"
              @click="open(item.key)"
            >
              <span
                class="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-elevated"
                aria-hidden="true"
                ><UIcon name="i-lucide-user" class="text-muted" /><ArtworkImage
                  :src="item.artworkUrl" /></span
              ><span class="min-w-0"
                ><span class="block truncate font-semibold">{{ item.name }}</span
                ><span class="block text-sm text-muted"
                  >{{ item.albums.length }} アルバム · {{ item.tracks.length }} 曲</span
                ></span
              >
            </button>
          </li>
        </ul></template
      >
    </div>
  </section>
</template>
