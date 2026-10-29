import { useState } from 'react'
import { DatePicker, Popover, Segmented, Tooltip } from 'antd'
import { CalendarOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { usePeriod } from '../hooks/usePeriod'
import { rangeSubtitle, type Period } from '../utils/period'

const PRESETS: Period[] = ['month', 'quarter', 'fy']
// Short labels keep the header on one line; the tooltip gives the exact dates.
const SHORT: Record<Exclude<Period, 'custom'>, string> = { month: 'Month', quarter: 'Quarter', fy: 'Year' }
// The longest custom range the reports accept (server/app/routers/_range.py, yearly points).
const MAX_DAYS = 3660

/** Month / quarter / year, or a custom range, for every report page. */
export default function PeriodPicker() {
  const { period, range, setPeriod, setCustom, custom } = usePeriod()
  const [open, setOpen] = useState(false)
  const label = period === 'custom' ? `${dayjs(range[0]).format('D MMM')} – ${dayjs(range[1]).format('D MMM')}` : 'Custom'
  return (
    <Tooltip title={rangeSubtitle(range)} placement="bottom">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Segmented<Period>
          value={period}
          onChange={(p) => (p === 'custom' ? setOpen(true) : setPeriod(p))}
          options={[
            ...PRESETS.map((p) => ({ value: p, label: SHORT[p as Exclude<Period, 'custom'>] })),
            {
              value: 'custom' as const,
              label: (
                <Popover
                  open={open}
                  onOpenChange={setOpen}
                  trigger="click"
                  placement="bottom"
                  content={
                    <DatePicker.RangePicker
                      defaultValue={custom ? [dayjs(custom[0]), dayjs(custom[1])] : undefined}
                      format="DD MMM YYYY"
                      allowClear={false}
                      disabledDate={(d, info) => d.isAfter(dayjs(), 'day') || (!!info.from && Math.abs(d.diff(info.from, 'day')) > MAX_DAYS)}
                      presets={[
                        { label: 'Last 30 days', value: [dayjs().subtract(29, 'day'), dayjs()] },
                        { label: 'Last 3 months', value: [dayjs().subtract(3, 'month'), dayjs()] },
                        { label: 'Last 6 months', value: [dayjs().subtract(6, 'month'), dayjs()] },
                        { label: 'Last 12 months', value: [dayjs().subtract(12, 'month'), dayjs()] },
                        { label: 'Last calendar year', value: [dayjs().subtract(1, 'year').startOf('year'), dayjs().subtract(1, 'year').endOf('year')] },
                        { label: 'Last 3 years', value: [dayjs().subtract(3, 'year'), dayjs()] },
                        { label: 'Last 5 years', value: [dayjs().subtract(5, 'year'), dayjs()] },
                      ]}
                      onChange={(v) => {
                        if (v?.[0] && v[1]) {
                          setCustom([v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')])
                          setOpen(false)
                        }
                      }}
                    />
                  }
                >
                  <span>
                    <CalendarOutlined /> {label}
                  </span>
                </Popover>
              ),
            },
          ]}
        />
      </span>
    </Tooltip>
  )
}
