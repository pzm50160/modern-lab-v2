import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { compressImage } from '../lib/imageUtils'
import { ContentEditableEditor } from '../lib/richText'
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
  dynamicHandoffCategories = FALLBACK_GENERAL_CATEGORIES,
  editTask = null,
}) {
  const isEditMode = Boolean(editTask)
  const [loading, setLoading] = useState(false)
  const [categories, setCategories] = useState(dynamicHandoffCategories)
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
    if (formData.type === '工作交接') {
      setCategories(dynamicHandoffCategories.length ? dynamicHandoffCategories : FALLBACK_GENERAL_CATEGORIES)
      return
    }

    const fallback = FALLBACK_SPECIMEN_CATEGORIES
    const { data, error } = await supabase.from('categories').select('*').order('name')
    if (error || !data?.length) {
      setCategories(fallback)
      return
    }

    const currentTypeCategories = data
      .filter((category) => category.type === '檢體收送')
      .map((category) => category.name)

    setCategories(currentTypeCategories.length ? currentTypeCategories : fallback)
  }

  useEffect(() => {
    if (!isOpen) return
    fetchCategories()
  }, [isOpen, formData.type, dynamicHandoffCategories])

  // 編輯模式：預填表單
  useEffect(() => {
    if (!isOpen) return
    if (editTask) {
      const dl = editTask.deadline
        ? new Date(editTask.deadline).toISOString().slice(0, 16)
        : ''
      setFormData({
        content: editTask.content || '',
        category_name: editTask.category_name || defaultCategory,
        type: editTask.type || '工作交接',
        priority: editTask.priority || false,
        deadline: dl,
        image_urls: Array.isArray(editTask.image_urls) ? editTask.image_urls : [],
        checklist: Array.isArray(editTask.checklist) ? editTask.checklist : [],
      })
      // 如果有逐行勾選內容，自動切換到勾選模式
      const lines = (editTask.content || '').split('\n')
      // 只要有任何一行符合勾選格式（[ ] 或 [x]），就開啟勾選模式
      const hasChecks = lines.some(l => /^-\s*\[[xX ]\]/.test(l))
      if (hasChecks) {
        setIsChecklistMode(true)
        const nextLines = lines.filter(l => l.trim()).map(text => {
          const isCheck = /^-\s*\[[xX ]\]\s*/.test(text)
          // 移除 markdown 語法以及結尾的人名標記
          const cleanText = text.replace(/^-\s*\[[xX ]\]\s*/, '').replace(/\s*\(@.*?\)\s*$/, '')
          return { text: cleanText, checked: isCheck }
        })
        setContentLines(nextLines.length > 0 ? nextLines : [{ text: '', checked: false }])
      } else {
        setIsChecklistMode(false)
        setContentLines([{ text: '', checked: false }])
      }
    }
  }, [isOpen, editTask])

  async function handleSubmit(event) {
    event.preventDefault()
    
    // 確保提交前內容已同步
    let finalContent = formData.content.trim()
    if (isChecklistMode) {
      finalContent = contentLines
        .map((line) => {
          const text = line.text.trim()
          if (!text) return ''
          return line.checked ? `- [ ] ${text}` : text
        })
        .filter(Boolean)
        .join('\n')
    }

    if (!finalContent) return

    setLoading(true)
    const deadline = formData.deadline ? new Date(formData.deadline).toISOString() : null

    if (isEditMode) {
      const { error } = await supabase
        .from('tasks')
        .update({
          content: finalContent,
          category_name: formData.category_name,
          type: formData.type,
          priority: formData.priority,
          deadline,
          image_urls: formData.image_urls,
          checklist: formData.checklist,
          updated_at: new Date().toISOString()
        })
        .eq('id', editTask.id)

      if (error) {
        alert(`更新失敗：${error.message}`)
      } else {
        await onTaskAdded()
        onClose()
      }
    } else {
      const { error } = await supabase.from('tasks').insert([
        {
          content: finalContent,
          category_name: formData.category_name,
          type: formData.type,
          priority: formData.priority,
          deadline,
          image_urls: formData.image_urls,
          checklist: formData.checklist,
          workflow: formData.type === '檢體收送' ? 'specimen' : 'general',
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
          type: '工作交接',
          priority: false,
          deadline: '',
          image_urls: [],
          checklist: [],
        })
        setCheckItem('')
        await onTaskAdded()
        onClose()
      }
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
  const savedHtmlRef = useRef(null) // 切換勾選模式時保存原始 HTML

  // 將 contentLines 同步到 formData.content（用 markdown 格式儲存）
  function syncContentFromLines(lines) {
    if (!isChecklistMode) return
    const content = lines
      .map((line) => {
        // 取得純文字版本判斷是否空白
        const plain = (line.text || '').replace(/<[^>]+>/g, '').trim()
        if (!plain) return ''
        if (line.checked) return `- [ ] ${plain}`
        return plain
      })
      .filter(Boolean)
      .join('\n')
    setFormData((prev) => ({ ...prev, content }))
  }

  function handleLineChange(index, htmlValue) {
    const next = [...contentLines]
    next[index] = { ...next[index], text: htmlValue }
    setContentLines(next)
    syncContentFromLines(next)
  }

  // 將 HTML 按行拆分，但保留每行的 inline 格式標籤
  function splitHtmlToLines(html) {
    if (!html) return []
    // 先把 <div> 和 <br> 當作換行分隔符
    let processed = html
    processed = processed.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '')
    processed = processed.replace(/<br\s*\/?>/gi, '\n')
    // 拆行
    const lines = processed.split('\n').filter(l => {
      const plain = l.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      return plain.length > 0
    })
    return lines
  }

  // 當切換模式時
  function toggleMode(enabled) {
    setIsChecklistMode(enabled)
    if (enabled) {
      // 保存原始 HTML（保留顏色等格式）
      savedHtmlRef.current = formData.content
      const htmlLines = splitHtmlToLines(formData.content)
      if (htmlLines.length > 0) {
        const nextLines = htmlLines.map(lineHtml => {
          const plainText = lineHtml.replace(/<[^>]+>/g, '')
          const isCheck = /^-\s*\[[xX ]?\]\s*/.test(plainText)
          // 移除 markdown 前綴（從純文字版本找到前綴位置，然後從 HTML 中去掉對應文字）
          const cleanHtml = isCheck 
            ? lineHtml.replace(/^(-\s*\[[xX ]?\]\s*)/, '').replace(/^(<[^>]+>)*-\s*\[[xX ]?\]\s*/, '$1')
            : lineHtml
          return { text: cleanHtml, checked: isCheck }
        })
        setContentLines(nextLines)
      } else {
        setContentLines([{ text: '', checked: false }])
      }
    } else {
      // 切回文字模式時，還原原始 HTML（保留顏色）
      const htmlToRestore = savedHtmlRef.current
      savedHtmlRef.current = null
      if (htmlToRestore) {
        setFormData(prev => ({ ...prev, content: htmlToRestore }))
      } else {
        const plainContent = contentLines.map(l => (l.text || '').replace(/<[^>]+>/g, '')).filter(Boolean).join('\n')
        setFormData(prev => ({ ...prev, content: plainContent }))
      }
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
      setTimeout(() => {
        const el = document.getElementById(`content-line-${index + 1}`)
        if (el) el.focus()
      }, 50)
    } else if (event.key === 'Backspace') {
      const plain = (contentLines[index].text || '').replace(/<[^>]+>/g, '').trim()
      if (plain === '' && contentLines.length > 1) {
        event.preventDefault()
        const next = contentLines.filter((_, i) => i !== index)
        setContentLines(next)
        syncContentFromLines(next)
        setTimeout(() => {
          const focusIdx = Math.max(0, index - 1)
          const el = document.getElementById(`content-line-${focusIdx}`)
          if (el) el.focus()
        }, 50)
      }
    }
  }

  function removeLine(index) {
    if (contentLines.length <= 1) return
    const next = contentLines.filter((_, i) => i !== index)
    setContentLines(next)
    syncContentFromLines(next)
  }

  function autoResize(e) {
    const el = e.target || e.currentTarget
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }



  async function handleImages(event) {
    const remaining = 9 - formData.image_urls.length
    if (remaining <= 0) {
      alert('最多只能上傳 9 張圖片。')
      return
    }
    const files = Array.from(event.target.files || []).slice(0, remaining)
    if (!files.length) return

    setLoading(true)
    try {
      const compressedImages = await Promise.all(files.map((file) => compressImage(file)))
      setFormData({
        ...formData,
        image_urls: [...formData.image_urls, ...compressedImages].slice(0, 9),
      })
    } catch (error) {
      alert(`處理圖片時發生錯誤: ${error.message}`)
    } finally {
      setLoading(false)
      event.target.value = ''
    }
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

        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>內容</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--blue)', fontWeight: '600' }}>
              <input 
                type="checkbox" 
                checked={isChecklistMode} 
                onChange={(e) => toggleMode(e.target.checked)}
                style={{ width: '15px', height: '15px', minHeight: 'auto' }}
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
                  <div
                    id={`content-line-${index}`}
                    className="line-editor-textarea"
                    contentEditable={true}
                    dangerouslySetInnerHTML={{ __html: line.text || '' }}
                    onInput={(e) => handleLineChange(index, e.currentTarget.innerHTML)}
                    onKeyDown={(e) => handleLineKeyDown(index, e)}
                    data-placeholder={index === 0 ? '寫下內容... (Enter 換行)' : ''}
                    style={{
                      flex: 1,
                      minHeight: '28px',
                      padding: '6px 8px',
                      outline: 'none',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      color: '#000',
                      fontWeight: 'normal',
                    }}
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
            <ContentEditableEditor
              value={formData.content}
              onChange={(val) => setFormData({ ...formData, content: val })}
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
