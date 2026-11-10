import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import { setCatalog, type CatalogData, type CatalogItemRow, type CompanyTypeRow } from '../../data/catalog'
import { companyKeys } from './companies'
import { useNotify } from '../useNotify'

export const catalogKeys = { all: ['catalog'] as const }

export type ItemInput = Pick<CatalogItemRow, 'name' | 'description' | 'kind' | 'unit' | 'stocked' | 'color'>
export type TypeInput = Pick<CompanyTypeRow, 'name' | 'example' | 'input_items' | 'output_items'>

/** The account's items and company types. Loaded once before any screen shows (MainLayout). */
export function useCatalog(enabled = true) {
  const query = useQuery({
    queryKey: catalogKeys.all,
    queryFn: async () => (await api.get<CatalogData>(API_ROUTES.catalog.root)).data,
    enabled,
    staleTime: 10 * 60_000,
  })
  // The helpers in data/catalog read this copy. Set here, not in queryFn: after a reload the
  // data comes back from the saved cache (lib/queryClient.ts) and queryFn never runs.
  if (query.data) setCatalog(query.data)
  return query
}

/** Catalogue changes rename items everywhere and can change companies' defaults. */
function useInvalidateCatalog() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: catalogKeys.all }), qc.invalidateQueries({ queryKey: companyKeys.all })])
}

export function useSaveItem() {
  const notify = useNotify()
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: Partial<ItemInput> }) =>
      (id ? await api.patch<CatalogItemRow>(API_ROUTES.catalog.item(id), body) : await api.post<CatalogItemRow>(API_ROUTES.catalog.items, body)).data,
    onSuccess: async (item, { id }) => {
      await invalidate()
      notify.success(id ? 'Item saved' : 'Item added', item.name)
    },
  })
}

export function useDeleteItem() {
  const notify = useNotify()
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: async (item: CatalogItemRow) => api.delete(API_ROUTES.catalog.item(item.id)),
    onSuccess: async (_, item) => {
      await invalidate()
      notify.success('Item deleted', item.name)
    },
    onError: (err) => notify.error(err, 'Could not delete the item'),
  })
}

export function useSaveType() {
  const notify = useNotify()
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: Partial<TypeInput> }) =>
      (id ? await api.patch<CompanyTypeRow>(API_ROUTES.catalog.type(id), body) : await api.post<CompanyTypeRow>(API_ROUTES.catalog.types, body)).data,
    onSuccess: async (row, { id }) => {
      await invalidate()
      notify.success(id ? 'Company type saved' : 'Company type added', row.name)
    },
  })
}

export function useDeleteType() {
  const notify = useNotify()
  const invalidate = useInvalidateCatalog()
  return useMutation({
    mutationFn: async (row: CompanyTypeRow) => api.delete(API_ROUTES.catalog.type(row.id)),
    onSuccess: async (_, row) => {
      await invalidate()
      notify.success('Company type deleted', row.name)
    },
    onError: (err) => notify.error(err, 'Could not delete the company type'),
  })
}
