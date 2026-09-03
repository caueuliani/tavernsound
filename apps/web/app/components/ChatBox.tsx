'use client'

import { useEffect, useRef, useState } from 'react'

interface ChatMessage {
  playerName: string
  text: string
  timestamp: number
}

interface ChatBoxProps {
  socket: any
  myPlayerName: string
  initialMessages?: ChatMessage[]
}

export default function ChatBox({ socket, myPlayerName, initialMessages = [] }: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialMessages.length > 0) {
      setMessages(initialMessages)
    }
  }, [initialMessages])

  useEffect(() => {
    if (!socket) return

    const handleMessage = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg])
    }

    socket.on('chat-message-received', handleMessage)
    return () => socket.off('chat-message-received', handleMessage)
  }, [socket])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = () => {
    const text = input.trim()
    if (!text || !socket) return
    socket.emit('chat-message', { text })
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  return (
    <div style={{
      background: 'rgba(26, 15, 10, 0.6)',
      borderRadius: '12px',
      marginTop: '1rem',
      border: '1px solid #3d2b1f',
      display: 'flex',
      flexDirection: 'column',
      height: '220px',
    }}>
      <h3 style={{ margin: '0', padding: '0.75rem 1rem 0.5rem', color: '#ff9d00', fontSize: '1rem', letterSpacing: '0.05em', borderBottom: '1px solid #3d2b1f' }}>
        💬 CHAT
      </h3>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0.5rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}>
        {messages.length === 0 && (
          <p style={{ color: '#555', fontSize: '0.75rem', textAlign: 'center', margin: 'auto 0' }}>
            Nenhuma mensagem ainda.
          </p>
        )}
        {messages.map((msg, i) => {
          const isOwn = msg.playerName === myPlayerName
          return (
            <div key={i} style={{ fontSize: '0.8rem' }}>
              <span style={{ color: isOwn ? '#ff9d00' : '#d4af37', fontWeight: 'bold' }}>
                {msg.playerName}
              </span>
              <span style={{ color: '#555', fontSize: '0.7rem', marginLeft: '4px' }}>
                {formatTime(msg.timestamp)}
              </span>
              <span style={{ color: '#f4e4bc', marginLeft: '4px', wordBreak: 'break-word' }}>
                {msg.text}
              </span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem', borderTop: '1px solid #3d2b1f' }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={500}
          placeholder="Mensagem..."
          style={{
            flex: 1,
            padding: '0.4rem 0.6rem',
            background: '#1a0f0a',
            border: '1px solid #3d2b1f',
            borderRadius: '6px',
            color: '#f4e4bc',
            fontSize: '0.85rem',
            outline: 'none',
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim()}
          style={{
            padding: '0.4rem 0.8rem',
            background: input.trim() ? '#ff9d00' : '#3d2b1f',
            color: '#1a0f0a',
            border: 'none',
            borderRadius: '6px',
            cursor: input.trim() ? 'pointer' : 'not-allowed',
            fontWeight: 'bold',
            fontSize: '0.85rem',
            transition: 'background 0.2s',
          }}
        >
          ➤
        </button>
      </div>
    </div>
  )
}
