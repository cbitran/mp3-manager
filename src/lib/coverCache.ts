// Cache compartilhado de capas — acessível por TrackTable, playlistRules e refreshCurrentView
const MAX = 400;
export const coverCache = new Map<string, string>();

export function setCoverCache(key: string, value: string) {
  if (coverCache.size >= MAX) coverCache.delete(coverCache.keys().next().value!);
  coverCache.set(key, value);
}

/** Remove TODAS as entradas de um path (qualquer versão) */
export function invalidateCoverCache(path: string) {
  for (const key of [...coverCache.keys()]) {
    if (key.startsWith(path + "::")) coverCache.delete(key);
  }
}

/** Remove entradas de múltiplos paths de uma vez */
export function invalidateCoverCacheMany(paths: string[]) {
  const prefixes = paths.map((p) => p + "::");
  for (const key of [...coverCache.keys()]) {
    if (prefixes.some((pfx) => key.startsWith(pfx))) coverCache.delete(key);
  }
}
