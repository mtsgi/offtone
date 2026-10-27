import { computed, onScopeDispose, shallowRef } from "vue";
import { defineStore } from "pinia";
import { createPlayer } from "../lib/player";

/** 再生サービスの状態と操作を画面へ公開する。 */
export const usePlayerStore = defineStore("player", () => {
  const player = createPlayer();
  const state = shallowRef(player.getState());
  const unsubscribe = player.subscribe((next) => {
    state.value = next;
  });

  onScopeDispose(() => {
    unsubscribe();
    player.dispose();
  });

  const tracks = computed(() => state.value.tracks);
  const index = computed(() => state.value.index);
  const playing = computed(() => state.value.playing);
  const error = computed(() => state.value.error);
  const current = computed(() => state.value.tracks[state.value.index]);

  return {
    tracks,
    index,
    playing,
    error,
    current,
    setTracks: player.setTracks,
    playAt: player.playAt,
    toggle: player.toggle,
    previous: player.previous,
    next: player.next,
  };
});
