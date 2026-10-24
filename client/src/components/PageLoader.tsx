import { Spin } from 'antd'

export default function PageLoader({ fullscreen = false }: { fullscreen?: boolean }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: fullscreen ? '100vh' : 360 }}>
      <Spin size="large" />
    </div>
  )
}
