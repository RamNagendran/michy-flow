import { WASTAGE_ALERT_PCT } from '../data/catalog'

export interface Balance {
  takenKg: number
  returnedKg: number
  processedKg: number
  outputKg: number
  missingKg: number
  missingPct: number
  flagged: boolean
}

/** The reverse calculation the server also does: what was processed, and what went missing. */
export function balanceOf(takenKg: number, returnedKg: number, outputKg: number): Balance {
  const processedKg = Math.max(takenKg - returnedKg, 0)
  const missingKg = processedKg - outputKg
  const missingPct = processedKg ? (missingKg / processedKg) * 100 : 0
  return { takenKg, returnedKg, processedKg, outputKg, missingKg, missingPct, flagged: missingPct > WASTAGE_ALERT_PCT }
}
