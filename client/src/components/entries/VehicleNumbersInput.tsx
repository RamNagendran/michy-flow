import { Select } from 'antd'

/** Type one or more vehicle numbers. Press Enter (or type a comma) after each one. */
export default function VehicleNumbersInput({ value, onChange }: { value?: string[]; onChange?: (v: string[]) => void }) {
  return (
    <Select
      mode="tags"
      open={false}
      suffixIcon={null}
      tokenSeparators={[',']}
      placeholder="e.g. TN 38 AB 1234. Press Enter after each."
      value={value}
      maxCount={20}
      onChange={(v: string[]) => onChange?.(v.map((x) => x.replace(/\s+/g, '').toUpperCase().slice(0, 20)).filter((x, i, all) => x && all.indexOf(x) === i))}
    />
  )
}
