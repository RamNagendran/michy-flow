import type { WastageType } from '../types/entries'

export const WASTAGE_TYPES: WastageType[] = ['gas', 'liquid', 'solid']

export const wastageTypeLabel: Record<WastageType, string> = { gas: 'Gas', liquid: 'Liquid', solid: 'Solid' }

/**
 * In-charges weigh what came out, and add any wastage they saw (kg and its type). Raw material
 * used = products + wastage; stock goes down by that. The wastage is never part of the products.
 * The server works this out again.
 */
export const rawMaterialUsed = (outputKg: number, wastageKg: number) => outputKg + wastageKg
