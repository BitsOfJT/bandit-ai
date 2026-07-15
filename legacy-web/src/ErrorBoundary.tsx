import { Component } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#06070a',
          color: '#e2e8f0',
          fontFamily: "'Share Tech Mono', monospace",
          padding: '2rem',
          textAlign: 'center',
        }}>
          <h1 style={{ color: '#ff007f', fontFamily: "'Press Start 2P', monospace", fontSize: '0.9rem', marginBottom: '1rem' }}>
            SYSTEM CRASH
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '2rem' }}>
            Bandit tripped over a garbage can. Refresh the page to scavenge again.
          </p>
          <pre style={{
            background: '#0a0b10',
            border: '2px solid #1a202c',
            padding: '1rem',
            fontSize: '0.75rem',
            color: '#ff007f',
            maxWidth: '100%',
            overflow: 'auto',
          }}>
            {this.state.error?.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
