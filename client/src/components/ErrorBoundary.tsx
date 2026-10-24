import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Result } from 'antd'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last line of defence: shows a friendly screen instead of a blank page when rendering throws. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Result
        status="error"
        title="Something went wrong"
        subTitle="This screen hit an unexpected problem. Reloading usually fixes it."
        style={{ paddingTop: 120 }}
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        }
      />
    )
  }
}
