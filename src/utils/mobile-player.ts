/**
 * Выбор плеера на телефоне («Выберите плеер»): веб-плеер источника, АниксПлеер (наш AnixApp Player по Intent API),
 * встроенный плеер (/watch на hls.js) и сторонний (системный выбор). Настройка хранится локально.
 */
import { launchPlayer, type WatchLaunchParams } from './watch-nav';

export type MobilePlayerKind = 'web' | 'anix' | 'builtin' | 'external';

export interface MobilePlayerPrefs {
  kind: MobilePlayerKind;
  /** «Спрашивать всегда» — показывать диалог выбора перед каждой серией. */
  ask: boolean;
}

const PREFS_KEY = 'anix:mobilePlayerPrefs';
const DEFAULTS: MobilePlayerPrefs = { kind: 'builtin', ask: true };

export function getMobilePlayerPrefs(): MobilePlayerPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<MobilePlayerPrefs>;
    const kinds: MobilePlayerKind[] = ['web', 'anix', 'builtin', 'external'];
    return {
      kind: kinds.includes(p.kind as MobilePlayerKind) ? (p.kind as MobilePlayerKind) : DEFAULTS.kind,
      ask: p.ask !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setMobilePlayerPrefs(prefs: MobilePlayerPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}

type NativePlugin = {
  openExternalPlayer?: (o: Record<string, unknown>) => Promise<{
    installed?: boolean;
    closed?: boolean;
    positionMs?: number;
    durationMs?: number;
    completed?: boolean;
  }>;
};

function nativePlugin(): NativePlugin | undefined {
  return (window as unknown as { Capacitor?: { Plugins?: { AnixPlayer?: NativePlugin } } }).Capacitor?.Plugins?.AnixPlayer;
}

const QUALITY_ORDER = ['1080', '720', '480', '360', '240'];

interface ResolvedStream {
  url: string;
  headers: string[];
}

/** Серия → прямая ссылка (через AnixBack, как и во встроенном плеере). */
async function resolveEpisodeStream(releaseId: string | number, sourceId: string | number, ep: string | number): Promise<ResolvedStream> {
  const api = window.anixApi as unknown as {
    release: {
      getEpisode: (r: number, s: number, e: number) => Promise<{ episode?: { url?: string } }>;
      getDirectVideoLink: (u: string) => Promise<{
        directUrl?: string | null;
        qualityMap?: Record<string, string>;
        downloadHeaders?: Record<string, string>;
      }>;
    };
  };
  const res = await api.release.getEpisode(Number(releaseId), Number(sourceId), Number(ep));
  const embed = res?.episode?.url;
  if (!embed) throw new Error('Не удалось получить ссылку на серию');
  const direct = await api.release.getDirectVideoLink(embed);
  const map = direct?.qualityMap ?? {};
  const key = QUALITY_ORDER.find((q) => map[q] || map[`${q}p`]);
  const url = (key ? map[key] || map[`${key}p`] : direct?.directUrl) || '';
  if (!url) throw new Error('Источник не отдал прямую ссылку — попробуйте другой плеер или источник');
  const abs = url.startsWith('http') ? url : `https:${url}`;
  const headers: string[] = [];
  for (const [k, v] of Object.entries(direct?.downloadHeaders ?? {})) headers.push(k, String(v));
  return { url: abs, headers };
}

export interface MobileLaunchResult {
  /** false — плеер открыт, но серию отмечать просмотренной по возврату не нужно (например, не установлен). */
  started: boolean;
  message?: string;
}

/** Запуск серии выбранным плеером. Для web/builtin — маршрут /watch; для anix/external — нативный Intent. */
export async function launchWithKind(kind: MobilePlayerKind, params: WatchLaunchParams): Promise<MobileLaunchResult> {
  if (kind === 'builtin') {
    await launchPlayer(params);
    return { started: true };
  }
  if (kind === 'web') {
    await launchPlayer({ ...params, webPlayer: true });
    return { started: true };
  }

  const plugin = nativePlugin();
  if (!plugin?.openExternalPlayer) {
    return { started: false, message: 'Внешние плееры доступны только в приложении' };
  }
  const stream = await resolveEpisodeStream(params.releaseId, params.sourceId, params.ep);
  const out = await plugin.openExternalPlayer({
    mode: kind === 'anix' ? 'anix' : 'chooser',
    url: stream.url,
    title: params.title,
    label: `${params.ep} серия`,
    headers: stream.headers,
    startMs: params.currentTime ? Math.round(params.currentTime * 1000) : 0,
  });
  if (kind === 'anix' && out?.installed === false) {
    return { started: false, message: 'АниксПлеер не установлен. Установите AnixApp Player или выберите другой плеер.' };
  }
  return { started: true };
}
