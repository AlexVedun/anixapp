import type { HlsConfig } from 'hls.js';

let embedReferer = '';
let embedSourceUrl = '';
let embedCookie = '';

export function setEmbedMediaContext(sourceEmbedUrl: string, headers?: Record<string, string>): void {
  embedSourceUrl = sourceEmbedUrl || '';
  const fromHeaders = headers?.Referer || headers?.referer;
  embedReferer = fromHeaders || sourceEmbedUrl || '';
  embedCookie = headers?.Cookie || headers?.cookie || '';
}

export function clearEmbedMediaContext(): void {
  embedReferer = '';
  embedSourceUrl = '';
  embedCookie = '';
}

export function getEmbedCookie(): string {
  return embedCookie;
}

function hostNeedsEmbedReferer(host: string): boolean {
  const h = host.toLowerCase();
  return /^vkvd/i.test(h)
    || h.includes('vkuservideo')
    || h.includes('okcdn')
    || h.includes('mycdn')
    || h.includes('userapi')
    || h.includes('rutube')
    || h.includes('sibnet')
    || h.includes('solodcdn')
    || h.includes('kodik')
    || h.includes('zerocdn')
    || h.includes('animedia')
    || h.includes('libria')
    || h.includes('anilib')
    || h.includes('studiomir')
    || h.includes('mail.ru')
    || h.includes('imgsmail')
    || h.includes('myvi')
    || /secvideo1|csst\.online|sstrge/.test(h)
    || h.includes('sovetromantica');
}

export function refererForMediaUrl(url: string): string | undefined {
  if (!embedReferer) return undefined;
  try {
    const host = new URL(url.startsWith('http') ? url : `https:${url}`).host;
    if (hostNeedsEmbedReferer(host)) return embedReferer;
  } catch { /* ignore */ }
  return undefined;
}

export function buildHlsConfig(): Partial<HlsConfig> {
  return {
    // Unstable CDNs / proxy: longer timeouts + more frag retries before fatal.
    enableWorker: true,
    lowLatencyMode: false,
    maxBufferHole: 0.8,
    nudgeMaxRetry: 5,
    manifestLoadingTimeOut: 20_000,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 800,
    manifestLoadingMaxRetryTimeout: 12_000,
    levelLoadingTimeOut: 20_000,
    levelLoadingMaxRetry: 6,
    levelLoadingRetryDelay: 800,
    levelLoadingMaxRetryTimeout: 12_000,
    fragLoadingTimeOut: 25_000,
    fragLoadingMaxRetry: 8,
    fragLoadingRetryDelay: 500,
    fragLoadingMaxRetryTimeout: 16_000,
    xhrSetup: (xhr, url) => {
      const ref = refererForMediaUrl(url);
      if (!ref) return;
      try {
        xhr.setRequestHeader('Referer', ref);
      } catch { /* ignore */ }
    },
  };
}

export function getEmbedSourceUrl(): string {
  return embedSourceUrl;
}
