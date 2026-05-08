import React, { useRef, useEffect, useCallback } from 'react'

export const RICH_COLORS = [
  { name: '紅', value: '#ef4444' },
  { name: '藍', value: '#3b82f6' },
  { name: '綠', value: '#16a34a' },
  { name: '橘', value: '#f97316' },
  { name: '紫', value: '#8b5cf6' },
]

/**
 * 舊版相容處理函式：如果內容有舊版 Markdown 標記，轉換為 HTML
 */
export function migrateToHtml(text) {
  if (!text || typeof text !== 'string') return text
  let html = text.replace(/\n/g, '<br>')
  html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
  html = html.replace(/\{color:(#?[a-zA-Z0-9]+)\}(.*?)\{\/color\}/g, '<span style="color: $1">$2</span>')
  return html
}

/**
 * WYSIWYG 編輯器工具列
 */
function RichToolbar() {
  const handleCommand = (e, command, value = null) => {
    e.preventDefault()
    document.execCommand(command, false, value)
  }

  return (
    <div className="rich-toolbar">
      <button
        type="button"
        className="rich-toolbar-btn"
        title="粗體 (選取文字後點擊)"
        onMouseDown={(e) => handleCommand(e, 'bold')}
      >
        <strong>B</strong>
      </button>
      <div className="rich-toolbar-divider" />
      {RICH_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className="rich-toolbar-btn"
          title={`${c.name}色 (選取文字後點擊)`}
          onMouseDown={(e) => handleCommand(e, 'foreColor', c.value)}
          style={{ padding: '0 4px' }}
        >
          <span className="color-dot" style={{ background: c.value }} />
        </button>
      ))}
      <div className="rich-toolbar-divider" />
      <button
        type="button"
        className="rich-toolbar-btn"
        title="清除格式"
        onMouseDown={(e) => handleCommand(e, 'removeFormat')}
        style={{ fontSize: '11px', fontWeight: 'normal' }}
      >
        清除格式
      </button>
    </div>
  )
}

/**
 * 所見即所得 (WYSIWYG) 編輯器元件
 * 
 * 核心策略：
 * - 使用 lastExternalValue ref 追蹤「上一次從外部傳入的值」
 * - 使用 isInternalChange ref 追蹤「是否為使用者正在輸入」
 * - 只有外部值「真的不同」且「不是我自己觸發的 onChange」時才重設 innerHTML
 */
export function ContentEditableEditor({ value, onChange, placeholder, style, className }) {
  const editorRef = useRef(null)
  const lastExternalValue = useRef(value || '')
  const isInternalChange = useRef(false)

  // 初始掛載：設定 innerHTML
  useEffect(() => {
    if (editorRef.current) {
      const html = migrateToHtml(value) || ''
      editorRef.current.innerHTML = html
      lastExternalValue.current = value || ''
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 外部 value 變更時（例如從勾選模式切回來還原 HTML），同步到 DOM
  useEffect(() => {
    // 如果是自己輸入觸發的 onChange，不要重設 innerHTML（否則游標會跳）
    if (isInternalChange.current) {
      isInternalChange.current = false
      return
    }
    // 外部值確實改變了
    if (editorRef.current && value !== lastExternalValue.current) {
      const html = migrateToHtml(value) || ''
      editorRef.current.innerHTML = html
      lastExternalValue.current = value || ''
    }
  }, [value])

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      const newHtml = editorRef.current.innerHTML
      isInternalChange.current = true
      lastExternalValue.current = newHtml
      onChange(newHtml)
    }
  }, [onChange])

  return (
    <div className="content-editable-wrapper" style={{ ...style, display: 'flex', flexDirection: 'column' }}>
      <RichToolbar />
      <div
        ref={editorRef}
        className={`content-editable-area ${className || ''}`}
        contentEditable={true}
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder}
        style={{
          flex: 1,
          minHeight: '120px',
          padding: '12px',
          background: '#fff',
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          outline: 'none',
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#000',
          fontWeight: 'normal',
          fontSize: '15px',
        }}
      />
    </div>
  )
}
