import React, { useEffect, useState } from 'react'
import { transform } from 'sucrase'

interface DynamicComponentProps {
  code: string
  data: any
  onChange?: (data: any) => void
  onError?: (error: string) => void
}

export function DynamicComponentRenderer({
  code,
  data,
  onChange,
  onError,
}: DynamicComponentProps) {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      // Normalize: strip module syntax the generator may emit, and drop any
      // import lines (only "React" is available in scope).
      let body = code.trim()
      body = body
        .split('\n')
        .filter((line) => !/^\s*import\s/.test(line))
        .join('\n')
      body = body.replace(/export\s+default\s+/, '')
      body = body.replace(/^export\s+/m, '')

      // If it's a named function declaration, capture and return its name;
      // otherwise treat the whole thing as an expression to return.
      const named = body.match(/function\s+([A-Za-z0-9_$]+)\s*\(/)
      const wrapped = named
        ? `${body}\nreturn ${named[1]};`
        : `return (${body});`

      // Compile JSX -> React.createElement (classic runtime references React).
      const compiled = transform(wrapped, {
        transforms: ['jsx'],
        production: true,
      }).code

      // Only "React" is in scope. Components must use React.useState etc.
      const func = new Function('React', compiled)

      const Comp = func(React)
      if (typeof Comp !== 'function') {
        throw new Error('Generated code did not produce a component function')
      }
      setComponent(() => Comp)
      setError(null)
    } catch (err) {
      const errorMsg = `Component error: ${String(err)}`
      setError(errorMsg)
      onError?.(errorMsg)
      console.error('Failed to load component:', err, code)
    }
  }, [code, onError])

  // Errors and the loading state are framed by the parent (.gen-card); keep
  // these here only as a quiet fallback when used standalone.
  if (error) return null

  if (!Component) {
    return <div className="gen-loading">Rendering…</div>
  }

  // Wrap in a surface that sets the app's baseline typography/colour. Generated
  // components use var(--…) tokens that resolve here; this is the safety net so
  // even an under-styled component still reads as part of the app.
  return (
    <div className="gen-surface">
      <Component data={data} onChange={onChange} />
    </div>
  )
}
