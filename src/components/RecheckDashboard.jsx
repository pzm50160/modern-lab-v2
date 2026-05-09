import React, { useState, useMemo, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, RefreshCw } from 'lucide-react'

const COLS = [
  { key: 'date',          label: '送檢日期', type: 'date',  width: '110px' },
  { key: 'sender',        label: '送檢單位', type: 'text',  width: '100px' },
  { key: 'vendor',        label: '廠商',     type: 'text',  width: '100px' },
  { key: 'specimen_id',   label: '檢驗編號', type: 'text',  width: '90px'  },
  { key: 'patient_name',  label: '姓名',     type: 'text',  width: '80px'  },
  { key: 'test_item',     label: '項目',     type: 'text',  width: '80px'  },
  { key: 'initial_value', label: '初驗值',   type: 'text',  width: '80px'  },
  { key: 'recheck_value', label: '複驗值',   type: 'text',  width: '80px'  },
  { key: 'note',          label: '備註',     type: 'text',  width: '140px' },
]

const SHARED_KEYS = ['date', 'sender', 'vendor'] // 新增列時繼承這些欄位

function emptyRow(inherit = {}) {
  return {
    date: new Date().toISOString().slice(0, 10),
    sender: '', vendor: '', specimen_id: '',
    patient_name: '', test_item: '',
    initial_value: '', recheck_value: '', note: '',
    ...inherit,
  }
}

