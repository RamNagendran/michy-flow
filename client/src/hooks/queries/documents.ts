import { useEffect, useMemo } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { BillDocument } from '../../types/documents'

/** Upload a bill; the server reads it and returns the values it found. Nothing is entered yet. */
export function useUploadBill(kind: 'purchase' | 'sale') {
  return useMutation({
    mutationFn: async ({ companyId, file }: { companyId: number; file: File }) => {
      const body = new FormData()
      body.append('file', file)
      // Reading a scanned bill with OCR can take a while on a busy server.
      return (await api.post<BillDocument>(API_ROUTES.documents.upload(companyId), body, { params: { kind }, timeout: 120_000 })).data
    },
  })
}

/**
 * The bill file as a local object URL, so it can be shown in an <iframe> or <img>.
 * Fetched with the access token (a plain link could not carry it), and released when unused.
 */
export function useBillFile(companyId: number | undefined, documentId: number | null | undefined) {
  const file = useQuery({
    queryKey: ['document-file', companyId, documentId],
    queryFn: async () => (await api.get<Blob>(API_ROUTES.documents.file(companyId!, documentId!), { responseType: 'blob' })).data,
    enabled: !!companyId && !!documentId,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  })
  const url = useMemo(() => (file.data ? URL.createObjectURL(file.data) : undefined), [file.data])
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )
  return { url, type: file.data?.type, isLoading: file.isLoading, error: file.error }
}
