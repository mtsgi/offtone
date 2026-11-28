import { computed, onScopeDispose, shallowReactive, shallowRef } from "vue";
import { defineStore } from "pinia";
import { createPlayer } from "../lib/player";
import type { Track } from "../lib/library";
import type { RootId, TrackMetadata } from "../lib/catalog";
import { readSavedPlayback, type SavedPlayback } from "../lib/playback-session";
import { loadPlayback, savePlayback } from "../lib/storage";

const POSITION_SAVE_INTERVAL = 5000;

interface PlaybackSession {
  rootId?: RootId;
  restoration?: Promise<void>;
  ready: boolean;
  dirty: boolean;
}

/** 再生サービスの状態と操作を画面へ公開する。 */
export const usePlayerStore = defineStore("player", () => {
  const player = createPlayer();
  const state = shallowRef(player.getState());
  let session: PlaybackSession = { ready: false, dirty: false };
  let updatingLibrary = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pendingSaves = new Map<RootId, SavedPlayback>();
  let writing: Promise<void> | undefined;

  function saveNow(): Promise<void> | undefined {
    clearTimeout(timer);
    timer = undefined;
    const { rootId, ready, dirty } = session;
    if (!rootId || !ready || !dirty) return writing;
    session.dirty = false;
    pendingSaves.set(rootId, player.capturePlayback(rootId));
    // Serialize writes and keep just the latest pending snapshot for each root.
    writing ??= Promise.resolve().then(async () => {
      for (const [id, snapshot] of pendingSaves) {
        pendingSaves.delete(id);
        try {
          await savePlayback(snapshot);
        } catch {
          if (session.rootId === id && session.ready && !pendingSaves.has(id)) session.dirty = true;
        }
      }
      writing = undefined;
    });
    return writing;
  }

  async function flushPlayback(): Promise<void> {
    player.refreshPosition();
    await saveNow();
  }
  const onPageHide = () => void flushPlayback();
  window.addEventListener("pagehide", onPageHide);

  const unsubscribe = player.subscribe((next) => {
    const previous = state.value;
    const changed =
      next.queue !== previous.queue ||
      next.order !== previous.order ||
      next.currentId !== previous.currentId ||
      next.shuffle !== previous.shuffle ||
      next.repeat !== previous.repeat ||
      next.volume !== previous.volume ||
      (previous.playing && !next.playing) ||
      (previous.seeking && !next.seeking);
    const moved = next.currentTime !== previous.currentTime;
    if ((changed || moved) && (session.ready || !updatingLibrary)) {
      session.dirty = true;
      // Once the user acts on this queue, a late restore must leave it alone.
      if (session.rootId) session.ready = true;
      if (session.ready) {
        if (changed) void saveNow();
        else timer ??= setTimeout(saveNow, POSITION_SAVE_INTERVAL);
      }
    }
    state.value = next;
  });

  onScopeDispose(() => {
    window.removeEventListener("pagehide", onPageHide);
    void flushPlayback();
    session = { ready: false, dirty: false };
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
    void flushPlayback();
    session = { ready: false, dirty: false };
    updatingLibrary = true;
    try {
      player.setTracks(tracks.map((track) => shallowReactive(track)));
    } finally {
      updatingLibrary = false;
    }
  }
  function updateTracks(tracks: Track[]): void {
    updatingLibrary = true;
    try {
      player.updateTracks(tracks.map((track) => shallowReactive(track)));
    } finally {
      updatingLibrary = false;
    }
  }
  function restorePlayback(rootId: RootId): Promise<void> {
    const active = session;
    active.rootId = rootId;
    if (active.dirty || active.ready) {
      active.ready = true;
      void saveNow();
      return Promise.resolve();
    }
    active.restoration ??= (async () => {
      // A prior visit to this root may still have a write in flight.
      await writing;
      if (session !== active || active.ready) return;
      const raw = await loadPlayback(rootId).catch(() => undefined);
      if (session !== active || active.ready) return;
      const saved = readSavedPlayback(raw, rootId);
      active.ready = true;
      if (saved) player.restorePlayback(saved);
    })();
    return active.restoration;
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
    restorePlayback,
    flushPlayback,
    updateTrackMetadata,
    playAt: player.playAt,
    playAlbum: player.playAlbum,
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
