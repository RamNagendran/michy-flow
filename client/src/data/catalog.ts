/**
 * Items, units and company types. The Super Admin sets them (Settings → Company types & items);
 * they are loaded from GET /catalog by useCatalog before any screen shows, then read through
 * the helpers below. Mirrors server/app/models/catalog.py.
 *
 * Quantities are in each item's own unit: litres or kg.
 * Production balances by weight, so litres are turned into kg: each litres item has its own kg
 * per litre, and a company may set its own number for any of them.
 */

/** An item's key (e.g. "truck"). Saved on every entry; it never changes once the item is made. */
export type ItemId = string
export type MaterialId = ItemId
export type OutputId = ItemId
export type Unit = 'kg' | 'L'
export type ItemKind = 'material' | 'product'
/** A company type's key (e.g. "pyrolysis"). */
export type CompanyCategory = string

export interface CatalogItem<T extends string = ItemId> {
  id: T
  name: string
  description: string
  unit: Unit
  kind: ItemKind
  /** Kept in stock and can be sold. Weighed waste is recorded but never stocked. */
  stocked: boolean
  /** Litres items only: how many kg one litre weighs. */
  kg_per_litre: number | null
  color: string
}

/** What GET /catalog returns. */
export interface CatalogItemRow {
  id: number
  key: string
  name: string
  description: string
  kind: ItemKind
  unit: Unit
  stocked: boolean
  kg_per_litre: number | null
  color: string
}
export interface CompanyTypeRow {
  id: number
  key: string
  name: string
  example: string
  input_items: string[]
  output_items: string[]
  /** Companies of this type. */
  companies: number
}
export interface CatalogData {
  version: string
  items: CatalogItemRow[]
  types: CompanyTypeRow[]
}

export interface Process {
  id: CompanyCategory
  name: string
  example: string
  /** e.g. "Truck tyres, Car tyres → Oil, Steel" */
  summary: string
  inputs: CatalogItem[]
  /** In display order. */
  outputs: CatalogItem[]
  /** Outputs that go into stock and can be sold. */
  products: CatalogItem[]
}

/** The item colour when none is set. */
export const NEUTRAL = '#8A919E'

let loaded: CatalogData | null = null
let all: CatalogItem[] = []
let byId = new Map<string, CatalogItem>()
let processes = new Map<string, Process>()
let processList: Process[] = []

const pick = (ids: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
const names = (list: CatalogItem[], max = 3) =>
  list
    .slice(0, max)
    .map((i) => i.name)
    .join(', ') + (list.length > max ? ` +${list.length - max}` : '')

/** Called by useCatalog with whatever data it has: fresh from GET /catalog, or restored from the saved cache. */
export function setCatalog(data: CatalogData) {
  if (data === loaded) return
  loaded = data
  all = data.items.map((r) => ({
    id: r.key,
    name: r.name,
    description: r.description,
    unit: r.unit,
    kind: r.kind,
    stocked: r.stocked,
    kg_per_litre: r.kg_per_litre,
    color: r.color,
  }))
  byId = new Map(all.map((i) => [i.id, i]))
  processList = data.types.map((t) => {
    const inputs = pick(t.input_items)
    const outputs = pick(t.output_items)
    return {
      id: t.key,
      name: t.name,
      example: t.example,
      summary: `${names(inputs)} → ${names(outputs)}`,
      inputs,
      outputs,
      products: outputs.filter((o) => o.stocked),
    }
  })
  processes = new Map(processList.map((p) => [p.id, p]))
}

export const itemName = (id: string) => byId.get(id)?.name ?? id
export const unitOf = (id: string): Unit => byId.get(id)?.unit ?? 'kg'
export const itemColor = (id: string) => byId.get(id)?.color ?? NEUTRAL
export const materialName = (id: MaterialId) => itemName(id)
export const outputName = (id: OutputId) => itemName(id)
/** Every item, in the Super Admin's order. */
export const allItems = () => all
/** Every item that can be stocked, bought or sold (everything but weighed waste). */
export const stockedItems = () => all.filter((i) => i.stocked)
/** What a company may be configured to process (anything stocked) and to make (any product). */
export const inputChoices = () => all.filter((i) => i.stocked)
export const outputChoices = () => all.filter((i) => i.kind === 'product')

/** The allowed kg per litre of a litres item (server/app/models/catalog.py). */
export const KG_PER_LITRE = { min: 0.5, max: 2 }
/** A company's own kg per litre, by item (companies.kg_per_litre). */
export type LitreFactors = Record<string, number>
/** How many kg one litre of an item weighs: the company's own number, or else the item's. */
export const kgPerLitre = (id: string, factors?: LitreFactors) => factors?.[id] ?? byId.get(id)?.kg_per_litre ?? 1
/** Weight of `qty` of an item; litres are weighed by kg per litre. */
export const toKg = (id: string, qty: number, factors?: LitreFactors) => (unitOf(id) === 'L' ? qty * kgPerLitre(id, factors) : qty)

/** The hard wastage limit (% of the processed weight). Same as the server setting WASTAGE_ALERT_PCT. */
export const WASTAGE_ALERT_PCT = 2
/** Planned hours of one of the three daily shifts. Same as the server setting SHIFT_HOURS. */
export const SHIFT_HOURS = 8

/** Every company type, in the Super Admin's order. */
export const PROCESSES = () => processList
const UNKNOWN_TYPE = (id: string): Process => ({
  id,
  name: id,
  example: '',
  summary: '',
  inputs: [],
  outputs: [],
  products: [],
})
/** A company type: its name, summary and default inputs and outputs. */
export const processOf = (category: CompanyCategory) => processes.get(category) ?? UNKNOWN_TYPE(category)

export interface CompanyItems {
  inputs: CatalogItem[]
  outputs: CatalogItem[]
  products: CatalogItem[]
}

/** One company's own inputs and outputs (its inventory configuration), or its type's defaults. */
export function companyItems(c: { category: CompanyCategory; input_items?: string[]; output_items?: string[] }): CompanyItems {
  const type = processOf(c.category)
  const outs = c.output_items?.length ? pick(c.output_items) : type.outputs
  return {
    inputs: c.input_items?.length ? pick(c.input_items) : type.inputs,
    outputs: outs,
    products: outs.filter((o) => o.stocked),
  }
}

/** Items any of these companies uses, in catalogue order, without repeats. */
export function itemsOfCompanies(companies: Parameters<typeof companyItems>[0][], which: keyof CompanyItems): CatalogItem[] {
  const wanted = new Set(companies.flatMap((c) => companyItems(c)[which].map((i) => i.id)))
  return all.filter((i) => wanted.has(i.id))
}
