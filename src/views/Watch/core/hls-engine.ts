import Hls from 'hls.js';
import { isHlsUrl } from '../_utils';
import { buildHlsConfig } from './hls-media-context';

type VideoWithHls = HTMLVideoElement & {
  _hls?: Hls;
  _hlsGen?: number;
  _hlsReady?: () => void;
  _hlsError?: (event: string, data: { fatal: boolean; type: string; details?: string }) => void;
  _hlsFragLoaded?: () => void;
  _hlsNetTimers?: ReturnType<typeof setTimeout>[];
};

export type HlsFatalKind = 'recover' | 'reresolve' | 'fallback';

export interface SwapMediaHandlers {
  onReady?: () => void;
  onFatal?: (kind: HlsFatalKind) => void;
  /** Soft reconnect in progress (network backoff / stall kick). */
  onReconnect?: (active: boolean) => void;
  /** Полностью пересоздать HLS — иначе старый кадр остаётся в <video> и Anime4K «залипает». */
  forceNew?: boolean;
}

/** Quiet soft kicks — no UI. Escalate only if still stuck after these. */
const NET_BACKOFF_MS = [0, 800, 1800, 3200] as const;
const NET_ESCALATE_AFTER_MS = 10_000;
const MAX_SOFT_NET_ROUNDS = 3;

export function getAttachedHls(video: HTMLVideoElement): Hls | undefined {
  return (video as VideoWithHls)._hls;
}

export function detachHls(video: HTMLVideoElement): void {
  const el = video as VideoWithHls;
  clearNetBackoffTimers(el);
  if (el._hls) {
    unbindHlsHandlers(el);
    try { el._hls.destroy(); } catch { /* ignore */ }
    el._hls = undefined;
  }
}

function clearNetBackoffTimers(el: VideoWithHls): void {
  const timers = el._hlsNetTimers;
  if (!timers?.length) return;
  for (const t of timers) clearTimeout(t);
  el._hlsNetTimers = [];
}

function unbindHlsHandlers(el: VideoWithHls): void {
  const hls = el._hls;
  if (!hls) return;
  if (el._hlsReady) hls.off(Hls.Events.MANIFEST_PARSED, el._hlsReady);
  if (el._hlsError) hls.off(Hls.Events.ERROR, el._hlsError);
  if (el._hlsFragLoaded) hls.off(Hls.Events.FRAG_LOADED, el._hlsFragLoaded);
  el._hlsReady = undefined;
  el._hlsError = undefined;
  el._hlsFragLoaded = undefined;
}

function hasForwardBuffer(video: HTMLVideoElement, minSec = 1): boolean {
  try {
    if (video.buffered.length === 0) return false;
    const end = video.buffered.end(video.buffered.length - 1);
    return end - video.currentTime > minSec;
  } catch {
    return false;
  }
}

function playbackLooksHealthy(video: HTMLVideoElement): boolean {
  if (video.ended) return true;
  if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && hasForwardBuffer(video, 0.75)) {
    return true;
  }
  if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && hasForwardBuffer(video, 0.4)) {
    return true;
  }
  return false;
}

