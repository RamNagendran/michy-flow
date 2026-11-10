/** GST numbers: same format rule as the server (server/app/core/gstin.py). */

const SHAPE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Upper case, spaces removed. */
export const normaliseGstin = (value: string) => value.replace(/\s+/g, '').toUpperCase()

/** Format only: state code, PAN, entity number, "Z", one more letter or digit. */
export const isValidGstin = (value: string) => SHAPE.test(normaliseGstin(value))

/** antd Form rule: required, and in GST number format. */
export const gstinRule = {
  validator: async (_: unknown, value?: string) => {
    if (!value?.trim()) throw new Error('Enter the GST number')
    if (!isValidGstin(value)) throw new Error('This GST number is not in the right format. Please check it.')
  },
}
