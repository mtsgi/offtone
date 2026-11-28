<script setup vapor lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { useToast } from "@nuxt/ui/composables/useToast";
import { storeToRefs } from "pinia";
import {
  inject,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import type { Track } from "../lib/library";
import { trackArtist, trackTitle } from "../lib/music-catalog";
import { trackActionsHistoryKey } from "../lib/view-history";
import { usePlayerStore } from "../stores/player";
import ArtworkImage from "./ArtworkImage.vue";

defineProps<{ tracks: Track[] }>();
const player = usePlayerStore();
const { current, playing, tracks: libraryTracks } = storeToRefs(player);
const history = inject(trackActionsHistoryKey, undefined);
const toast = useToast();
const dialog = useTemplateRef("dialog");
const heading = useTemplateRef("heading");
const dialogId = useId();
const headingId = `${dialogId}-heading`;
const selected = shallowRef<Track>();
const showInfo = ref(false);
let opener: HTMLElement | undefined;
const actions = [
  { id: "play", label: "再生" },
  { id: "next", label: "次に再生" },
  { id: "append", label: "キューの最後に追加" },
  { id: "info", label: "曲情報" },
] as const;

function play(track: Track) {
  const target = player.resolveTrack(track);
  if (target) void player.playAt(libraryTracks.value.indexOf(target));
}
function openMenu(track: Track, event: MouseEvent) {
  const target = player.resolveTrack(track);
  if (!target || selected.value || (history && !history.show())) return;
  selected.value = target;
  showInfo.value = false;
  opener = event.currentTarget as HTMLElement;
  void nextTick(() => {
    if (!selected.value || !dialog.value) return;
    dialog.value.showModal();
    dialog.value.querySelector("button")?.focus();
  });
}
function hideMenu() {
  if (!selected.value) return;
  selected.value = undefined;
  if (dialog.value?.open) dialog.value.close();
  const trigger = opener;
  opener = undefined;
  void nextTick(() => {
    if (selected.value) return;
    if (trigger?.isConnected) trigger.focus();
    else if (document.activeElement === document.body)
      document.getElementById("library-search")?.focus();
  });
}
function closeMenu() {
  if (!selected.value) return;
  history?.close();
  hideMenu();
}
function act(action: (typeof actions)[number]["id"]) {
  const track = selected.value && player.resolveTrack(selected.value);
  if (track && action === "info") {
    showInfo.value = true;
    void nextTick(() => heading.value?.focus());
    return;
  }
  closeMenu();
  if (!track) return;
  if (action === "play") play(track);
  if (action === "next" && player.playNext(track))
    toast.add({ title: `「${trackTitle(track)}」を次に再生する曲に追加しました。` });
  if (action === "append") {
    player.addTrack(track);
    toast.add({ title: `「${trackTitle(track)}」をキューの最後に追加しました。` });
  }
}

watch(
  libraryTracks,
  () => {
    if (!selected.value) return;
    const track = player.resolveTrack(selected.value);
    if (track) selected.value = track;
    else closeMenu();
  },
  { flush: "post" },
);
if (history)
  watch(history.open, (open) => {
    if (!open) hideMenu();
  });
onBeforeUnmount(closeMenu);
</script>

<template>
  <ul aria-label="曲一覧" class="divide-y divide-default">
    <li
      v-for="track in tracks"
      :key="track.path"
      class="grid grid-cols-[minmax(0,1fr)_auto] items-center"
    >
      <UButton
        color="neutral"
        :variant="current?.path === track.path ? 'soft' : 'ghost'"
        class="min-h-16 justify-start rounded-none text-left"
        :aria-current="current?.path === track.path ? 'true' : undefined"
        @click="play(track)"
      >
        <span
          class="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-elevated"
          aria-hidden="true"
        >
          <UIcon name="i-lucide-music-2" class="text-muted" /><ArtworkImage
            :src="track.artworkUrl"
          />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ trackTitle(track) }}</span>
          <span class="block truncate text-xs text-muted">{{
            [
              trackArtist(track),
              track.metadata?.album,
              !track.metadata?.artist && !track.metadata?.album ? track.path : undefined,
            ]
              .filter(Boolean)
              .join(" · ")
          }}</span>
        </span>
        <UBadge v-if="current?.path === track.path" color="neutral" variant="subtle">{{
          playing ? "再生中" : "選択中"
        }}</UBadge>
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-ellipsis"
        class="min-h-11 min-w-11 justify-center"
        :aria-label="`「${trackTitle(track)}」の操作`"
        aria-haspopup="dialog"
        :aria-expanded="selected?.path === track.path"
        :aria-controls="selected?.path === track.path ? dialogId : undefined"
        @click="openMenu(track, $event)"
      />
    </li>
  </ul>
  <dialog
    v-if="selected"
    :id="dialogId"
    ref="dialog"
    :aria-labelledby="headingId"
    aria-modal="true"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm rounded-lg bg-default text-default shadow-lg backdrop:bg-black/60"
    @cancel.prevent="closeMenu"
    @click.self="closeMenu"
  >
    <div class="space-y-3 p-4">
      <h2 :id="headingId" ref="heading" tabindex="-1" class="font-semibold wrap-anywhere">
        {{ showInfo ? "曲情報" : trackTitle(selected) }}
      </h2>
      <dl v-if="showInfo" class="space-y-2 text-sm wrap-anywhere whitespace-pre-wrap">
        <div>
          <dt class="text-muted">曲名</dt>
          <dd>{{ trackTitle(selected) }}</dd>
        </div>
        <div v-if="selected.metadata?.artist">
          <dt class="text-muted">アーティスト</dt>
          <dd>{{ selected.metadata.artist }}</dd>
        </div>
        <div v-if="selected.metadata?.album">
          <dt class="text-muted">アルバム</dt>
          <dd>{{ selected.metadata.album }}</dd>
        </div>
        <div v-if="selected.metadata?.albumArtist">
          <dt class="text-muted">アルバムアーティスト</dt>
          <dd>{{ selected.metadata.albumArtist }}</dd>
        </div>
        <div>
          <dt class="text-muted">ファイル名</dt>
          <dd>{{ selected.name }}</dd>
        </div>
        <div v-if="selected.path !== selected.name">
          <dt class="text-muted">相対パス</dt>
          <dd>{{ selected.path }}</dd>
        </div>
      </dl>
      <template v-else>
        <UButton
          v-for="action in actions"
          :key="action.id"
          block
          color="neutral"
          variant="ghost"
          class="min-h-11 justify-start"
          @click="act(action.id)"
        >
          {{ action.label }}
        </UButton>
      </template>
      <UButton block color="neutral" variant="soft" class="min-h-11" @click="closeMenu">
        閉じる
      </UButton>
    </div>
  </dialog>
</template>
