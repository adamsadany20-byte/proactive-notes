import { useEffect, useRef, useState } from 'react'
import { generateCustomFeature } from '../engine/codeGenerator'
import {
  suggestFeatures,
  type FeatureSuggestion,
} from '../engine/featureSuggester'
import { DynamicComponentRenderer } from './DynamicComponentRenderer'
import { useStore } from '../store/appStore'
import {
  startSubscription,
  recommendApi,
  type Recommendation,
  type ActionRec,
} from '../services/api'
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
  // The tool generator is an EVOLVE-tier feature, so it gates on broaderAi
  // (true only for evolve) — a Classification-only plan doesn't get it.
  const aiOn = state.settings.broaderAi
  // Paywalled only when billing is on and this client isn't subscribed. Free
  // mode (default) leaves this false so the generator stays fully usable.
  const locked = !!state.billing?.billingEnabled && !state.billing?.subscribed

  const goToCheckout = async () => {
    const { url, error } = await startSubscription('evolve')
    if (url) window.location.href = url
    else if (error) alert(error)
  }
  // Whether the cloud AI tier has its key on the server.
  const aiConfigured =
    backend === 'haiku' ? state.config?.haikuConfigured !== false : true
  const backendLabel = 'Evolve AI'

  const [suggestions, setSuggestions] = useState<FeatureSuggestion[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [request, setRequest] = useState('')
  const [generated, setGenerated] = useState<GeneratedFeature[]>([])

  // Seamless discovery: instead of a button, suggestions surface on their own a
  // beat after you stop typing (on the Claude tier). Debounced, cached by text,
  // and stale responses are ignored so it never flickers or races.
  const reqId = useRef(0)
  const lastText = useRef('')
  useEffect(() => {
    if (!aiOn || !aiConfigured || locked) return
    const text = note.text.trim()
    if (text.length < 8 || text === lastText.current) return
    const handle = setTimeout(async () => {
      const myId = ++reqId.current
      lastText.current = text
      setSuggesting(true)
      setSuggestError(null)
      try {
        const { suggestions, error } = await suggestFeatures(text, backend)
        if (myId !== reqId.current) return
        if (error) setSuggestError(`${backendLabel}: ${error}`)
        setSuggestions(suggestions)
      } catch (err) {
        if (myId === reqId.current) setSuggestError(String(err))
      } finally {
        if (myId === reqId.current) setSuggesting(false)
      }
    }, 1200)
    return () => clearTimeout(handle)
  }, [note.text, aiOn, aiConfigured, locked, backend, backendLabel])

  // Real-world recommendations — the AI reaching beyond the note to name actual
  // products, places, books, tools worth knowing about — AND concrete next steps
  // to take (actions). Both come from the same recommend call. Same seamless
  // pattern.
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [recHeading, setRecHeading] = useState('')
  const [recsOpen, setRecsOpen] = useState(true)
  const [actions, setActions] = useState<ActionRec[]>([])
  const [actionsOpen, setActionsOpen] = useState(true)
  const recReqId = useRef(0)
  const lastRecText = useRef('')
  useEffect(() => {
    if (!aiOn || !aiConfigured || locked) return
    const text = note.text.trim()
    if (text.length < 8 || text === lastRecText.current) return
    const handle = setTimeout(async () => {
      const myId = ++recReqId.current
      lastRecText.current = text
      try {
        const { heading, recommendations, actions } = await recommendApi(text, backend)
        if (myId !== recReqId.current) return
        setRecHeading(heading)
        setRecs(recommendations)
        setActions(actions)
      } catch {
        /* recommendations are a bonus; stay quiet on failure */
      }
    }, 1600)
    return () => clearTimeout(handle)
  }, [note.text, aiOn, aiConfigured, locked, backend])

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

  if (aiOn && locked) {
    const pricing = state.billing?.pricing
    const evPrice = ((pricing?.evolvePricePence ?? 1200) / 100).toFixed(0)
    const evAiIncl = ((pricing?.evolveAiIncludedPence ?? 500) / 100).toFixed(0)
    const evClIncl = ((pricing?.evolveClassifierIncludedPence ?? 100) / 100).toFixed(0)
    const markup = pricing?.overageMarkup ?? 2
    return (
      <div className="gen">
        <div className="gen-head">
          <span className="gen-title">Evolve this note</span>
        </div>
        <div className="gen-locked">
          <p>
            <strong>Evolve AI — £{evPrice}/month.</strong> Includes £{evAiIncl} of
            coding &amp; world knowledge and £{evClIncl} of classifier usage each
            month (£{markup} per £1 beyond either). Your notes keep classifying and
            building their workspace for free on the Local engine.
          </p>
          <div className="gen-tier-actions">
            <button className="gen-build" onClick={() => goToCheckout()}>
              ✦ Subscribe — £{evPrice}/mo
            </button>
            <button className="gen-suggest" onClick={() => setBackend('local')}>
              Stay on Local
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!aiOn) {
    const onClassifier = state.settings.tier === 'classifier'
    return (
      <div className="gen">
        <div className="gen-head">
          <span className="gen-title">Evolve this note</span>
        </div>
        <div className="gen-locked">
          <p>
            {onClassifier ? (
              <>
                You’re on the <strong>Classification</strong> tier — Claude sharpens
                each note’s category, and the workspace builds offline. Upgrade to
                Evolve AI to also suggest and build custom tools (flashcards,
                trackers, schedules) for this note.
              </>
            ) : (
              <>
                You’re on the <strong>Local ML</strong> tier — the note still
                classifies, extracts dates and topics, and builds its workspace
                offline. Switch to Evolve AI to let it suggest and build custom
                tools (flashcards, trackers, schedules) for this note.
              </>
            )}
          </p>
          <div className="gen-tier-actions">
            <button
              className="gen-suggest"
              onClick={() => setBackend('haiku')}
            >
              ✦ Use Evolve AI
            </button>
          </div>
        </div>
      </div>
    )
  }

  const showSkeleton = suggesting && suggestions.length === 0

  return (
    <div className="gen">
      <div className="gen-head">
        <span className="gen-title">Evolve this note</span>
        {suggesting && suggestions.length > 0 && (
          <span className="gen-thinking">
            <span className="gen-spinner" /> rethinking…
          </span>
        )}
      </div>

      {!aiConfigured && (
        <div className="gen-error">
          {backendLabel} is selected, but it isn’t configured on the server yet.
          Switch to the Local ML tier, or try again later.
        </div>
      )}

      {suggestError && <div className="gen-error">{suggestError}</div>}

      {showSkeleton && (
        <div className="gen-suggestions">
          <div className="gen-sub">finding tools that fit…</div>
          <div className="gen-chips">
            {[132, 96, 150].map((w, i) => (
              <span
                key={i}
                className="gen-chip-skel skel"
                style={{ width: w, animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </div>
        </div>
      )}

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
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                <span className="gen-chip-icon">{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {actions.length > 0 && (
        <div className="gen-recs gen-actions">
          <button
            className="gen-recs-toggle"
            onClick={() => setActionsOpen((o) => !o)}
            aria-expanded={actionsOpen}
          >
            <span className="gen-sub">Next steps to take</span>
            <span className="gen-recs-count">{actions.length}</span>
            <span className={`gen-recs-chevron ${actionsOpen ? 'open' : ''}`}>
              ⌄
            </span>
          </button>
          {actionsOpen && (
            <ul className="act-list">
              {actions.map((a, i) => (
                <li
                  className="act-item"
                  key={`${a.action}-${i}`}
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  <span className="act-check" aria-hidden>
                    →
                  </span>
                  <div className="act-body">
                    <span className="act-name">{a.action}</span>
                    <span className="act-detail">{a.detail}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {recs.length > 0 && (
        <div className="gen-recs">
          <button
            className="gen-recs-toggle"
            onClick={() => setRecsOpen((o) => !o)}
            aria-expanded={recsOpen}
          >
            <span className="gen-sub">{recHeading || 'Worth a look'}</span>
            <span className="gen-recs-count">{recs.length}</span>
            <span className={`gen-recs-chevron ${recsOpen ? 'open' : ''}`}>
              ⌄
            </span>
          </button>
          {recsOpen && (
            <ul className="rec-list">
              {recs.map((r, i) => (
                <li
                  className="rec-item"
                  key={`${r.name}-${i}`}
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  <div className="rec-top">
                    <span className="rec-name">{r.name}</span>
                    <span className="rec-kind">{r.kind}</span>
                  </div>
                  <div className="rec-detail">{r.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="gen-ask">
        <input
          className="gen-input"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFreeText()}
          placeholder="Or tell me what to build…"
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
