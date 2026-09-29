import Hls from 'hls.js';
import { isHlsUrl } from '../_utils';
import { buildHlsConfig } from './hls-media-context';

type VideoWithHls = HTMLVideoElement & {
  _hls?: Hls;
  _hlsGen?: number;
  _hlsReady?: () => void;
  _hlsError?: (event: string, data: { fatal: boolean; type: string }) => void;
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

const NET_BACKOFF_MS = [0, 1500, 3000] as const;

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
  let netAttempts = 0;
  let reResolveAttempts = 0;
  let netBackoffActive = false;

  const resetSoftCounters = () => {
    mediaAttempts = 0;
    netAttempts = 0;
    reResolveAttempts = 0;
    netBackoffActive = false;
    clearNetBackoffTimers(el);
    handlers.onReconnect?.(false);
  };

  const onFragLoaded = () => {
    if (el._hlsGen !== gen) return;
    // Successful fragment → forget prior soft failures so one drop/hour doesn't stack.
    resetSoftCounters();
  };

  const kickStartLoad = (atTime?: number) => {
    try {
      if (typeof atTime === 'number' && Number.isFinite(atTime) && atTime > 0) {
        hls.startLoad(atTime);
      } else {
        hls.startLoad();
      }
    } catch { /* ignore */ }
  };

  const scheduleNetworkBackoff = () => {
    if (netBackoffActive) return;
    netBackoffActive = true;
    handlers.onReconnect?.(true);
    handlers.onFatal?.('recover');

    for (const delay of NET_BACKOFF_MS) {
      const timer = setTimeout(() => {
        if (el._hlsGen !== gen || el._hls !== hls) return;
        const ct = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        kickStartLoad(ct > 0.25 ? ct : undefined);
      }, delay);
      el._hlsNetTimers!.push(timer);
    }

    // After last backoff kick, if still broken hls.js will fire another fatal → escalate.
    const escalateAfter = NET_BACKOFF_MS[NET_BACKOFF_MS.length - 1] + 4_000;
    const escalateTimer = setTimeout(() => {
      if (el._hlsGen !== gen || el._hls !== hls) return;
      if (!netBackoffActive) return;
      netBackoffActive = false;
      clearNetBackoffTimers(el);
      if (reResolveAttempts++ < 2) {
        handlers.onFatal?.('reresolve');
      } else {
        handlers.onReconnect?.(false);
        handlers.onFatal?.('fallback');
      }
    }, escalateAfter);
    el._hlsNetTimers!.push(escalateTimer);
  };

  const onError = (_evt: string, data: { fatal: boolean; type: string }) => {
    if (el._hlsGen !== gen) return;
    if (!data.fatal) {
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaAttempts++ < 3) {
      hls.recoverMediaError();
      handlers.onFatal?.('recover');
      return;
    }
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      if (netAttempts++ < 1 || !netBackoffActive) {
        scheduleNetworkBackoff();
        return;
      }
      // Already in backoff window — wait for escalate timer.
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
  try { hls.startLoad(time); } catch { /* ignore */ }
}
