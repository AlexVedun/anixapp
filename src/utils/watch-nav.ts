/** Открыть плеер внутри приложения (маршрут /watch), без отдельного окна. */
import { navigate } from '../stores/navigation';

export interface WatchLaunchParams {
  releaseId: string | number;
  sourceId: string | number;
  ep: string | number;
  title: string;
  sourceName: string;
  dubberId?: string | number;
  dubberName?: string;
  lobbyIdle?: boolean;
}

export function canOpenInAppPlayer(): boolean {
  return typeof window !== 'undefined' && (!!window.electron?.openPlayerWindow || !!window.anixApi);
}

export function isWatchRouteActive(): boolean {
  try {
    const hash = window.location.hash || '';
    if (hash.startsWith('#/watch')) return true;
    const path = window.location.pathname;
    return path === '/watch' || path.endsWith('/watch');
  } catch {
    return false;
  }
}

export function openInAppPlayer(params: WatchLaunchParams): Promise<void> {
  const payload = {
    releaseId: String(params.releaseId),
    sourceId: String(params.sourceId),
    ep: String(params.ep),
    title: params.title,
    sourceName: params.sourceName,
    ...(params.dubberId != null && params.dubberId !== '' ? { dubberId: String(params.dubberId) } : {}),
    ...(params.dubberName != null && params.dubberName !== '' ? { dubberName: String(params.dubberName) } : {}),
  };

  const alreadyWatching = isWatchRouteActive();
  const qs = new URLSearchParams({
    ...payload,
    ...(params.lobbyIdle ? { lobbyIdle: '1' } : {}),
  });
  navigate(`/watch?${qs.toString()}`);
  if (alreadyWatching && !params.lobbyIdle) {
    window.dispatchEvent(new CustomEvent('player:changeContent', { detail: payload }));
  }
  return Promise.resolve();
}

/** Плеер на маршруте /watch (в т.ч. Electron main window). */
export function isEmbeddedWebPlayer(): boolean {
  return typeof window !== 'undefined' && isWatchRouteActive();
}