function bindHlsHandlers(hls: Hls, video: HTMLVideoElement, handlers: SwapMediaHandlers): void {
  const el = video as VideoWithHls;
  unbindHlsHandlers(el);
  clearNetBackoffTimers(el);
  const gen = (el._hlsGen ?? 0) + 1;
  el._hlsGen = gen;
  el._hlsNetTimers = [];

  const onReady = () => {
    if (el._hlsGen !== gen) return;
    handlers.onReconnect?.(false);
    handlers.onReady?.();
  };

  let mediaAttempts = 0;
  let softNetRounds = 0;
  let reResolveAttempts = 0;
  let netBackoffActive = false;

  const resetSoftCounters = () => {
    mediaAttempts = 0;
    softNetRounds = 0;
    netBackoffActive = false;
    clearNetBackoffTimers(el);
    handlers.onReconnect?.(false);
  };

  const onFragLoaded = () => {
    if (el._hlsGen !== gen) return;
    // Successful fragment → forget prior soft failures so one drop doesn't stack.
    resetSoftCounters();
  };

  const kickStartLoad = (atTime?: number) => {
    try {
      if (typeof atTime === 'number' && Number.isFinite(atTime) && atTime > 0.25) {
        hls.startLoad(atTime);
      } else {
        hls.startLoad(-1);
      }
    } catch { /* ignore */ }
  };

  const scheduleNetworkBackoff = () => {
    if (netBackoffActive) return;
    netBackoffActive = true;
    softNetRounds += 1;
    // Soft recovery stays silent — last frame stays on screen, no overlay.
    handlers.onFatal?.('recover');

    for (const delay of NET_BACKOFF_MS) {
      const timer = setTimeout(() => {
        if (el._hlsGen !== gen || el._hls !== hls) return;
        if (playbackLooksHealthy(video)) {
          resetSoftCounters();
          return;
        }
        const ct = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        kickStartLoad(ct);
      }, delay);
      el._hlsNetTimers!.push(timer);
    }

    const escalateTimer = setTimeout(() => {
      if (el._hlsGen !== gen || el._hls !== hls) return;
      if (!netBackoffActive) return;
      if (playbackLooksHealthy(video)) {
        resetSoftCounters();
        return;
      }
      netBackoffActive = false;
      clearNetBackoffTimers(el);

      if (softNetRounds < MAX_SOFT_NET_ROUNDS) {
        // Another quiet soft round before reresolve.
        scheduleNetworkBackoff();
        return;
      }

      if (reResolveAttempts++ < 2) {
        handlers.onReconnect?.(true);
        handlers.onFatal?.('reresolve');
      } else {
        handlers.onReconnect?.(false);
        handlers.onFatal?.('fallback');
      }
    }, NET_ESCALATE_AFTER_MS);
    el._hlsNetTimers!.push(escalateTimer);
  };

  const onError = (_evt: string, data: { fatal: boolean; type: string; details?: string }) => {
    if (el._hlsGen !== gen) return;
    if (!data.fatal) {
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        try { hls.recoverMediaError(); } catch { /* ignore */ }
      }
      // Non-fatal network (frag retry etc.) — hls.js handles; stay silent.
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaAttempts++ < 4) {
      try { hls.recoverMediaError(); } catch { /* ignore */ }
      handlers.onFatal?.('recover');
      return;
    }
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      scheduleNetworkBackoff();
      return;
    }
    if (reResolveAttempts++ < 2) {
      handlers.onReconnect?.(true);
      handlers.onFatal?.('reresolve');
    } else {
      handlers.onReconnect?.(false);
      handlers.onFatal?.('fallback');
    }
  };

  el._hlsReady = onReady;
  el._hlsError = onError;
  el._hlsFragLoaded = onFragLoaded;
  hls.on(Hls.Events.MANIFEST_PARSED, onReady);
  hls.on(Hls.Events.ERROR, onError);
  hls.on(Hls.Events.FRAG_LOADED, onFragLoaded);
}

function preferNativeHls(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
    return true;
  }
  const el = document.createElement('video');
  return !!el.canPlayType('application/vnd.apple.mpegurl');
}

export function swapMediaSource(
  video: HTMLVideoElement,
  url: string,
  handlers: SwapMediaHandlers = {},
): { reused: boolean; isHls: boolean } {
  // Android TV WebView: MSE/hls.js часто даёт чёрный кадр при живом currentTime.
  // Нативный HLS в <video src> — тот же путь, что у старого Anixholy APK.
  const wantHls = isHlsUrl(url) && Hls.isSupported() && !preferNativeHls();
  const existing = getAttachedHls(video);

  if (wantHls) {
    if (existing && !handlers.forceNew) {
      bindHlsHandlers(existing, video, handlers);
      existing.loadSource(url);
      existing.startLoad();
      return { reused: true, isHls: true };
    }
    detachHls(video);
    const hls = new Hls(buildHlsConfig());
    bindHlsHandlers(hls, video, handlers);
    hls.loadSource(url);
    hls.attachMedia(video);
    (video as VideoWithHls)._hls = hls;
    return { reused: false, isHls: true };
  }

  detachHls(video);
  video.src = url;
  return { reused: false, isHls: false };
}

export function startHlsFromTime(video: HTMLVideoElement, time: number): void {
  const hls = getAttachedHls(video);
  if (!hls) return;
  try {
    const t = Number.isFinite(time) && time > 0.25 ? time : -1;
    hls.startLoad(t);
  } catch { /* ignore */ }
}
