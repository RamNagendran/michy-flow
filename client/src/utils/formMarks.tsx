import type { ReactNode } from 'react'

/**
 * Form label marks used on every form: a red * on required fields, a muted "(optional)" on the
 * rest. Pass as `<Form requiredMark={requiredMark}>`; antd works out "required" from the rules.
 */
export const requiredMark = (label: ReactNode, { required }: { required: boolean }) =>
  required ? (
    <>
      {label}
      <span className="req-mark" aria-hidden>
        *
      </span>
    </>
  ) : (
    <>
      {label}
      <span className="opt-mark">(optional)</span>
    </>
  )
