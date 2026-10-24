import { Component, type ReactNode } from 'react'
import { Button, Result } from 'antd'

const RELOAD_KEY = 'michy-flow:chunk-reload-at'
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError/i

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * After a deploy, lazy-loaded pages from the old build no longer exist on the server.
 * When loading one fails, reload once to pick up the new build. Other errors go to the parent ErrorBoundary.
 */
export default class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (!CHUNK_ERROR.test(error.message)) return
    try {
      // Only one automatic reload per minute, so a genuinely broken deploy can't cause a reload loop.
      if (Date.now() - (Number(sessionStorage.getItem(RELOAD_KEY)) || 0) < 60_000) return
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
    } catch {
      return // no sessionStorage: leave it to the manual reload screen
    }
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (!CHUNK_ERROR.test(error.message)) throw error
    return (
      <Result
        status="info"
        title="A new version is available"
        subTitle="Reload the page to continue."
        style={{ paddingTop: 120 }}
        extra={
          <Button type="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    )
  }
}