export default function RecheckDashboard({ currentUser, isAdmin }) {
  const [records, setRecords]     = useState([])
  const [tab, setTab]             = useState('pending')
  const [loading, setLoading]     = useState(true)
  const [newRows, setNewRows]     = useState([emptyRow()])
  const [editingId, setEditingId] = useState(null)
  const [editRow, setEditRow]     = useState({})
  const inputRefs = useRef({}) // { `${rowIdx}-${colKey}`: el }

  useEffect(() => { fetchRecords() }, [])

  async function fetchRecords() {
    setLoading(true)
    const { data, error } = await supabase
      .from('recheck_records')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    if (!error) setRecords(data || [])
    setLoading(false)
  }

  function updateNewRow(rowIdx, key, value) {
    setNewRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [key]: value } : r))
  }

  function addInputRow(afterIdx) {
    const current = newRows[afterIdx]
    const inherited = Object.fromEntries(SHARED_KEYS.map(k => [k, current[k]]))
    const next = [...newRows.slice(0, afterIdx + 1), emptyRow(inherited), ...newRows.slice(afterIdx + 1)]
    setNewRows(next)
    // 下一個 tick 聚焦到新列的第一個文字欄
    setTimeout(() => {
      const firstTextCol = COLS.find(c => c.type === 'text')
      const el = inputRefs.current[`${afterIdx + 1}-${firstTextCol?.key}`]
      if (el) el.focus()
    }, 30)
  }

  function removeInputRow(rowIdx) {
    if (newRows.length === 1) return
    setNewRows(prev => prev.filter((_, i) => i !== rowIdx))
  }

  function handleInputKeyDown(rowIdx, colKey, e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (colKey === 'test_item') {
        // 在項目欄按 Enter → 新增一列
        addInputRow(rowIdx)
      } else {
        // 其他欄按 Enter → 移到下一欄
        const colIdx = COLS.findIndex(c => c.key === colKey)
        const nextCol = COLS[colIdx + 1]
        if (nextCol) {
          const el = inputRefs.current[`${rowIdx}-${nextCol.key}`]
          if (el) el.focus()
        }
      }
    }
    if (e.key === 'Backspace' && e.target.value === '' && colKey === COLS[0].key && newRows.length > 1) {
      removeInputRow(rowIdx)
    }
  }

  async function submitAllRows() {
    const valid = newRows.filter(r => r.specimen_id.trim() || r.patient_name.trim())
    if (!valid.length) return
    const payload = valid.map(r => ({ ...r, completed: false, creator_name: currentUser }))
    const { error } = await supabase.from('recheck_records').insert(payload)
    if (error) { alert(`新增失敗：${error.message}`); return }
    setNewRows([emptyRow()])
    await fetchRecords()
  }

  async function saveEdit(id) {
    const { error } = await supabase
      .from('recheck_records')
      .update({ ...editRow, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { alert(`儲存失敗：${error.message}`); return }
    setRecords(prev => prev.map(r => r.id === id ? { ...r, ...editRow } : r))
    setEditingId(null)
  }

  async function toggleComplete(record) {
    const next = !record.completed
    const { error } = await supabase
      .from('recheck_records')
      .update({ completed: next, updated_at: new Date().toISOString() })
      .eq('id', record.id)
    if (error) { alert(`更新失敗：${error.message}`); return }
    setRecords(prev => prev.map(r => r.id === record.id ? { ...r, completed: next } : r))
  }

  async function deleteRecord(record) {
    if (!window.confirm('確定要刪除此筆複驗紀錄嗎？')) return
    const { error } = await supabase.from('recheck_records').delete().eq('id', record.id)
    if (error) { alert(`刪除失敗：${error.message}`); return }
    setRecords(prev => prev.filter(r => r.id !== record.id))
  }

  const filtered = useMemo(() =>
    records.filter(r => tab === 'pending' ? !r.completed : r.completed),
    [records, tab]
  )

  const pendingCount = records.filter(r => !r.completed).length

  const cellStyle = {
    padding: '6px 8px',
    borderRight: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    fontSize: '13px',
  }
  const inputStyle = {
    width: '100%',
    border: 'none',
    background: 'transparent',
    fontSize: '13px',
    outline: 'none',
    padding: '0',
  }

  return (
    <>
      <section className="work-header">
        <div>
          <p className="eyebrow">複驗追蹤</p>
          <h1>待處理 {pendingCount} 件</h1>
        </div>
        <div className="header-actions">
          <button className="icon-text-button ghost" onClick={fetchRecords} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            重新整理
          </button>
        </div>
      </section>

      <section className="tool-row">
        <div className="tabs">
          <button className={tab === 'pending' ? 'tab active' : 'tab'} onClick={() => setTab('pending')}>
            待處理
            {pendingCount > 0 && (
              <span style={{ background: 'var(--red)', color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '11px', marginLeft: '4px' }}>
                {pendingCount}
              </span>
            )}
          </button>
          <button className={tab === 'done' ? 'tab active' : 'tab'} onClick={() => setTab('done')}>
            已處理
          </button>
        </div>
      </section>

      <div style={{ overflowX: 'auto', marginTop: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: 'var(--surface-soft)', borderBottom: '2px solid var(--border)' }}>
              {COLS.map(col => (
                <th key={col.key} style={{ ...cellStyle, fontWeight: '600', width: col.width, minWidth: col.width, color: 'var(--text-muted)', fontSize: '12px', letterSpacing: '0.03em' }}>
                  {col.label}
                </th>
              ))}
              <th style={{ ...cellStyle, textAlign: 'center', width: '72px', fontWeight: '600', color: 'var(--text-muted)', fontSize: '12px' }}>處理完成</th>
              <th style={{ width: '36px' }} />
            </tr>
          </thead>
          <tbody>
            {/* 輸入列（多列） */}
            {tab === 'pending' && newRows.map((row, rowIdx) => (
              <tr key={rowIdx} style={{ background: '#f0f9ff', borderBottom: '1px solid var(--border)' }}>
                {COLS.map(col => (
                  <td key={col.key} style={{ ...cellStyle, padding: '3px 5px' }}>
                    <input
                      ref={el => { inputRefs.current[`${rowIdx}-${col.key}`] = el }}
                      type={col.type}
                      value={row[col.key]}
                      onChange={e => updateNewRow(rowIdx, col.key, e.target.value)}
                      onKeyDown={e => handleInputKeyDown(rowIdx, col.key, e)}
                      style={{ ...inputStyle, background: 'white', border: '1px solid var(--border)', borderRadius: '4px', padding: '3px 6px' }}
                      placeholder={col.label}
                    />
                  </td>
                ))}
                {/* 最後一列顯示送出按鈕，其餘顯示刪除列按鈕 */}
                <td style={{ ...cellStyle, textAlign: 'center', padding: '3px 5px' }}>
                  {rowIdx === newRows.length - 1 ? (
                    <button
                      className="icon-text-button primary"
                      onClick={submitAllRows}
                      style={{ padding: '3px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                    >
                      <Plus size={13} />
                      新增
                    </button>
                  ) : (
                    <button
                      className="icon-button mini"
                      onClick={() => removeInputRow(rowIdx)}
                      title="移除此列"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      ✕
                    </button>
                  )}
                </td>
                <td style={{ padding: '3px' }}>
                  {rowIdx === newRows.length - 1 && newRows.length === 1 ? null : (
                    <button
                      className="icon-button mini"
                      onClick={() => addInputRow(rowIdx)}
                      title="在此列下方新增一列"
                      style={{ color: 'var(--blue)' }}
                    >
                      +
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {/* 已儲存的資料列 */}
            {filtered.map(record => (
              <tr
                key={record.id}
                style={{ borderBottom: '1px solid var(--border)', background: record.completed ? 'var(--surface-soft)' : 'white', opacity: record.completed ? 0.65 : 1 }}
                onDoubleClick={() => { setEditingId(record.id); setEditRow({ ...record }) }}
              >
                {COLS.map(col => (
                  <td key={col.key} style={{ ...cellStyle }}>
                    {editingId === record.id ? (
                      <input
                        type={col.type}
                        value={editRow[col.key] || ''}
                        onChange={e => setEditRow(prev => ({ ...prev, [col.key]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(record.id); if (e.key === 'Escape') setEditingId(null) }}
                        style={{ ...inputStyle, borderBottom: '1px solid var(--blue)' }}
                        autoFocus={col.key === 'date'}
                      />
                    ) : (
                      <span style={{ textDecoration: record.completed ? 'line-through' : 'none' }}>
                        {record[col.key] || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </span>
                    )}
                  </td>
                ))}
                <td style={{ ...cellStyle, textAlign: 'center' }}>
                  {editingId === record.id ? (
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                      <button className="icon-text-button primary" style={{ padding: '2px 8px', fontSize: '12px' }} onClick={() => saveEdit(record.id)}>儲存</button>
                      <button className="icon-text-button ghost" style={{ padding: '2px 8px', fontSize: '12px' }} onClick={() => setEditingId(null)}>取消</button>
                    </div>
                  ) : (
                    <input
                      type="checkbox"
                      checked={record.completed}
                      onChange={() => toggleComplete(record)}
                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#16a34a' }}
                    />
                  )}
                </td>
                <td style={{ padding: '4px', textAlign: 'center' }}>
                  {(isAdmin || record.creator_name === currentUser) && (
                    <button className="icon-button mini" onClick={() => deleteRecord(record)} title="刪除" style={{ color: 'var(--red)' }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 2} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  {tab === 'pending' ? '目前沒有待處理的複驗紀錄' : '尚無已處理紀錄'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-muted)' }}>
        提示：在「項目」欄按 Enter 可快速新增一列（自動帶入日期、送檢單位、廠商）；雙擊已有資料可編輯
      </p>
    </>
  )
}
