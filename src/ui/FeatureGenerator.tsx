import { useState } from 'react'
import { generateCustomFeature } from '../engine/codeGenerator'
import {
  suggestFeatures,
  type FeatureSuggestion,
} from '../engine/featureSuggester'
import { DynamicComponentRenderer } from './DynamicComponentRenderer'
import { useStore } from '../store/appStore'
import type { Note } from '../types'

interface GeneratedFeature {
  id: string
  label: string
  icon: string
  description: string
  code?: string
  data?: any
  loading?: boolean
  error?: string
}

interface Props {
  note: Note
}

export function FeatureGenerator({ note }: Props) {
  const { state, setBackend } = useStore()
  const backend = state.settings.aiBackend
  const aiOn = backend !== 'local'
  // Whether the *active* cloud tier has its key on the server.
  const aiConfigured =
    backend === 'gemini'
      ? state.config?.geminiConfigured !== false
      : backend === 'groq'
        ? state.config?.groqConfigured !== false
        : backend === 'haiku'
          ? state.config?.haikuConfigured !== false
          : true
  const backendLabel =
    backend === 'gemini' ? 'Gemini' : backend === 'groq' ? 'Groq' : 'Claude Haiku'
  const backendKeyEnv =
    backend === 'gemini'
      ? 'GOOGLE_GEMINI_API_KEY'
      : backend === 'groq'
        ? 'GROQ_API_KEY'
        : 'ANTHROPIC_API_KEY'

  const [suggestions, setSuggestions] = useState<FeatureSuggestion[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [request, setRequest] = useState('')
  const [generated, setGenerated] = useState<GeneratedFeature[]>([])

  const handleSuggest = async () => {
    setSuggesting(true)
    setSuggestError(null)
    try {
      const { suggestions, error } = await suggestFeatures(note.text, backend)
      if (error) {
        setSuggestError(`${backendLabel}: ${error}`)
      } else if (suggestions.length === 0) {
        setSuggestError(
          `No suggestions came back from ${backendLabel}. Check the server has ${backendKeyEnv} set, or describe a tool below.`
        )
      }
      setSuggestions(suggestions)
    } catch (err) {
      setSuggestError(String(err))
    } finally {
      setSuggesting(false)
    }
  }

  const buildFeature = async (
    label: string,
    icon: string,
    description: string
  ) => {
    const id = `${label}-${Date.now()}`
    setGenerated((prev) => [
      ...prev,
      { id, label, icon, description, loading: true },
    ])

    try {
      const { code, error } = await generateCustomFeature(
        label,
        description,
        note.text,
        backend
      )
      if (error || !code) throw new Error(error || 'Empty response')
      setGenerated((prev) =>
        prev.map((f) => (f.id === id ? { ...f, code, loading: false } : f))
      )
    } catch (err) {
      setGenerated((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, error: String(err), loading: false } : f
        )
      )
    }
  }

  const handleRegenerate = async (feature: GeneratedFeature) => {
    setGenerated((prev) =>
      prev.map((f) =>
        f.id === feature.id
          ? { ...f, loading: true, error: undefined, code: undefined }
          : f
      )
    )
    try {
      const { code, error } = await generateCustomFeature(
        feature.label,
        feature.description,
        note.text,
        backend
      )
      if (error || !code) throw new Error(error || 'Empty response')
      setGenerated((prev) =>
        prev.map((f) =>
          f.id === feature.id ? { ...f, code, loading: false } : f
        )
      )
    } catch (err) {
      setGenerated((prev) =>
        prev.map((f) =>
          f.id === feature.id
            ? { ...f, error: String(err), loading: false }
            : f
        )
      )
    }
  }

  const handleFreeText = () => {
    const text = request.trim()
    if (!text) return
    buildFeature(text, '✦', text)
    setRequest('')
  }

  const handleRemove = (id: string) => {
    setGenerated((prev) => prev.filter((f) => f.id !== id))
  }

  const handleDataChange = (id: string, newData: any) => {
    setGenerated((prev) =>
      prev.map((f) => (f.id === id ? { ...f, data: newData } : f))
    )
  }

  if (!aiOn) {
    return (
      <div className="gen">
        <div className="gen-head">
          <span className="gen-title">Evolve this note</span>
        </div>
        <div className="gen-locked">
          <p>
            You’re on the <strong>Local ML</strong> tier — the note still
            classifies, extracts dates and topics, and builds its workspace
            offline. Pick a cloud tier to let Evolve suggest and build custom
            tools (flashcards, trackers, schedules) for this note.
          </p>
          <div className="gen-tier-actions">
            <button
              className="gen-suggest"
              onClick={() => setBackend('gemini')}
            >
              ✦ Use Gemini
            </button>
            <button
              className="gen-suggest"
              onClick={() => setBackend('haiku')}
            >
              ✦ Use Claude Haiku
            </button>
            <button
              className="gen-suggest"
              onClick={() => setBackend('groq')}
            >
              ✦ Use Groq
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="gen">
      <div className="gen-head">
        <span className="gen-title">Evolve this note</span>
        <button
          className="gen-suggest"
          onClick={handleSuggest}
          disabled={suggesting || !aiConfigured}
        >
          {suggesting ? 'Composing…' : '✦ Suggest tools'}
        </button>
      </div>

      {!aiConfigured && (
        <div className="gen-error">
          {backendLabel} is selected, but the server has no key configured. Add{' '}
          {backendKeyEnv} to <code>server/.env</code> and restart to enable tool
          generation — or switch to the Local ML tier.
        </div>
      )}

      {suggestError && <div className="gen-error">{suggestError}</div>}

      {suggestions.length > 0 && (
        <div className="gen-suggestions">
          <div className="gen-sub">Tailored to what you’re writing</div>
          <div className="gen-chips">
            {suggestions.map((s, i) => (
              <button
                key={`${s.label}-${i}`}
                className="gen-chip"
                onClick={() => buildFeature(s.label, s.icon, s.description)}
                title={s.description}
              >
                <span className="gen-chip-icon">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="gen-ask">
        <input
          className="gen-input"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFreeText()}
          placeholder="Or describe any tool you need…"
        />
        <button
          className="gen-build"
          onClick={handleFreeText}
          disabled={!request.trim()}
        >
          Build
        </button>
      </div>

      {generated.length > 0 && (
        <div className="gen-tools">
          {generated.map((feature) => (
            <div className="gen-card" key={feature.id}>
              <div className="gen-card-head">
                <span className="gen-card-title">
                  <span className="gen-card-icon">{feature.icon}</span>
                  {feature.label}
                </span>
                <span className="gen-card-actions">
                  {!feature.loading && (
                    <button
                      className="gen-act"
                      onClick={() => handleRegenerate(feature)}
                    >
                      Regenerate
                    </button>
                  )}
                  <button
                    className="gen-act gen-act-remove"
                    onClick={() => handleRemove(feature.id)}
                  >
                    Remove
                  </button>
                </span>
              </div>

              {feature.loading && (
                <div className="gen-loading">
                  <span className="gen-spinner" />
                  Crafting {feature.label.toLowerCase()}…
                </div>
              )}

              {feature.error && (
                <div className="gen-error">
                  {feature.error} — try Regenerate.
                </div>
              )}

              {feature.code && (
                <div className="gen-render">
                  <DynamicComponentRenderer
                    code={feature.code}
                    data={feature.data}
                    onChange={(data) => handleDataChange(feature.id, data)}
                    onError={(error) => {
                      setGenerated((prev) =>
                        prev.map((f) =>
                          f.id === feature.id ? { ...f, error } : f
                        )
                      )
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
