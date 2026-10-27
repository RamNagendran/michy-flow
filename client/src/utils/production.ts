import { WASTAGE_ALERT_PCT } from '../data/catalog'

export interface Balance {
  /** Weight of everything that came out (oil by its density). */
  outputKg: number
  /** WASTAGE_ALERT_PCT of the output, before rounding. */
  outputWastageKg: number
  /** Output + wastage, to the nearest kg. Stock goes down by this. */
  calculatedKg: number
  /** The total wastage is worked out on: the calculated weight, or what the in-charge typed. */
  totalKg: number
  /** WASTAGE_ALERT_PCT of the output, or of the total if the in-charge changed it. */
  wastageKg: number
  /** The in-charge typed less than the calculated weight, which is not allowed. */
  tooLow: boolean
}

/** Output + the wastage rate, to the nearest kg. Same as the server's calculated_input(). */
export const calculatedInput = (outputKg: number) => Math.round(outputKg * (1 + WASTAGE_ALERT_PCT / 100))

/**
 * In-charges weigh only what came out. Stock goes down by products + 2% and wastage is 2% of
 * the products. If they change the total, it is used only to work out the wastage: the stock and
 * the products stay the same, and the total is not saved. The server works this out again.
 */
export function balanceOf(outputKg: number, totalKg?: number | null): Balance {
  const calculatedKg = calculatedInput(outputKg)
  const outputWastageKg = (outputKg * WASTAGE_ALERT_PCT) / 100
  return {
    outputKg,
    outputWastageKg,
    calculatedKg,
    totalKg: totalKg ?? calculatedKg,
    wastageKg: totalKg == null ? outputWastageKg : (totalKg * WASTAGE_ALERT_PCT) / 100,
    tooLow: totalKg != null && totalKg < calculatedKg,
  }
}
