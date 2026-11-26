import { useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'

export interface FxRate {
  currency: string
  /** ₹ for one unit of the currency. */
  rate: string
  as_of: string
}

/** Today's live rate, to fill in an import purchase. The server keeps it for an hour. */
export function useFxRate(currency: string | undefined) {
  return useQuery({
    queryKey: ['fx-rate', currency],
    queryFn: async () => (await api.get<FxRate>(API_ROUTES.fxRate(currency!))).data,
    enabled: !!currency && currency !== 'INR',
    staleTime: 30 * 60_000,
    retry: false,
  })
}
