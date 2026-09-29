<script lang="ts">
  import { untrack } from 'svelte';
  import {
    toCdnProxyUrl,
    toPosterDisplayUrl,
    fromCdnProxyUrl,
    type PosterThumbPreset,
  } from '../utils/posterUrl';

  /** Сколько ретраев на одном хосте до переключения на зеркало. */
  const HOST_RETRIES = 2;
  const RETRY_MS = [400, 900];

  interface Props {
    src?: string | null;
    alt?: string;
    class?: string;
    loading?: 'lazy' | 'eager';
    /** Если задан — Electron отдаёт физически уменьшенный постер под область */
    thumb?: PosterThumbPreset | null;
  }

  let {
    src = '',
    alt = '',
    class: className = '',
    loading = 'lazy',
    thumb = null,
  }: Props = $props();

  let attempt = $state(0);
  let useMirror = $state(false);
  let loaded = $state(false);
  let failed = $state(false);
  let imgSrc = $state('');
  let retryTimer = $state<ReturnType<typeof setTimeout> | null>(null);

  function proxiedSrc(raw: string, preferMirror: boolean): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const https = fromCdnProxyUrl(trimmed);
    const target = preferMirror ? (buildCdnMirrorHttps(https) || https) : https;
    if (thumb) return toPosterDisplayUrl(target, thumb);
    return toCdnProxyUrl(target);
  }

  /** Только HTTPS зеркала (без повторного anix-cdn), чтобы не плодить mirror-mirror-*. */
  function buildCdnMirrorHttps(url: string): string {
    const source = fromCdnProxyUrl(url?.trim() ?? '');
    if (!source) return '';
    try {
      const parsed = new URL(source.startsWith('http') ? source : `https://${source}`);
      const host = parsed.hostname.replace(/^www\./, '');
      if (host.startsWith('mirror-') || host.startsWith('mirror.')) return parsed.toString();
      const parts = host.split('.');
      parsed.hostname = parts.length > 2
        ? `mirror-${parts[0]}.${parts.slice(1).join('.')}`
        : `mirror.${host}`;
      return parsed.toString();
    } catch {
      return '';
    }
  }

  const normalizedSrc = $derived(proxiedSrc(src ?? '', false));
  const mirrorSrc = $derived(proxiedSrc(src ?? '', true));
  const showImage = $derived(Boolean(normalizedSrc) && !failed && Boolean(imgSrc));
  const showFallback = $derived(!normalizedSrc || failed);

  function clearRetryTimer() {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  $effect(() => {
    const next = normalizedSrc;
    untrack(() => {
      clearRetryTimer();
      attempt = 0;
      useMirror = false;
      loaded = false;
      failed = false;
      imgSrc = next;
    });
  });

  $effect(() => {
    return () => clearRetryTimer();
  });

  function handleLoad() {
    loaded = true;
  }

  function withBust(baseUrl: string, nextAttempt: number): string {
    try {
      const parsed = new URL(baseUrl, 'anix-cdn://asset/');
      parsed.searchParams.set('_retry', String(nextAttempt));
      parsed.searchParams.set('_t', String(Date.now()));
      return parsed.toString();
    } catch {
      const sep = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${sep}_retry=${nextAttempt}&_t=${Date.now()}`;
    }
  }

  function scheduleRetry(baseUrl: string, nextAttempt: number) {
    const delay = RETRY_MS[nextAttempt - 1] ?? 900;
    clearRetryTimer();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!normalizedSrc) return;
      imgSrc = withBust(baseUrl, nextAttempt);
    }, delay);
  }

  function handleError() {
    loaded = false;

    const primary = normalizedSrc;
    const mirror = mirrorSrc;
    if (!primary) {
      failed = true;
      return;
    }

    // Быстрый failover на зеркало: не долбим 502 по 12 раз.
    if (!useMirror && mirror && mirror !== primary) {
      if (attempt >= HOST_RETRIES) {
        useMirror = true;
        attempt = 0;
        imgSrc = mirror;
        return;
      }
      const nextAttempt = attempt + 1;
      attempt = nextAttempt;
      scheduleRetry(primary, nextAttempt);
      return;
    }

    if (useMirror && mirror) {
      if (attempt < HOST_RETRIES) {
        const nextAttempt = attempt + 1;
        attempt = nextAttempt;
        scheduleRetry(mirror, nextAttempt);
        return;
      }
    }

    failed = true;
  }
</script>

{#if showImage}
  <img
    class={className}
    class:poster-image--loaded={loaded}
    src={imgSrc}
    {alt}
    {loading}
    decoding="async"
    onload={handleLoad}
    onerror={handleError}
  />
{:else if showFallback}
  <span class="poster-image__fallback {className}" aria-hidden="true"></span>
{/if}
