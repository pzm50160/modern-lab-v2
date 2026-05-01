import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { AlertCircle, Camera, Clock, Loader2, Plus, Send, Tag, Trash2, X } from 'lucide-react'

const FALLBACK_GENERAL_CATEGORIES = ['交接', '備忘', '待辦', '特殊項目']
const FALLBACK_SPECIMEN_CATEGORIES = ['收檢', '耗材', '其他']
const CHECKLIST_TEMPLATE_KEY = 'modernLabChecklistTemplates'

function createChecklistItem(text, index) {
  return {
    id: `${text}-${index}`,
    text,
    done: false,
  }
}

export default function TaskModal({
  isOpen,
  onClose,
  creatorId,
  creatorName,
  defaultCategory = '待辦',
  onTaskAdded,
}) {
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState(FALLBACK_GENERAL_CATEGORIES)
  const [formData, setFormData] = useState({
    content: '',
    category_name: defaultCategory,
    type: '工作交接',
    priority: false,
    deadline: '',
    image_urls: [],
    checklist: [],
  })
  const [checkItem, setCheckItem] = useState('')
  const [savedItems, setSavedItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CHECKLIST_TEMPLATE_KEY) || '[]')
    } catch {
      return []
    }
  })

  async function fetchCategories() {
    const fallback = formData.type === '檢體收送' ? FALLBACK_SPECIMEN_CATEGORIES : FALLBACK_GENERAL_CATEGORIES
    const { data, error } = await supabase.from('categories').select('*').order('name')
    if (error || !data?.length) {
      setCategories(fallback)
      return
    }

    const currentTypeCategories = data
      .filter((category) => (category.type || '工作交接') === formData.type)
      .map((category) => category.name)

    setCategories(currentTypeCategories.length ? currentTypeCategories : fallback)
  }

  useEffect(() => {
    if (!isOpen) return
    fetchCategories()
  }, [isOpen, formData.type])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!formData.content.trim()) return

    setLoading(true)
    const deadline = formData.deadline ? new Date(formData.deadline).toISOString() : null
    const { error } = await supabase.from('tasks').insert([
      {
        content: formData.content.trim(),
        category_name: formData.category_name,
        type: formData.type,
        priority: formData.priority,
        deadline,
        image_urls: formData.image_urls,
        checklist: formData.checklist,
        workflow: 'general',
        creator_id: creatorId,
        creator_name: creatorName,
        status: 0,
        history: [
          {
            action: '建立事項',
            time: new Date().toISOString(),
            user: creatorName,
          },
        ],
      },
    ])

    if (error) {
      alert(`新增失敗：${error.message}`)
    } else {
      setFormData({
        content: '',
        category_name: defaultCategory,
        priority: false,
        deadline: '',
        image_urls: [],
        checklist: [],
      })
      setCheckItem('')
      await onTaskAdded()
      onClose()
    }

    setLoading(false)
  }

  if (!isOpen) return null

  function addChecklistItem() {
    const text = checkItem.trim()
    if (!text) return
    const nextSavedItems = [text, ...savedItems.filter((item) => item !== text)].slice(0, 12)
    setSavedItems(nextSavedItems)
    localStorage.setItem(CHECKLIST_TEMPLATE_KEY, JSON.stringify(nextSavedItems))
    setFormData({
      ...formData,
      checklist: [
        ...formData.checklist,
        createChecklistItem(text, formData.checklist.length),
      ],
    })
    setCheckItem('')
  }

  function addSavedChecklistItem(text) {
    setFormData({
      ...formData,
      checklist: [
        ...formData.checklist,
        createChecklistItem(text, formData.checklist.length),
      ],
    })
  }

  function removeChecklistItem(id) {
    setFormData({
      ...formData,
      checklist: formData.checklist.filter((item) => item.id !== id),
    })
  }

  function removeSavedChecklistItem(text) {
    const nextSavedItems = savedItems.filter(item => item !== text)
    setSavedItems(nextSavedItems)
    localStorage.setItem(CHECKLIST_TEMPLATE_KEY, JSON.stringify(nextSavedItems))
  }

  // === 逐行編輯器邏輯 ===
  // contentLines: [{ text: string, checked: boolean }]
  const [contentLines, setContentLines] = useState([{ text: '', checked: false }])

  const [isChecklistMode, setIsChecklistMode] = useState(false)

  // 將 contentLines 同步到 formData.content（用 markdown 格式儲存）
  function syncContentFromLines(lines) {
    if (!isChecklistMode) return
    const content = lines
      .map((line) => {
        const text = line.text.trim()
        if (!text) return ''
        if (line.checked) return `- [ ] ${text}`
        return text
      })
      .filter(Boolean)
      .join('\n')
    setFormData((prev) => ({ ...prev, content }))
  }

  function handleLineChange(index, value) {
    const next = [...contentLines]
    next[index] = { ...next[index], text: value }
    setContentLines(next)
    syncContentFromLines(next)
  }

  // 當切換模式時，如果是從文字切換到勾選，嘗試將每一行轉換成勾選項目
  function toggleMode(enabled) {
    setIsChecklistMode(enabled)
    if (enabled) {
      const lines = formData.content.split('\n').filter(l => l.trim() !== '')
      if (lines.length > 0) {
        const nextLines = lines.map(text => {
          const isCheck = /^-\s*\[[xX ]?\]\s*/.test(text)
          return { text: text.replace(/^-\s*\[[xX ]?\]\s*/, ''), checked: isCheck }
        })
        setContentLines(nextLines)
        // 立即同步回 markdown 格式
        const content = nextLines.map(line => line.checked ? `- [ ] ${line.text}` : line.text).join('\n')
        setFormData(prev => ({ ...prev, content }))
      }
    } else {
      // 如果從勾選切換回文字，去掉 markdown 前綴
      const plainContent = contentLines.map(l => l.text).filter(Boolean).join('\n')
      setFormData(prev => ({ ...prev, content: plainContent }))
    }
  }

  function handleLineCheck(index) {
    const next = [...contentLines]
    next[index] = { ...next[index], checked: !next[index].checked }
    setContentLines(next)
    syncContentFromLines(next)
  }

  function handleLineKeyDown(index, event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const next = [...contentLines]
      next.splice(index + 1, 0, { text: '', checked: false })
      setContentLines(next)
      syncContentFromLines(next)
      // 聚焦到新行
      setTimeout(() => {
        const el = document.getElementById(`content-line-${index + 1}`)
        if (el) el.focus()
      }, 0)
    }
    if (event.key === 'Backspace' && contentLines[index].text === '' && contentLines.length > 1) {
      event.preventDefault()
      const next = [...contentLines]
      next.splice(index, 1)
      setContentLines(next)
      syncContentFromLines(next)
      setTimeout(() => {
        const focusIdx = Math.max(0, index - 1)
        const el = document.getElementById(`content-line-${focusIdx}`)
        if (el) el.focus()
      }, 0)
    }
  }

  function removeLine(index) {
    if (contentLines.length <= 1) {
      const next = [{ text: '', checked: false }]
      setContentLines(next)
      syncContentFromLines(next)
      return
    }
    const next = [...contentLines]
    next.splice(index, 1)
    setContentLines(next)
    syncContentFromLines(next)
  }

  function autoResize(e) {
    e.target.style.height = 'auto'
    e.target.style.height = (e.target.scrollHeight) + 'px'
  }

  function handleImages(event) {
    const remaining = 9 - formData.image_urls.length
    if (remaining <= 0) {
      alert('最多只能上傳 9 張圖片。')
      return
    }
    const files = Array.from(event.target.files || []).slice(0, remaining)
    if (!files.length) return

    Promise.all(files.map((file) => new Promise((resolve, reject) => {
      if (file.size > 1024 * 1024) {
        reject(new Error(`${file.name} 超過 1MB，請先壓縮後再上傳。`))
        return
      }

      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error(`${file.name} 讀取失敗`))
      reader.readAsDataURL(file)
    })))
      .then((images) => {
        setFormData({
          ...formData,
          image_urls: [...formData.image_urls, ...images].slice(0, 9),
        })
      })
      .catch((error) => alert(error.message))
      .finally(() => {
        event.target.value = ''
      })
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-card" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">新增工作事項</p>
            <h2>建立交接、備忘或待辦</h2>
          </div>
          <button className="icon-button" type="button" title="關閉" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="field" style={{ marginBottom: '20px' }}>
          <span>事項類型</span>
          <div className="type-selector" style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className={`type-button ${formData.type === '工作交接' ? 'active' : ''}`}
              onClick={() => setFormData({ ...formData, type: '工作交接' })}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: formData.type === '工作交接' ? 'var(--primary-soft)' : 'transparent', color: formData.type === '工作交接' ? 'var(--primary)' : 'inherit', fontWeight: formData.type === '工作交接' ? '600' : '400' }}
            >
              工作交接
            </button>
            <button
              type="button"
              className={`type-button ${formData.type === '檢體收送' ? 'active' : ''}`}
              onClick={() => setFormData({ ...formData, type: '檢體收送' })}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: formData.type === '檢體收送' ? 'var(--primary-soft)' : 'transparent', color: formData.type === '檢體收送' ? 'var(--primary)' : 'inherit', fontWeight: formData.type === '檢體收送' ? '600' : '400' }}
            >
              檢體收送
            </button>
          </div>
        </div>

        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>內容</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--blue)', fontWeight: '600' }}>
              <input 
                type="checkbox" 
                checked={isChecklistMode} 
                onChange={(e) => toggleMode(e.target.checked)} 
              />
              開啟逐行勾選功能
            </label>
          </div>

          {isChecklistMode ? (
            <div className="line-editor">
              {contentLines.map((line, index) => (
                <div key={index} className="line-editor-row">
                  <input
                    type="checkbox"
                    className="line-editor-checkbox"
                    checked={line.checked}
                    onChange={() => handleLineCheck(index)}
                  />
                  <textarea
                    id={`content-line-${index}`}
                    className="line-editor-textarea"
                    value={line.text}
                    rows={1}
                    onChange={(e) => handleLineChange(index, e.target.value)}
                    onKeyDown={(e) => handleLineKeyDown(index, e)}
                    onInput={autoResize}
                    placeholder={index === 0 ? '寫下內容... (Enter 換行, Shift+Enter 同行內換行)' : ''}
                    autoComplete="off"
                  />
                  {contentLines.length > 1 && (
                    <button type="button" className="line-editor-remove" onClick={() => removeLine(index)} title="移除此行">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <textarea
              className="line-editor-textarea"
              style={{ minHeight: '120px' }}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="輸入事項內容..."
            />
          )}
        </div>

        <section className="composer-section">
          <div className="composer-title">
            <Camera size={17} />
            圖片 (最多 9 張)
          </div>
          <label className="image-picker">
            <input type="file" accept="image/*" multiple onChange={handleImages} />
            <Camera size={18} />
            加入圖片
          </label>
          {formData.image_urls.length > 0 && (
            <div className="image-preview-grid">
              {formData.image_urls.map((image, index) => (
                <div className="image-preview" key={image}>
                  <img src={image} alt={`附件 ${index + 1}`} />
                  <button
                    type="button"
                    className="image-remove"
                    onClick={() => setFormData({
                      ...formData,
                      image_urls: formData.image_urls.filter((_, imageIndex) => imageIndex !== index),
                    })}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="composer-section">
          <div className="composer-title">
            <Plus size={17} />
            自行輸入勾選項目
          </div>
          <div className="checklist-composer">
            <input
              type="text"
              value={checkItem}
              onChange={(event) => setCheckItem(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addChecklistItem()
                }
              }}
              placeholder="例如：確認交班、補拍照片、回報主管"
            />
            <button type="button" className="icon-button" onClick={addChecklistItem} title="新增項目">
              <Plus size={18} />
            </button>
          </div>
          {savedItems.length > 0 && (
            <div className="quick-check-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {savedItems.map((item) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-soft)', border: '1px solid var(--border)', borderRadius: '16px', paddingLeft: '12px', paddingRight: '4px', gap: '4px' }}>
                  <button type="button" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text)' }} onClick={() => addSavedChecklistItem(item)}>
                    {item}
                  </button>
                  <button 
                    type="button" 
                    className="icon-button" 
                    style={{ width: '24px', height: '24px', minHeight: '24px', color: 'var(--red)', background: 'var(--red-soft)', borderRadius: '50%', padding: 0 }} 
                    onClick={() => removeSavedChecklistItem(item)} 
                    title="刪除快捷鍵"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {formData.checklist.length > 0 && (
            <div className="checklist-preview">
              {formData.checklist.map((item) => (
                <div className="checklist-preview-item" key={item.id}>
                  <span>{item.text}</span>
                  <button type="button" className="icon-button mini" onClick={() => removeChecklistItem(item.id)} title="移除">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="form-grid">
          <label className="field">
            <span><Tag size={14} /> 分類</span>
            <select
              value={formData.category_name}
              onChange={(event) => setFormData({ ...formData, category_name: event.target.value })}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span><Clock size={14} /> 截止時間</span>
            <input
              type="datetime-local"
              value={formData.deadline}
              onChange={(event) => setFormData({ ...formData, deadline: event.target.value })}
            />
          </label>
        </div>

        <label className={formData.priority ? 'priority-toggle active' : 'priority-toggle'}>
          <span>
            <AlertCircle size={20} />
            <strong>優先處理</strong>
          </span>
          <input
            type="checkbox"
            checked={formData.priority}
            onChange={(event) => setFormData({ ...formData, priority: event.target.checked })}
          />
        </label>

        <button className="icon-text-button primary full" type="submit" disabled={loading}>
          {loading ? <Loader2 className="spin" size={19} /> : <Send size={19} />}
          建立事項
        </button>
      </form>
    </div>
  )
}
