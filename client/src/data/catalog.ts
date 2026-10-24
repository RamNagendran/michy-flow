/**
 * Items, units and company types. Mirrored from server/app/models/catalog.py and enums.py.
 *
 * Quantities are in each item's own unit: litres for oil, kg for everything else.
 * Production balances by weight, so oil is turned into kg with its density.
 */

export type MaterialId = 'truck' | 'car' | 'tractor' | 'twowheeler' | 'otr' | 'scrap_steel'
export type OutputId = 'oil' | 'carbon' | 'rubber' | 'steel' | 'other' | 'waste_water' | 'waste'
export type ItemId = MaterialId | OutputId
export type Unit = 'kg' | 'L'
export type CompanyCategory = 'pyrolysis' | 'crumb' | 'steel'

export interface CatalogItem<T extends string = ItemId> {
  id: T
  name: string
  description: string
  unit: Unit
  /** Kept in stock and can be sold. Weighed waste is recorded but never stocked. */
  stocked: boolean
}

const item = <T extends string>(id: T, name: string, description: string, unit: Unit = 'kg', stocked = true): CatalogItem<T> => ({ id, name, description, unit, stocked })

export const materials: CatalogItem<MaterialId>[] = [
  item('truck', 'Truck tyres', 'TBR / bus & truck scrap tyres, whole or cut'),
  item('car', 'Car tyres', 'PCR / passenger car scrap tyres'),
  item('tractor', 'Tractor tyres', 'Agricultural / tractor scrap tyres'),
  item('twowheeler', 'Two-wheeler tyres', 'Bike & scooter scrap tyres'),
  item('otr', 'OTR tyres', 'Off-the-road / earthmover tyres'),
  item('scrap_steel', 'Scrap steel', 'Tyre steel wire and scrap steel for recovery'),
]

export const outputs: CatalogItem<OutputId>[] = [
  item('oil', 'Oil', 'Tyre pyrolysis oil, measured in litres', 'L'),
  item('carbon', 'Carbon powder', 'Recovered carbon black / carbon powder'),
  item('rubber', 'Rubber crumbs', 'Crumb rubber / rubber granules'),
  item('steel', 'Steel', 'Recovered steel wire'),
  item('other', 'Fibre & other', 'Fabric / fluff and other by-products'),
  item('waste_water', 'Waste water', 'Water separated in the process'),
  item('waste', 'Waste', 'Weighed waste for disposal: recorded, never stocked or sold', 'kg', false),
]

const all: CatalogItem<string>[] = [...materials, ...outputs]
const byId = new Map(all.map((i) => [i.id, i]))

export const itemName = (id: string) => byId.get(id)?.name ?? id
export const unitOf = (id: string): Unit => byId.get(id)?.unit ?? 'kg'
export const materialName = (id: MaterialId) => itemName(id)
export const outputName = (id: OutputId) => itemName(id)
/** Every item that can be stocked, bought or sold (everything but weighed waste). */
export const stockedItems = all.filter((i) => i.stocked)

/** kg per litre of oil: the allowed range and a new company's default (server/app/models/catalog.py). */
export const OIL_DENSITY = { min: 1.03, max: 1.05, default: 1.04 }
/** Weight of `qty` of an item; litres are weighed with the company's oil density. */
export const toKg = (id: string, qty: number, density: number = OIL_DENSITY.default) => (unitOf(id) === 'L' ? qty * density : qty)
/** What a company may be configured to process (anything stocked) and to make. */
export const inputChoices = all.filter((i) => i.stocked)
export const outputChoices = outputs

/** The hard wastage limit (% of the processed weight). Same as the server setting WASTAGE_ALERT_PCT. */
export const WASTAGE_ALERT_PCT = 2
/** Planned hours of one of the three daily shifts. Same as the server setting SHIFT_HOURS. */
export const SHIFT_HOURS = 8

export interface Process {
  id: CompanyCategory
  name: string
  example: string
  summary: string
  inputs: CatalogItem<MaterialId>[]
  /** In display order. Every process may also record weighed waste. */
  outputs: CatalogItem<OutputId>[]
  /** Outputs that go into stock and can be sold. */
  products: CatalogItem<OutputId>[]
}

const pick = <T extends string>(list: CatalogItem<T>[], ids: T[]) => ids.map((id) => list.find((i) => i.id === id)!)
const process = (id: CompanyCategory, name: string, example: string, summary: string, inputs: MaterialId[], outs: OutputId[]): Process => {
  const o = pick(outputs, outs)
  return { id, name, example, summary, inputs: pick(materials, inputs), outputs: o, products: o.filter((i) => i.stocked) }
}

const TYRES: MaterialId[] = ['truck', 'car', 'tractor', 'twowheeler', 'otr']

export const PROCESSES: Process[] = [
  process('pyrolysis', 'Tyre pyrolysis', "e.g. Jack's Green Tech", 'Tyres → oil (litres), carbon powder, steel and waste water', TYRES, ['oil', 'carbon', 'steel', 'waste_water', 'waste']),
  process('crumb', 'Crumb rubber', 'e.g. Chennai Crumb Industries', 'Tyres → rubber crumbs and steel', TYRES, ['rubber', 'steel', 'other', 'waste']),
  process('steel', 'Steel recovery', 'e.g. Michy Metal and Alloys', 'Scrap steel → steel', ['scrap_steel'], ['steel', 'waste']),
]

const processes = new Map(PROCESSES.map((p) => [p.id, p]))
/** A company type: its name, summary and default inputs and outputs. */
export const processOf = (category: CompanyCategory) => processes.get(category)!

export interface CompanyItems {
  inputs: CatalogItem<string>[]
  outputs: CatalogItem<string>[]
  products: CatalogItem<string>[]
}

/** One company's own inputs and outputs (its inventory configuration), or its type's defaults. */
export function companyItems(c: { category: CompanyCategory; input_items?: string[]; output_items?: string[] }): CompanyItems {
  const type = processOf(c.category)
  const lookup = (ids: string[] | undefined, fallback: CatalogItem<string>[]) => (ids?.length ? ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) : fallback)
  const outs = lookup(c.output_items, type.outputs)
  return { inputs: lookup(c.input_items, type.inputs), outputs: outs, products: outs.filter((o) => o.stocked) }
}

/** Items any of these companies uses, in catalogue order, without repeats. */
export function itemsOfCompanies(companies: Parameters<typeof companyItems>[0][], which: keyof CompanyItems): CatalogItem<string>[] {
  const wanted = new Set(companies.flatMap((c) => companyItems(c)[which].map((i) => i.id)))
  return all.filter((i) => wanted.has(i.id))
}
