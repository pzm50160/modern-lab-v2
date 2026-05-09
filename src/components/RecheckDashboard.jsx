import React, { useState, useMemo, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Trash2, RefreshCw } from 'lucide-react'

const COLS = [
  { key: 'date',          label: '送檢日期', type: 'date', w: 118 },
  { key: 'sender',        label: '送檢單位', type: 'text', w: 90  },
  { key: 'vendor',        label: '廠商',     type: 'text', w: 90  },
  { key: 'specimen_id',   label: '檢驗編號', type: 'text', w: 86  },
  { key: 'patient_name',  label: '姓名',     type: 'text', w: 76  },
  { key: 'test_item',     label: '項目',     type: 'text', w: 76  },
  { key: 'initial_value', label: '初驗值',   type: 'text', w: 76  },
  { key: 'recheck_value', label: '複驗值',   type: 'text', w: 76  },
  { key: 'note',          label: '備註',     type: 'text', w: 120 },
]

function todayStr() { return new Date().toISOString().slice(0, 10) }
function blankDraft() {
  return { date: todayStr(), sender: '', vendor: '', specimen_id: '', patient_name: '', test_item: '', initial_value: '', recheck_value: '', note: '' }
}

// ── 樣式常數 ──────────────────────────────────────────────
const S = {
  th: {
    padding: '6px 8px',
    background: '#f1f5f9',
    fontWeight: '600',
    fontSize: '12px',
    color: '#64748b',
    borderRight: '1px solid #cbd5e1',
    borderBottom: '2px solid #94a3b8',
    whiteSpace: 'nowrap',
    textAlign: 'left',
    userSelect: 'none',
  },
  td: { padding: 0, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' },
  inp: (bg = '#fff') => ({
    width: '100%', border: 'none', outline: 'none',
    padding: '5px 7px', fontSize: '13px',
    background: bg, fontFamily: 'inherit', boxSizing: 'border-box',
  }),
  btn: (color = '#2563eb') => ({
    padding: '2px 10px', fontSize: '12px', fontWeight: '600',
    border: `1px solid ${color}`, borderRadius: '4px',
    background: color, color: '#fff', cursor: 'pointer',
    whiteSpace: 'nowrap',
  }),
  tab: (active) => ({
    padding: '7px 22px', fontSize: '13px', cursor: 'pointer', border: 'none',
    borderTop: active ? '2px solid #2563eb' : '2px solid transparent',
    borderRight: '1px solid #e2e8f0',
    fontWeight: active ? '700' : '400',
    color: active ? '#1e40af' : '#64748b',
    background: active ? '#fff' : 'transparent',
    marginTop: '-2px',
  }),
}

export default function RecheckDashboard({ currentUser, isAdmin }) {
  const [records, setRecords]   = useState([])
  const [tab, setTab]           = useState('pending')
  const [loading, setLoading]   = useState(true)
  const [draft, setDraft]       = useState(blankDraft())   // 最下方新增列
  const [localRows, setLocalRows] = useState({})            // { id: {key: val} } 暫存編輯
  const dirtyRef = useRef({})                               // { id: Set<key> }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('recheck_records')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    if (data) {
      setRecords(data)
      const init = {}
      data.forEach(r => { init[r.id] = { ...r } })
      setLocalRows(init)
    }
    setLoading(false)
  }

  // ── 編輯現有列 ─────────────────────────────────────────
  function cellChange(id, key, val) {
    setLocalRows(prev => ({ ...prev, [id]: { ...prev[id], [key]: val } }))
    if (!dirtyRef.current[id]) dirtyRef.current[id] = new Set()
    dirtyRef.current[id].add(key)
  }

  async function cellBlur(id) {
    const dirty = dirtyRef.current[id]
    if (!dirty?.size) return
    const patch = {}
    dirty.forEach(k => { patch[k] = localRows[id]?.[k] ?? '' })
    dirty.clear()
    const { error } = await supabase
      .from('recheck_records')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { alert(`儲存失敗：${error.message}`); load() }
    else setRecords(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  // ── 完成 / 撤回 ────────────────────────────────────────
  async function markDone(id) {
    const { error } = await supabase
      .from('recheck_records')
      .update({ completed: true, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { alert(`失敗：${error.message}`); return }
    setRecords(prev => prev.map(r => r.id === id ? { ...r, completed: true } : r))
  }

  async function undoDone(id) {
    const { error } = await supabase
      .from('recheck_records')
      .update({ completed: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) { alert(`失敗：${error.message}`); return }
    setRecords(prev => prev.map(r => r.id === id ? { ...r, completed: false } : r))
  }

  // ── 刪除 ───────────────────────────────────────────────
  async function del(id) {
    if (!window.confirm('確定要刪除此筆紀錄嗎？')) return
    const { error } = await supabase.from('recheck_records').delete().eq('id', id)
    if (error) { alert(`刪除失敗：${error.message}`); return }
    setRecords(prev => prev.filter(r => r.id !== id))
    setLocalRows(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  // ── 新增草稿列 ─────────────────────────────────────────
  async function saveDraft() {
    if (!draft.specimen_id.trim() && !draft.patient_name.trim()) return
    const { data, error } = await supabase
      .from('recheck_records')
      .insert([{ ...draft, completed: false, creator_name: currentUser }])
      .select()
    if (error) { alert(`新增失敗：${error.message}`); return }
    const r = data[0]
    setRecords(prev => [r, ...prev])
    setLocalRows(prev => ({ ...prev, [r.id]: { ...r } }))
    setDraft(blankDraft())
  }

  function draftKey(key, e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (key === 'test_item') {
        // Enter on 項目 → save current draft and start new one with shared fields
        saveDraft().then(() => {
          setDraft(prev => ({ ...blankDraft(), date: prev.date, sender: prev.sender, vendor: prev.vendor }))
        })
      } else if (key === 'note') {
        saveDraft()
      }
    }
  }

  // ── 篩選顯示 ───────────────────────────────────────────
  const pending = useMemo(() => records.filter(r => !r.completed), [records])
  const done    = useMemo(() => records.filter(r =>  r.completed), [records])
  const rows    = tab === 'pending' ? pending : done
  const pendingCount = pending.length

  // ── 渲染 ───────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 400 }}>

      {/* 標題列 */}
      <section className="work-header" style={{ marginBottom: 8 }}>
        <div>
          <p className="eyebrow">複驗追蹤</p>
          <h1>待處理 {pendingCount} 件</h1>
        </div>
        <div className="header-actions">
          <button className="icon-text-button ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            重新整理
          </button>
        </div>
      </section>

      {/* 表格 */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px 4px 0 0', background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900, width: '100%' }}>
          <colgroup>
            {COLS.map(c => <col key={c.key} style={{ width: c.w }} />)}
            <col style={{ width: 68 }} />
            <col style={{ width: 34 }} />
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              {COLS.map(c => <th key={c.key} style={S.th}>{c.label}</th>)}
              <th style={{ ...S.th, textAlign: 'center' }}>處理完成</th>
              <th style={{ ...S.th, padding: '6px 4px' }} />
            </tr>
          </thead>
          <tbody>
            {/* 新增草稿列（僅待處理分頁） */}
            {tab === 'pending' && (
              <tr style={{ background: '#eff6ff' }}>
                {COLS.map(c => (
                  <td key={c.key} style={S.td}>
                    <input
                      type={c.type}
                      value={draft[c.key]}
                      placeholder={c.label}
                      onChange={e => setDraft(p => ({ ...p, [c.key]: e.target.value }))}
                      onKeyDown={e => draftKey(c.key, e)}
                      style={S.inp('#eff6ff')}
                    />
                  </td>
                ))}
                <td style={{ ...S.td, textAlign: 'center', padding: '4px 6px' }}>
                  <button style={S.btn('#2563eb')} onClick={saveDraft}>+ 儲存</button>
                </td>
                <td style={S.td} />
              </tr>
            )}

            {/* 資料列 */}
            {rows.map(record => {
              const local = localRows[record.id] || record
              const isPending = !record.completed
              return (
                <tr key={record.id} style={{ background: isPending ? '#fff' : '#f8fafc' }}>
                  {COLS.map(c => (
                    <td key={c.key} style={S.td}>
                      {isPending ? (
                        <input
                          type={c.type}
                          value={local[c.key] ?? ''}
                          onChange={e => cellChange(record.id, c.key, e.target.value)}
                          onBlur={() => cellBlur(record.id)}
                          style={S.inp('#fff')}
                        />
                      ) : (
                        <span style={{ display: 'block', padding: '5px 7px', fontSize: '13px', color: '#64748b' }}>
                          {record[c.key] || ''}
                        </span>
                      )}
                    </td>
                  ))}
                  <td style={{ ...S.td, textAlign: 'center', padding: '3px 6px' }}>
                    {isPending ? (
                      <button style={S.btn('#16a34a')} onClick={() => markDone(record.id)}>完成</button>
                    ) : (
                      <button style={{ ...S.btn('#64748b'), background: 'transparent', color: '#64748b' }} onClick={() => undoDone(record.id)}>撤回</button>
                    )}
                  </td>
                  <td style={{ ...S.td, textAlign: 'center', padding: '3px' }}>
                    {(isAdmin || record.creator_name === currentUser) && (
                      <button onClick={() => del(record.id)} title="刪除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center' }}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}

            {rows.length === 0 && tab === 'done' && (
              <tr>
                <td colSpan={COLS.length + 2} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '14px' }}>
                  尚無已處理紀錄
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Excel 風格底部分頁 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', borderTop: '2px solid #cbd5e1', background: '#f8fafc', flexShrink: 0 }}>
        <button style={S.tab(tab === 'pending')} onClick={() => setTab('pending')}>
          待處理{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
        <button style={S.tab(tab === 'done')} onClick={() => setTab('done')}>
          已處理{done.length > 0 ? ` (${done.length})` : ''}
        </button>
      </div>
    </div>
  )
}
