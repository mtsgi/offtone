import { reactive } from "vue";

interface RegistrationOptions {
  immediate: boolean;
  onNeedRefresh: () => void;
  onNeedReload: () => void;
  onRegisteredSW: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError: (error: unknown) => void;
}

type Register = (options: RegistrationOptions) => (reload?: boolean) => Promise<void>;

/** The update remains visible until it is applied, including after the prompt is deferred. */
export function createPwaUpdate(
  register: Register,
  workers: ServiceWorkerContainer,
  browser: Window,
) {
  const state = reactive({
    available: false,
    deferred: false,
    confirming: false,
    applying: false,
    error: "",
  });
  let registration: ServiceWorkerRegistration | undefined;
  let controller = workers.controller;
  let readyToReload = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function fail() {
    clearTimeout(timer);
    state.applying = false;
    state.error = "更新を適用できませんでした。もう一度お試しください。";
    state.deferred = false;
  }

  function controllerChanged() {
    const previous = controller;
    controller = workers.controller;
    if (!previous || previous === controller) return;
    readyToReload = true;
    state.available = true;
    if (state.applying) {
      clearTimeout(timer);
      browser.location.reload();
    }
  }

  workers.addEventListener("controllerchange", controllerChanged);
  let update: (reload?: boolean) => Promise<void>;
  let registering = false;
  function startRegistration() {
    registering = true;
    update = register({
      immediate: true,
      onNeedRefresh() {
        state.available = true;
        state.deferred = false;
        state.error = "";
      },
      // Workbox can observe another tab activating the worker. Never reload implicitly.
      onNeedReload() {},
      onRegisteredSW(_url, value) {
        registration = value;
        registering = false;
        state.error = "";
      },
      onRegisterError() {
        registering = false;
        state.error = "更新の確認に失敗しました。接続を確認してください。";
      },
    });
  }
  startRegistration();

  function defer() {
    state.deferred = true;
    state.confirming = false;
    state.error = "";
  }

  function requestUpdate(playing: boolean) {
    if (!state.available || state.applying) return;
    if (playing) {
      state.confirming = true;
      return;
    }
    void apply();
  }

  async function apply() {
    if (!state.available || state.applying) return;
    state.applying = true;
    state.confirming = false;
    state.error = "";
    if (!registration?.waiting) {
      if (readyToReload) browser.location.reload();
      else {
        state.applying = false;
        state.available = false;
        state.error = "更新が待機していません。オンラインに戻して再確認してください。";
      }
      return;
    }
    // update() only posts SKIP_WAITING; controllerchange confirms completion.
    timer = setTimeout(fail, 15000);
    try {
      await update();
    } catch {
      fail();
    }
  }

  function onOnline() {
    if (!registration && !registering) {
      startRegistration();
    } else if (registration) {
      void registration.update().then(
        () => {
          state.error = "";
        },
        () => {
          state.error = "更新の確認に失敗しました。接続を確認してください。";
        },
      );
    }
  }
  browser.addEventListener("online", onOnline);

  return {
    state,
    defer,
    show: () => {
      state.deferred = false;
    },
    cancelConfirmation: () => {
      state.confirming = false;
    },
    requestUpdate,
    confirmUpdate() {
      if (state.confirming) void apply();
    },
    dispose() {
      clearTimeout(timer);
      workers.removeEventListener("controllerchange", controllerChanged);
      browser.removeEventListener("online", onOnline);
    },
  };
}
