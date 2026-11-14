import { itemName } from '../data/catalog'
import type { WastageType } from '../types/entries'
import { formatKg } from './format'

export const WASTAGE_TYPES: WastageType[] = ['gas', 'liquid', 'solid']

export const wastageTypeLabel: Record<WastageType, string> = { gas: 'Gas', liquid: 'Liquid', solid: 'Solid' }

/**
 * In-charges weigh what came out, and add any wastage they saw (kg and its type). Raw material
 * used = products + wastage; stock goes down by that. The wastage is never part of the products.
 * The server works this out again.
 */
export const rawMaterialUsed = (outputKg: number, wastageKg: number) => outputKg + wastageKg

/**
 * Split the stock out over the raw materials used, in whole kg. Lines the person typed keep their
 * kg; the rest is shared equally by the others (the first ones take the leftover kg). 500 kg over
 * three is 167 + 167 + 166. Any part of a kg in the total is put on a line by the server.
 */
export const splitMaterials = (total: number, ids: string[], typed: Record<string, number | null>): Record<string, number> => {
  const free = ids.filter((id) => !(id in typed))
  const fixed = ids.reduce((s, id) => s + (id in typed ? (typed[id] ?? 0) : 0), 0)
  const left = Math.max(Math.round(total) - fixed, 0)
  const each = free.length ? Math.floor(left / free.length) : 0
  const extra = left - each * free.length
  return Object.fromEntries(ids.map((id) => [id, id in typed ? (typed[id] ?? 0) : each + (free.indexOf(id) < extra ? 1 : 0)]))
}

/**
 * The person typed `kg` for `id`. Keeps at least one line free to take the rest, so the lines
 * always add up: when every line has been typed, the one typed longest ago becomes free again.
 */
export const typeMaterial = (typed: Record<string, number | null>, ids: string[], id: string, kg: number | null) => {
  const next = Object.fromEntries(Object.entries(typed).filter(([k]) => k !== id && ids.includes(k)))
  next[id] = kg
  const keys = Object.keys(next)
  if (keys.length >= ids.length) delete next[keys[0]]
  return next
}

/** What is wrong with a split of `total` kg over the raw materials, or null when it is fine. */
export function splitProblem(total: number, split: Record<string, number>, available?: (id: string) => number | undefined): string | null {
  const ids = Object.keys(split)
  if (ids.some((id) => split[id] <= 0)) return 'Each raw material must have more than 0 kg.'
  const over = ids.find((id) => available && split[id] > (available(id) ?? Infinity))
  if (over) return `Only ${formatKg(available!(over)!)} of Grade A ${itemName(over).toLowerCase()} is in stock.`
  const sum = ids.reduce((s, id) => s + split[id], 0)
  if (sum !== Math.round(total)) return `The raw materials must add up to ${formatKg(total)}. Now ${formatKg(sum)}.`
  return null
}
