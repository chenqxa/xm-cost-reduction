import { useCallback, useRef, useState } from 'react';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

interface UseDataCacheOptions {
  ttl?: number; // Cache time to live in milliseconds, default 5 minutes
  staleWhileRevalidate?: boolean; // Return stale data while revalidating
}

const globalCache = new Map<string, CacheEntry<unknown>>();

export function useDataCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: UseDataCacheOptions = {}
) {
  const { ttl = 5 * 60 * 1000, staleWhileRevalidate = true } = options;
  const inflightRef = useRef<Promise<T> | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExpired = useCallback((entry: CacheEntry<T>) => {
    return Date.now() - entry.timestamp > entry.ttl;
  }, []);

  const fetch = useCallback(async (force = false) => {
    const cached = globalCache.get(key) as CacheEntry<T> | undefined;
    
    // Check if we have valid cached data
    if (!force && cached && !isExpired(cached)) {
      setData(cached.data);
      return cached.data;
    }

    // If we have stale data and staleWhileRevalidate is enabled, return it immediately
    if (!force && cached && staleWhileRevalidate) {
      setData(cached.data);
    }

    if (inflightRef.current) {
      return inflightRef.current;
    }

    setLoading(true);
    setError(null);

    try {
      const pending = fetcher();
      inflightRef.current = pending;
      const freshData = await pending;
      globalCache.set(key, {
        data: freshData,
        timestamp: Date.now(),
        ttl,
      });
      
      setData(freshData);
      setLoading(false);
      return freshData;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setLoading(false);
      
      // If we have cached data (even if expired), return it as fallback
      if (cached) {
        setData(cached.data);
        return cached.data;
      }
      
      throw err;
    } finally {
      inflightRef.current = null;
    }
  }, [key, fetcher, ttl, isExpired, staleWhileRevalidate]);

  const invalidate = useCallback(() => {
    globalCache.delete(key);
  }, [key]);

  const clearCache = useCallback(() => {
    globalCache.clear();
  }, []);

  // Prefetch function for background loading
  const prefetch = useCallback(() => {
    const cached = globalCache.get(key) as CacheEntry<T> | undefined;
    if (!cached || isExpired(cached)) {
      // Don't update state, just cache the data
      fetcher()
        .then(freshData => {
          const entry: CacheEntry<unknown> = {
            data: freshData,
            timestamp: Date.now(),
            ttl
          };
          globalCache.set(key, entry);
        })
        .catch(() => {
          // Silently fail prefetch
        });
    }
  }, [key, fetcher, ttl, isExpired]);

  return {
    data,
    loading,
    error,
    fetch,
    refetch: () => fetch(true),
    invalidate,
    clearCache,
    prefetch
  };
}

// Global cache clearing function
export function clearAllDataCaches() {
  globalCache.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('clear-data-caches'));
  }
}
