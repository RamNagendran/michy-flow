/** GST numbers: same rules as the server (server/app/core/gstin.py). */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SHAPE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Upper case, spaces removed. */
export const normaliseGstin = (value: string) => value.replace(/\s+/g, '').toUpperCase()

/** The 15th character is a check over the first 14 (the published GSTN scheme). */
function checksumOk(gstin: string) {
  let total = 0
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(gstin[i]) * (i % 2 ? 2 : 1)
    total += Math.floor(product / 36) + (product % 36)
  }
  return CHARS[(36 - (total % 36)) % 36] === gstin[14]
}

export const isValidGstin = (value: string) => {
  const g = normaliseGstin(value)
  return SHAPE.test(g) && checksumOk(g)
}

/** antd Form rule: required, and a real GST number. */
export const gstinRule = {
  validator: async (_: unknown, value?: string) => {
    if (!value?.trim()) throw new Error('Enter the GST number')
    if (!isValidGstin(value)) throw new Error('This GST number is not correct. Please check it.')
  },
}
