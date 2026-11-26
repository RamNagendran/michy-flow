import { useEffect } from 'react'
import { Button, DatePicker, Form, Input, InputNumber, Select } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useFxRate } from '../../hooks/queries/fx'
import type { Unit } from '../../data/catalog'
import { perUnit } from '../../utils/format'
import { CURRENCIES, type ImportValues } from '../../utils/importPrice'

/**
 * Price in the supplier's currency, the exchange rate to rupees, customs duty and the Bill of Entry.
 * The live rate fills an empty exchange rate; a rate read from the Bill of Entry is kept.
 */
export default function ImportPriceFields({ unit, rateFromBill }: { unit: Unit; rateFromBill?: boolean }) {
  const form = Form.useFormInstance<ImportValues>()
  const currency: string | undefined = Form.useWatch('currency', form)
  const fxRate: number | undefined = Form.useWatch('fxRate', form)
  const live = useFxRate(currency)
  const liveRate = live.data ? Number(live.data.rate) : undefined

  useEffect(() => {
    if (liveRate && !form.getFieldValue('fxRate')) form.setFieldValue('fxRate', liveRate)
  }, [liveRate, form])

  const per = unit === 'L' ? 'litre' : 'kg'
  const liveNote = live.isFetching
    ? 'Getting today’s rate…'
    : live.isError
      ? 'Live rate not available now. Type the rate from the bill or bank.'
      : liveRate && currency
        ? `Live rate: ₹${liveRate.toLocaleString('en-IN', { maximumFractionDigits: 4 })} per 1 ${currency}, updated ${dayjs(live.data!.as_of).format('D MMM, h:mm A')}`
        : undefined

  return (
    <>
      <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
        <Form.Item label="Currency on the bill" name="currency" rules={[{ required: true, message: 'Choose the currency' }]}>
          <Select showSearch options={CURRENCIES.map((c) => ({ value: c, label: c }))} placeholder="e.g. USD" />
        </Form.Item>
        <Form.Item
          label={`Rate per ${per} in ${currency ?? 'the currency'}`}
          name="foreignRate"
          rules={[{ required: true, type: 'number', min: 0.000001, message: 'Enter the rate' }]}
          extra={unit === 'L' ? 'Price per kilolitre? Divide by 1,000.' : 'Price per tonne? Divide by 1,000. e.g. 105 per tonne = 0.105 per kg.'}
        >
          <InputNumber<number> style={{ width: '100%' }} min={0} step={0.001} precision={6} prefix={currency} suffix={perUnit(unit)} placeholder="e.g. 0.105" />
        </Form.Item>
      </div>
      <Form.Item
        label={`Exchange rate (₹ for 1 ${currency ?? 'unit'})`}
        name="fxRate"
        rules={[{ required: true, type: 'number', min: 0.0001, message: 'Enter the exchange rate' }]}
        tooltip="Use the rate printed on the Bill of Entry (e.g. 1 USD = 94.1 INR). Without it, today's live rate is filled in. You can change it."
        extra={
          <span>
            {rateFromBill ? 'From the Bill of Entry. ' : ''}
            {liveNote}
            {liveRate && fxRate !== liveRate && (
              <Button type="link" size="small" icon={<SyncOutlined />} onClick={() => form.setFieldValue('fxRate', liveRate)} style={{ paddingInline: 6 }}>
                Use live rate
              </Button>
            )}
          </span>
        }
      >
        <InputNumber<number> style={{ width: '100%' }} min={0} step={0.01} precision={4} prefix="₹" placeholder="e.g. 94.10" />
      </Form.Item>
      <div className="grid grid-2" style={{ columnGap: 16, rowGap: 0 }}>
        <Form.Item label="Bill of Entry number" name="beNo" rules={[{ required: true, whitespace: true, max: 30, message: 'Enter the Bill of Entry number' }]}>
          <Input placeholder="e.g. 5189281" />
        </Form.Item>
        <Form.Item label="Bill of Entry date" name="beDate">
          <DatePicker format="DD MMM YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
      </div>
      <Form.Item label="Customs duty paid" name="customsDuty" tooltip="Total duty on the Bill of Entry, in rupees. Kept apart; it is not added to the purchase cost.">
        <InputNumber<number> style={{ width: '100%' }} min={0} step={1} precision={2} prefix="₹" placeholder="e.g. 1,37,482" />
      </Form.Item>
    </>
  )
}
