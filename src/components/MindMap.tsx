import { useEffect, useRef, useState } from 'react'
import type { MindEdge, MindNode, Note } from '../types'
import { useStore } from '../store/appStore'
import { uid } from '../engine/generate'

// Seed a first node from the note's opening line so the canvas never starts cold.
function seed(note: Note): { nodes: MindNode[]; edges: MindEdge[] } {
  const headline = note.text.trim().split('\n')[0].slice(0, 40)
  return {
    nodes: [{ id: uid('mind'), text: headline || 'Main idea', x: 320, y: 220 }],
    edges: [],
  }
}

export function MindMap({ note }: { note: Note }) {
  const { setMindmap } = useStore()
  const canvasRef = useRef<HTMLDivElement>(null)

  const [nodes, setNodes] = useState<MindNode[]>(
    () => note.mindmap?.nodes ?? seed(note).nodes,
  )
  const [edges, setEdges] = useState<MindEdge[]>(
    () => note.mindmap?.edges ?? [],
  )
  const [connecting, setConnecting] = useState(false)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  // Persist to the note whenever the graph settles.
  const commit = (ns: MindNode[], es: MindEdge[]) => {
    setNodes(ns)
    setEdges(es)
    setMindmap(note.id, { nodes: ns, edges: es })
  }

  const point = (e: React.PointerEvent | PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const startDrag = (e: React.PointerEvent, n: MindNode) => {
    if (connecting) return
    e.preventDefault()
    const p = point(e)
    drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current || !canvasRef.current) return
      const p = point(e)
      const r = canvasRef.current.getBoundingClientRect()
      const x = Math.max(60, Math.min(r.width - 60, p.x - drag.current.dx))
      const y = Math.max(34, Math.min(r.height - 34, p.y - drag.current.dy))
      setNodes((prev) =>
        prev.map((n) => (n.id === drag.current!.id ? { ...n, x, y } : n)),
      )
    }
    const up = () => {
      if (drag.current) {
        drag.current = null
        // Commit the final positions (read latest via functional setState).
        setNodes((prev) => {
          setEdges((es) => {
            setMindmap(note.id, { nodes: prev, edges: es })
            return es
          })
          return prev
        })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id])

  const addNode = () => {
    const r = canvasRef.current?.getBoundingClientRect()
    const cx = r ? r.width / 2 : 320
    const n: MindNode = {
      id: uid('mind'),
      text: 'New idea',
      x: cx + (Math.random() * 80 - 40),
      y: 90 + Math.random() * 60,
    }
    commit([...nodes, n], edges)
  }

  const editText = (id: string, text: string) =>
    commit(
      nodes.map((n) => (n.id === id ? { ...n, text } : n)),
      edges,
    )

  const removeNode = (id: string) =>
    commit(
      nodes.filter((n) => n.id !== id),
      edges.filter((e) => e.from !== id && e.to !== id),
    )

  // In connect mode, tapping two nodes links them.
  const tapNode = (id: string) => {
    if (!connecting) return
    if (!linkFrom) {
      setLinkFrom(id)
      return
    }
    if (linkFrom === id) {
      setLinkFrom(null)
      return
    }
    const exists = edges.some(
      (e) =>
        (e.from === linkFrom && e.to === id) ||
        (e.from === id && e.to === linkFrom),
    )
    if (!exists) {
      commit(nodes, [...edges, { id: uid('edge'), from: linkFrom, to: id }])
    }
    setLinkFrom(null)
  }

  const byId = (id: string) => nodes.find((n) => n.id === id)

  return (
    <div className="mindmap-wrap">
      <div className="mm-toolbar">
        <button className="mm-btn" onClick={addNode}>
          + Idea
        </button>
        <button
          className={`mm-btn ${connecting ? 'on' : ''}`}
          onClick={() => {
            setConnecting((c) => !c)
            setLinkFrom(null)
          }}
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </button>
        <span className="mm-hint">
          {connecting
            ? 'Tap two ideas to link them'
            : 'Drag to arrange · double-click text to rename'}
        </span>
      </div>

      <div
        ref={canvasRef}
        className={`mindmap ${connecting ? 'linking' : ''}`}
      >
        <svg className="mm-edges">
          {edges.map((e) => {
            const a = byId(e.from)
            const b = byId(e.to)
            if (!a || !b) return null
            return (
              <line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="mm-edge"
              />
            )
          })}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            className={`mm-node ${linkFrom === n.id ? 'picked' : ''}`}
            style={{ left: n.x, top: n.y }}
            onPointerDown={(e) => startDrag(e, n)}
            onClick={() => tapNode(n.id)}
          >
            <input
              className="mm-node-input"
              value={n.text}
              onChange={(e) => editText(n.id, e.target.value)}
              onPointerDown={(e) => !connecting && e.stopPropagation()}
              readOnly={connecting}
            />
            <button
              className="mm-node-del"
              title="Remove idea"
              aria-label="Remove idea"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                removeNode(n.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
