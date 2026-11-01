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
  const current = computed(
    () => state.value.queue.find((entry) => entry.id === state.value.currentId)?.track,
  );
  const queue = computed(() => state.value.queue);
  const order = computed(() => state.value.order);
  const currentId = computed(() => state.value.currentId);
  const shuffle = computed(() => state.value.shuffle);
  const repeat = computed(() => state.value.repeat);
  const currentTime = computed(() => state.value.currentTime);
  const duration = computed(() => state.value.duration);
  const seeking = computed(() => state.value.seeking);
  const volume = computed(() => state.value.volume);

  return {
    tracks,
    index,
    playing,
    error,
    current,
    queue,
    order,
    currentId,
    shuffle,
    repeat,
    currentTime,
    duration,
    seeking,
    volume,
    setTracks: player.setTracks,
    updateTracks: player.updateTracks,
    playAt: player.playAt,
    toggle: player.toggle,
    previous: player.previous,
    next: player.next,
    playId: player.playId,
    setShuffle: player.setShuffle,
    setRepeat: player.setRepeat,
    addTrack: player.addTrack,
    removeFromQueue: player.removeFromQueue,
    moveQueue: player.moveQueue,
    seek: player.seek,
    setVolume: player.setVolume,
  };
});
