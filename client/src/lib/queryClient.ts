import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { removeOldestQuery, type PersistQueryClientOptions } from '@tanstack/react-query-persist-client'

/** How long cached server data is kept, in memory and in the browser between visits. */
const KEEP_MS = 12 * 60 * 60_000

/** The app's only QueryClient. Import it from here; never create another. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The live connection (useRealtime) refetches whatever an entry, party or company change
      // touches, and falls back to refetching every 30 s while it is down. So cached data
      // stays correct and screens need not refetch on every visit.
      staleTime: 5 * 60_000,
      gcTime: KEEP_MS,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

/** Saves the cache to localStorage, so a reload or a new visit shows the last data at once
 * while fresh data loads. Cleared on sign-out (services/session.ts). */
export const queryPersister = createSyncStoragePersister({
  storage: typeof window === 'undefined' ? undefined : window.localStorage,
  key: 'michy-flow:query-cache',
  // Storage full: drop the oldest queries until it fits.
  retry: removeOldestQuery,
})

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister: queryPersister,
  maxAge: KEEP_MS,
  // Bump when the shape of an API response changes, so old saved data is thrown away.
  buster: 'v1',
  dehydrateOptions: {
    // Bill files are blobs: they cannot be saved as text, and are large.
    shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && q.queryKey[0] !== 'document-file',
  },
}
