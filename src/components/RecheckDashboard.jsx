import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── 欄位定義 ───────────────────────────────────────────────
const LABELS = ['送檢日期','送檢單位','廠商','檢驗編號','姓名','項目','初驗值','複驗值','備註','完成']
const KEYS   = ['date','sender','vendor','specimen_id','patient_name','test_item','initial_value','recheck_value','note','_v']
const WIDTHS = [110, 90, 90, 85, 75, 75, 72, 72, 130, 52]
const NC = KEYS.length
const DONE_C = NC - 1

let _uid = 0
function mkRow(db = {}) {
  return {
    _k:  ++_uid,
    _id: db.id || null,
    date:          db.date          || '',
    sender:        db.sender        || '',
    vendor:        db.vendor        || '',
    specimen_id:   db.specimen_id   || '',
    patient_name:  db.patient_name  || '',
    test_item:     db.test_item     || '',
    initial_value: db.initial_value || '',
    recheck_value: db.recheck_value || '',
    note:          db.note          || '',
    _v:            db.completed     ? 'V' : '',
    creator_name:  db.creator_name  || '',
  }
}
function hasData(row) {
  return KEYS.slice(0, DONE_C).some(k => (row[k] || '').trim() !== '')
}

// ── 主元件 ─────────────────────────────────────────────────
export default function RecheckDashboard({ currentUser, isAdmin }) {
  const [tab, setTab]         = useState('pending')
  const [pending, setPending] = useState([mkRow()])
  const [done, setDone]       = useState([])
  const [sel, setSel]         = useState([0, 0])

  const pendRef  = useRef(pending)
  const timers   = useRef({})   // { _k: timeoutId }
  const cellRefs = useRef({})   // { 'r-c': inputEl }

  useEffect(() => { pendRef.current = pending }, [pending])
  useEffect(() => { load() }, [])

  // ── 載入 ───────────────────────────────────────────────
  async function load() {
    const { data } = await supabase
      .from('recheck_records')
      .select('*')
      .order('date', { ascending: false })
    if (!data) return
    const p = data.filter(r => !r.completed).map(mkRow)
    const d = data.filter(r =>  r.completed).map(mkRow)
    setPending([...p, mkRow()])
    setDone(d)
  }

  // ── 聚焦 ───────────────────────────────────────────────
  function moveTo(r, c) {
    const rows = tab === 'pending' ? pendRef.current : done
    const nr = Math.max(0, Math.min(r, rows.length - 1))
    const nc = Math.max(0, Math.min(c, NC - 1))
    setSel([nr, nc])
    setTimeout(() => {
      const el = cellRefs.current[`${nr}-${nc}`]
      if (el) { el.focus(); el.select() }
    }, 0)
  }

  // ── 鍵盤導航 ───────────────────────────────────────────
  function onKeyDown(r, c, e) {
    const el = e.target
    const atStart = el.selectionStart === 0
    const atEnd   = el.selectionStart === el.value.length
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveTo(r - 1, c) }
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); moveTo(r + 1, c) }
    if (e.key === 'ArrowLeft'  && atStart) { e.preventDefault(); moveTo(r, c - 1) }
    if (e.key === 'ArrowRight' && atEnd)   { e.preventDefault(); moveTo(r, c + 1) }
    if (e.key === 'Tab') {
      e.preventDefault()
      e.shiftKey
        ? (c > 0 ? moveTo(r, c - 1) : moveTo(r - 1, NC - 1))
        : (c < NC - 1 ? moveTo(r, c + 1) : moveTo(r + 1, 0))
    }
  }

  // ── 貼上（支援從 Excel/Sheets 複製多格貼上） ───────────
  function onPaste(e) {
    if (tab !== 'pending') return
    e.preventDefault()
    const text = (e.clipboardData || window.clipboardData).getData('text')
    const pasteGrid = text.replace(/\r/g, '').split('\n').filter(Boolean).map(l => l.split('\t'))
    const [sr, sc] = sel

    setPending(prev => {
      const next = [...prev]
      pasteGrid.forEach((cells, dr) => {
        const ri = sr + dr
        while (next.length <= ri + 1) next.push(mkRow())
        cells.forEach((val, dc) => {
          const ci = sc + dc
          if (ci < NC) next[ri] = { ...next[ri], [KEYS[ci]]: val.trim() }
        })
        scheduleSave(next[ri]._k)
      })
      if (hasData(next[next.length - 1])) next.push(mkRow())
      return next
    })
  }

  // ── 輸入變更 ───────────────────────────────────────────
  function onChange(r, c, val) {
    const key = KEYS[c]
    let shouldMarkDone = false

    setPending(prev => {
      const next = [...prev]
      next[r] = { ...next[r], [key]: val }
      if (r === prev.length - 1 && hasData(next[r])) next.push(mkRow())
      scheduleSave(next[r]._k)
      if (c === DONE_C && val.trim().toUpperCase() === 'V') shouldMarkDone = true
      return next
    })

    if (shouldMarkDone) setTimeout(() => markDone(r), 80)
  }

  // ── 排程存檔（防抖 600ms） ─────────────────────────────
  function scheduleSave(k) {
    clearTimeout(timers.current[k])
    timers.current[k] = setTimeout(() => {
      const row = pendRef.current.find(r => r._k === k)
      if (row && hasData(row)) saveRow(row)
    }, 600)
  }

  // ── 存檔到 Supabase ────────────────────────────────────
  async function saveRow(row) {
    const body = {
      date:          row.date   || null,
      sender:        row.sender,
      vendor:        row.vendor,
      specimen_id:   row.specimen_id,
      patient_name:  row.patient_name,
      test_item:     row.test_item,
      initial_value: row.initial_value,
      recheck_value: row.recheck_value,
      note:          row.note,
      completed:     false,
    }
    if (row._id) {
      await supabase.from('recheck_records')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', row._id)
    } else {
      const { data } = await supabase.from('recheck_records')
        .insert([{ ...body, creator_name: currentUser }])
        .select()
      if (data?.[0]) {
        const newId = data[0].id
        setPending(prev => prev.map(r => r._k === row._k ? { ...r, _id: newId } : r))
      }
    }
  }

  // ── 標記完成 ───────────────────────────────────────────
  async function markDone(r) {
    const row = pendRef.current[r]
    if (!row || !hasData(row)) return

    let id = row._id
    if (!id) {
      const { data } = await supabase.from('recheck_records').insert([{
        date: row.date || null, sender: row.sender, vendor: row.vendor,
        specimen_id: row.specimen_id, patient_name: row.patient_name,
        test_item: row.test_item, initial_value: row.initial_value,
        recheck_value: row.recheck_value, note: row.note,
        completed: false, creator_name: currentUser,
      }]).select()
      if (!data?.[0]) return
      id = data[0].id
    }

    await supabase.from('recheck_records').update({ completed: true }).eq('id', id)
    const doneRow = { ...row, _id: id, _v: 'V' }
    setDone(prev => [doneRow, ...prev])
    setPending(prev => {
      const next = prev.filter((_, i) => i !== r)
      return next.length === 0 || hasData(next[next.length - 1]) ? [...next, mkRow()] : next
    })
  }

  // ── 撤回已完成 ─────────────────────────────────────────
  async function undoDone(row) {
    if (!row._id) return
    await supabase.from('recheck_records').update({ completed: false }).eq('id', row._id)
    setDone(prev => prev.filter(r => r._k !== row._k))
    setPending(prev => {
      const rest = prev.filter(r => hasData(r)) // remove trailing empty
      return [{ ...row, _v: '' }, ...rest, mkRow()]
    })
  }

  // ── 刪除 ───────────────────────────────────────────────
  async function del(row, fromDone) {
    if (!confirm('確定刪除這筆紀錄嗎？')) return
    if (row._id) await supabase.from('recheck_records').delete().eq('id', row._id)
    if (fromDone) {
      setDone(prev => prev.filter(r => r._k !== row._k))
    } else {
      setPending(prev => {
        const next = prev.filter(r => r._k !== row._k)
        return next.length === 0 || hasData(next[next.length - 1]) ? [...next, mkRow()] : next
      })
    }
  }

  // ── 渲染 ───────────────────────────────────────────────
  const rows         = tab === 'pending' ? pending : done
  const pendingCount = pending.filter(hasData).length
  const doneCount    = done.length

  const TH = { padding: '5px 8px', background: '#f1f5f9', fontWeight: '600', fontSize: '11.5px', color: '#64748b', borderRight: '1px solid #cbd5e1', borderBottom: '2px solid #94a3b8', whiteSpace: 'nowrap', textAlign: 'left', userSelect: 'none' }
  const tdBase = { padding: 0, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }
  const INP = { width: '100%', border: 'none', outline: 'none', padding: '4px 6px', fontSize: '13px', background: 'transparent', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'cell' }
  const tabSt = (on) => ({ padding: '7px 22px', fontSize: '13px', border: 'none', borderTop: on ? '2px solid #2563eb' : '2px solid transparent', borderRight: '1px solid #e2e8f0', fontWeight: on ? '700' : '400', color: on ? '#1e40af' : '#64748b', background: on ? '#fff' : 'transparent', cursor: 'pointer', marginTop: '-2px' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 400 }}>

      <section className="work-header" style={{ marginBottom: 8 }}>
        <div>
          <p className="eyebrow">複驗追蹤</p>
          <h1>待處理 {pendingCount} 件</h1>
        </div>
      </section>

      {/* 提示 */}
      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
        方向鍵 / Tab 移動格子　從 Excel 複製後直接貼上　在「完成」欄輸入 <strong>V</strong> 移至已處理
      </div>

      {/* 表格 */}
      <div
        style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px 4px 0 0', background: '#fff' }}
        onPaste={onPaste}
      >
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', minWidth: WIDTHS.reduce((a, b) => a + b, 0) + 30 }}>
          <colgroup>
            {WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
            <col style={{ width: 28 }} />
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              {LABELS.map(l => <th key={l} style={TH}>{l}</th>)}
              <th style={{ ...TH, padding: '5px 2px' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row._k}>
                {KEYS.map((key, c) => {
                  const isSel = tab === 'pending' && sel[0] === r && sel[1] === c
                  const isDoneCol = c === DONE_C
                  const isV = isDoneCol && (row[key] || '').trim().toUpperCase() === 'V'
                  return (
                    <td key={key} style={{
                      ...tdBase,
                      background: isSel ? '#dbeafe' : isDoneCol ? '#f0fdf4' : tab === 'done' ? '#f8fafc' : '#fff',
                      outline: isSel ? '2px solid #2563eb' : 'none',
                      outlineOffset: '-2px',
                    }}>
                      <input
                        ref={el => { cellRefs.current[`${r}-${c}`] = el }}
                        value={row[key] || ''}
                        readOnly={tab === 'done'}
                        onChange={e => tab === 'pending' && onChange(r, c, e.target.value)}
                        onFocus={() => setSel([r, c])}
                        onKeyDown={e => onKeyDown(r, c, e)}
                        style={{
                          ...INP,
                          textAlign: isDoneCol ? 'center' : 'left',
                          fontWeight: isV ? '700' : 'normal',
                          color: isV ? '#16a34a' : tab === 'done' ? '#64748b' : '#111',
                          fontSize: isDoneCol ? '16px' : '13px',
                          readOnly: tab === 'done',
                        }}
                      />
                    </td>
                  )
                })}
                <td style={{ ...tdBase, textAlign: 'center', padding: '2px' }}>
                  {tab === 'done'
                    ? <button onClick={() => undoDone(row)} title="撤回" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '16px', lineHeight: 1, padding: '1px 3px' }}>↩</button>
                    : hasData(row) && (isAdmin || !row._id || row.creator_name === currentUser)
                      ? <button onClick={() => del(row, false)} title="刪除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e2e8f0', fontSize: '16px', lineHeight: 1, padding: '1px 3px' }}>×</button>
                      : null
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Excel 式底部分頁 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', borderTop: '2px solid #cbd5e1', background: '#f8fafc', flexShrink: 0 }}>
        <button style={tabSt(tab === 'pending')} onClick={() => { setTab('pending'); setSel([0, 0]) }}>
          待處理{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
        <button style={tabSt(tab === 'done')} onClick={() => { setTab('done'); setSel([0, 0]) }}>
          已處理{doneCount > 0 ? ` (${doneCount})` : ''}
        </button>
      </div>
    </div>
  )
}
