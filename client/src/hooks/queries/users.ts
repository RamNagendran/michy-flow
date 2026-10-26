import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { AccessInput, AuditLog, ManagedUser, Paginated, UserCreateRequest, UserUpdateRequest, UserWithPassword } from '../../types/auth'
import { useNotify } from '../useNotify'

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
  audit: (page: number, entityType?: string) => ['audit-logs', page, entityType ?? 'all'] as const,
}

export function useUsers() {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: async () => (await api.get<ManagedUser[]>(API_ROUTES.users.list)).data,
  })
}

function useInvalidateUsers() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: userKeys.all }), qc.invalidateQueries({ queryKey: ['audit-logs'] })])
}

/** Returns the one-time temporary password; the caller shows it to the Super Admin. */
export function useCreateUser() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async (body: UserCreateRequest) => (await api.post<UserWithPassword>(API_ROUTES.users.list, body)).data,
    onSuccess: () => invalidate(),
  })
}

export function useUpdateUser() {
  const notify = useNotify()
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: UserUpdateRequest }) => (await api.patch<ManagedUser>(API_ROUTES.users.one(id), body)).data,
    onSuccess: (u) => {
      notify.success(u.is_active ? 'User updated' : 'User deactivated and signed out', u.full_name)
      // Refresh lists in the background: the save is done, so the form can close now.
      void invalidate()
    },
    onError: (err) => notify.error(err, 'Could not update the user'),
  })
}

export function useSetUserAccess() {
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: AccessInput }) => (await api.put<ManagedUser>(API_ROUTES.users.access(id), body)).data,
    onSuccess: () => invalidate(),
  })
}

export function useResetPassword() {
  const notify = useNotify()
  const invalidate = useInvalidateUsers()
  return useMutation({
    mutationFn: async (id: number) => (await api.post<UserWithPassword>(API_ROUTES.users.resetPassword(id))).data,
    onSuccess: () => invalidate(),
    onError: (err) => notify.error(err, 'Could not reset the password'),
  })
}

export function useAuditLogs(page: number, entityType?: string) {
  return useQuery({
    queryKey: userKeys.audit(page, entityType),
    queryFn: async () =>
      (await api.get<Paginated<AuditLog>>(API_ROUTES.auditLogs, { params: { page, page_size: 20, entity_type: entityType } })).data,
    placeholderData: keepPreviousData,
  })
}
