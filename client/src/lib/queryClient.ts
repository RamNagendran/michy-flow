import { QueryClient } from '@tanstack/react-query'

/** The app's only QueryClient. Import it from here; never create another. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
