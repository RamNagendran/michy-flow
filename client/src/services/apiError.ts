import axios from 'axios'

export class ApiError extends Error {
  status?: number
  code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface ValidationIssue {
  msg: string
  type?: string
  loc?: (string | number)[]
}

/** "Oil density: Field required" — our own rule messages already read as sentences. */
function describeIssue({ msg, type, loc }: ValidationIssue) {
  if (type === 'value_error') return msg.replace(/^Value error, /, '')
  const field = [...(loc ?? [])].reverse().find((part): part is string => typeof part === 'string' && part !== 'body')
  if (!field) return msg
  const name = field.replace(/_/g, ' ')
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${msg}`
}

interface ErrorBody {
  detail?: string | ValidationIssue[]
  code?: string
  error?: string
}

/** Turns any axios/FastAPI error into an ApiError with a readable message. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (axios.isAxiosError<ErrorBody>(error)) {
    if (!error.response) return new ApiError("Can't reach the server. Check your connection and try again.")
    const { status, data } = error.response
    const detail = data?.detail
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map(describeIssue).join('. ')
          : status === 429
            ? 'Too many attempts. Please wait a minute and try again.'
            : (data?.error ?? `Request failed (${status})`)
    return new ApiError(message, status, data?.code)
  }
  return new ApiError(error instanceof Error ? error.message : 'Something went wrong')
}

export const errorMessage = (error: unknown) => toApiError(error).message
