import { useState } from 'react'
import type { AgentQuestion } from '../types'
import { StarSixIcon } from '../ui/icons'

export function ContextualPrompt({
  question,
  onAnswer,
  onSkip,
}: {
  question: AgentQuestion
  onAnswer: (field: string, value: string) => void
  onSkip: (field: string) => void
}) {
  const [text, setText] = useState('')

  const submit = () => {
    const v = text.trim()
    if (v) {
      onAnswer(question.field, v)
      setText('')
    }
  }

  return (
    <div className="prompt" key={question.id}>
      <div className="prompt-q">
        <span className="ai">
          <StarSixIcon />
        </span>
        <span>{question.text}</span>
      </div>

      {question.chips && question.chips.length > 0 && (
        <div className="chips">
          {question.chips.map((chip) => (
            <button
              key={chip}
              className="chip"
              onClick={() => onAnswer(question.field, chip)}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {question.placeholder && (
        <div className="prompt-input">
          <input
            value={text}
            placeholder={question.placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <button onClick={submit}>Add</button>
        </div>
      )}

      <button className="prompt-skip" onClick={() => onSkip(question.field)}>
        Not now
      </button>
    </div>
  )
}
