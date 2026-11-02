import { computed, onScopeDispose, shallowReactive, shallowRef } from "vue";
import { defineStore } from "pinia";
import { createPlayer } from "../lib/player";
import type { Track } from "../lib/library";
import type { TrackMetadata } from "../lib/catalog";

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

  // Each track is independently reactive; file handles remain unproxied. Queue entries
  // refer to the same objects, so presentation changes do not rebuild the queue.
  function setTracks(tracks: Track[]): void {
    player.setTracks(tracks.map((track) => shallowReactive(track)));
  }
  function updateTracks(tracks: Track[]): void {
    player.updateTracks(tracks.map((track) => shallowReactive(track)));
  }
  function addTrack(track: Track): void {
    const canonical = state.value.tracks.find((item) => item.path === track.path);
    player.addTrack(canonical ?? shallowReactive(track));
  }
  function updateTrackMetadata(track: Track, metadata?: TrackMetadata, artworkUrl?: string): void {
    track.metadata = metadata;
    track.artworkUrl = artworkUrl;
    if (current.value === track) player.refreshMetadata();
  }

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
    setTracks,
    updateTracks,
    updateTrackMetadata,
    playAt: player.playAt,
    toggle: player.toggle,
    previous: player.previous,
    next: player.next,
    playId: player.playId,
    setShuffle: player.setShuffle,
    setRepeat: player.setRepeat,
    addTrack,
    removeFromQueue: player.removeFromQueue,
    moveQueue: player.moveQueue,
    seek: player.seek,
    setVolume: player.setVolume,
  };
});
