import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── 欄位定義（不含「完成」欄，改為按鈕） ─────────────────
const LABELS = ['送檢日期','送檢單位','廠商','檢驗編號','姓名','項目','初驗值','複驗值','備註']
const KEYS   = ['date','sender','vendor','specimen_id','patient_name','test_item','initial_value','recheck_value','note']
const WIDTHS = [110, 90, 90, 85, 75, 75, 72, 72, 130]
const NC = KEYS.length

let _uid = 0
function mkRow(db = {}) {
  return {
    _k:           ++_uid,
    _id:          db.id            || null,
    date:         db.date          || '',
    sender:       db.sender        || '',
    vendor:       db.vendor        || '',
    specimen_id:  db.specimen_id   || '',
    patient_name: db.patient_name  || '',
    test_item:    db.test_item     || '',
    initial_value:db.initial_value || '',
    recheck_value:db.recheck_value || '',
    note:         db.note          || '',
    creator_name: db.creator_name  || '',
    created_at:   db.created_at    || null,
  }
}
function hasData(row) {
  return KEYS.some(k => (row[k] || '').trim() !== '')
}
function fmtTime(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  const m  = d.getMonth() + 1
  const dd = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${dd} ${hh}:${mm}`
}


// ── 主元件 ─────────────────────────────────────────────────
export default function RecheckDashboard({ currentUser, isAdmin, onPendingCountChange }) {
  const [tab, setTab]         = useState('pending')
  const [pending, setPending] = useState([mkRow()])
  const [done, setDone]       = useState([])
  const [sel, setSel]         = useState([0, 0])
  // 'dirty' | 'saving' | 'saved'
  const [rowStatus, setRowStatus] = useState({}) // { [_k]: status }
  const [loadState, setLoadState] = useState({ status: 'loading', msg: '', count: 0 })

  const pendRef  = useRef(pending)
  const timers   = useRef({})
  const cellRefs = useRef({})

  useEffect(() => { pendRef.current = pending }, [pending])
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (onPendingCountChange) onPendingCountChange(pending.filter(hasData).length)
  }, [pending])

  function setStatus(k, s) {
    setRowStatus(prev => ({ ...prev, [k]: s }))
  }

  // ── 載入 ─────────────────────────────────────────────────
  async function load() {
    setLoadState({ status: 'loading', msg: '載入中...', count: 0 })
    try {
      const { data, error } = await supabase
        .from('recheck_records')
        .select('*')
        .order('date', { ascending: false })
      if (error) {
        console.error('複驗載入失敗:', error)
        setLoadState({ status: 'error', msg: '載入失敗：' + error.message, count: 0 })
        return
      }
      if (!data) {
        setLoadState({ status: 'error', msg: '載入失敗：無回應資料', count: 0 })
        return
      }
      const p = data.filter(r => !r.completed).map(mkRow)
      const d = data.filter(r =>  r.completed).map(mkRow)
      const initStatus = {}
      ;[...p, ...d].forEach(r => { initStatus[r._k] = 'saved' })
      setPending([...p, mkRow()])
      setDone(d)
      setRowStatus(initStatus)
      setLoadState({ status: 'ok', msg: `已載入 ${data.length} 筆（待處理 ${p.length}、已處理 ${d.length}）`, count: data.length })
    } catch (e) {
      console.error('複驗載入例外:', e)
      setLoadState({ status: 'error', msg: '載入例外：' + (e.message || e), count: 0 })
    }
  }

  // ── 聚焦 ─────────────────────────────────────────────────
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

  // ── 鍵盤 ─────────────────────────────────────────────────
  function onKeyDown(r, c, e) {
    const el = e.target
    const atS = el.selectionStart === 0
    const atE = el.selectionStart === el.value.length
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveTo(r - 1, c) }
    if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); moveTo(r + 1, c) }
    if (e.key === 'ArrowLeft'  && atS) { e.preventDefault(); moveTo(r, c - 1) }
    if (e.key === 'ArrowRight' && atE) { e.preventDefault(); moveTo(r, c + 1) }
    if (e.key === 'Tab') {
      e.preventDefault()
      e.shiftKey
        ? (c > 0 ? moveTo(r, c - 1) : moveTo(r - 1, NC - 1))
        : (c < NC - 1 ? moveTo(r, c + 1) : moveTo(r + 1, 0))
    }
  }

  // ── 貼上（Excel TSV） ─────────────────────────────────────
  function onPaste(e) {
    if (tab !== 'pending') return
    e.preventDefault()
    const text = (e.clipboardData || window.clipboardData).getData('text')
    const grid = text.replace(/\r/g, '').split('\n').filter(Boolean).map(l => l.split('\t'))
    const [sr, sc] = sel

    setPending(prev => {
      const next = [...prev]
      grid.forEach((cells, dr) => {
        const ri = sr + dr
        while (next.length <= ri + 1) next.push(mkRow())
        cells.forEach((val, dc) => {
          const ci = sc + dc
          if (ci < NC) next[ri] = { ...next[ri], [KEYS[ci]]: val.trim() }
        })
        setStatus(next[ri]._k, 'saving')
        saveRow(next[ri]).then(ok => setStatus(next[ri]._k, ok ? 'saved' : 'dirty'))
      })
      if (hasData(next[next.length - 1])) next.push(mkRow())
      return next
    })
  }

  // ── 輸入 ─────────────────────────────────────────────────
  function onChange(r, c, val) {
    const key = KEYS[c]
    setPending(prev => {
      const next = [...prev]
      next[r] = { ...next[r], [key]: val }
      if (r === prev.length - 1 && hasData(next[r])) next.push(mkRow())
      setStatus(next[r]._k, 'dirty')
      return next
    })
  }

  // ── 離開儲存格時立即存檔 ─────────────────────────────────
  function onCellBlur(r) {
    const row = pendRef.current[r]
    if (!row || !hasData(row)) return
    const k = row._k
    clearTimeout(timers.current[k])
    setStatus(k, 'saving')
    saveRow(row).then(ok => setStatus(k, ok ? 'saved' : 'dirty'))
  }

  // 註：原先在 unmount 時批次 saveRow 的清理會在頁面重新整理時
  // 用 pendRef 的舊資料覆蓋剛剛 markDone 的列，導致完成被撤回。
  // 因為已採用 onBlur 即存，且元件常駐 (display:none)，此 cleanup 已不需要。

  // ── 存至 Supabase（回傳 true 代表成功） ──────────────────
  async function saveRow(row) {
    const body = {
      date: row.date || '', sender: row.sender, vendor: row.vendor,
      specimen_id: row.specimen_id, patient_name: row.patient_name,
      test_item: row.test_item, initial_value: row.initial_value,
      recheck_value: row.recheck_value, note: row.note, completed: false,
    }
    try {
      if (row._id) {
        const { error } = await supabase.from('recheck_records')
          .update({ ...body, updated_at: new Date().toISOString() })
          .eq('id', row._id)
        if (error) { console.error('複驗儲存失敗:', error); return false }
      } else {
        const { data, error } = await supabase.from('recheck_records')
          .insert([{ ...body, creator_name: currentUser }]).select()
        if (error || !data?.[0]) { console.error('複驗新增失敗:', error); return false }
        const newId = data[0].id
        setPending(prev => prev.map(r => r._k === row._k ? { ...r, _id: newId } : r))
      }
      return true
    } catch (e) {
      console.error('複驗存檔例外:', e)
      return false
    }
  }

  // ── 標記完成（按鈕點擊） ─────────────────────────────────
  async function markDone(r) {
    const row = pendRef.current[r]
    if (!row || !hasData(row)) {
      console.warn('markDone: 無資料或找不到列', r, row)
      return
    }
    clearTimeout(timers.current[row._k])

    try {
      let id = row._id
      if (!id) {
        const { data, error } = await supabase.from('recheck_records').insert([{
          date: row.date || '', sender: row.sender, vendor: row.vendor,
          specimen_id: row.specimen_id, patient_name: row.patient_name,
          test_item: row.test_item, initial_value: row.initial_value,
          recheck_value: row.recheck_value, note: row.note,
          completed: false, creator_name: currentUser,
        }]).select()
        if (error || !data?.[0]) { alert('標記完成失敗（新增）：' + (error?.message || '未知錯誤')); return }
        id = data[0].id
      }
      const { error: upErr } = await supabase.from('recheck_records').update({ completed: true }).eq('id', id)
      if (upErr) { alert('標記完成失敗（更新）：' + upErr.message); return }
      const doneRow = { ...row, _id: id }
      setDone(prev => [doneRow, ...prev])
      setStatus(doneRow._k, 'saved')
      setPending(prev => {
        const next = prev.filter(x => x._k !== row._k)
        return next.length === 0 || hasData(next[next.length - 1]) ? [...next, mkRow()] : next
      })
    } catch (e) {
      alert('標記完成失敗：' + (e.message || e))
      console.error(e)
    }
  }

  // ── 撤回 ────────────────────────────────────────────────
  async function undoDone(row) {
    if (!row._id) return
    try {
      const { error } = await supabase.from('recheck_records').update({ completed: false }).eq('id', row._id)
      if (error) { alert('撤回失敗：' + error.message); return }
      setDone(prev => prev.filter(r => r._k !== row._k))
      setPending(prev => {
        const rest = prev.filter(r => hasData(r))
        return [...rest, { ...row }, mkRow()]
      })
      setStatus(row._k, 'saved')
    } catch (e) {
      alert('撤回失敗：' + (e.message || e))
    }
  }

  // ── 刪除 ────────────────────────────────────────────────
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

  // 該列是否可編輯：尚未存檔（無 _id），或為自己建立，或為管理員
  function canEdit(row) {
    return !row._id || row.creator_name === currentUser || isAdmin
  }

  // ── 渲染 ────────────────────────────────────────────────
  const rows         = tab === 'pending' ? pending : done
  const pendingCount = pending.filter(hasData).length
  const doneCount    = done.length

  const TH = { padding: '5px 8px', background: '#f1f5f9', fontWeight: '600', fontSize: '11.5px', color: '#64748b', borderRight: '1px solid #cbd5e1', borderBottom: '2px solid #94a3b8', whiteSpace: 'nowrap', textAlign: 'left', userSelect: 'none' }
  const tdBase = { padding: 0, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }
  const INP = { width: '100%', border: 'none', outline: 'none', padding: '4px 6px', fontSize: '13px', background: 'transparent', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'cell' }
  const tabSt = (on) => ({ padding: '7px 22px', fontSize: '13px', border: 'none', borderTop: on ? '2px solid #2563eb' : '2px solid transparent', borderRight: '1px solid #e2e8f0', fontWeight: on ? '700' : '400', color: on ? '#1e40af' : '#64748b', background: on ? '#fff' : 'transparent', cursor: 'pointer', marginTop: '-2px' })

  // 儲存狀態指示
  function StatusDot({ k }) {
    const s = rowStatus[k]
    if (s === 'saving') return <span title="儲存中..." style={{ fontSize: 13, animation: 'spin 1s linear infinite', display: 'inline-block' }}>↻</span>
    if (s === 'saved')  return <span title="已儲存"   style={{ color: '#16a34a', fontSize: 13 }}>✓</span>
    if (s === 'dirty')  return <span title="未儲存"   style={{ color: '#f59e0b', fontSize: 13 }}>●</span>
    return null
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 400 }}>
      <section className="work-header" style={{ marginBottom: 6 }}>
        <div>
          <p className="eyebrow">複驗追蹤</p>
          <h1>待處理 {pendingCount} 件</h1>
        </div>
      </section>

      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: 6 }}>
        方向鍵 / Tab 移動　可從 Excel 直接貼上
        <span style={{ color: '#f59e0b' }}>●</span> 未儲存
        <span style={{ color: '#94a3b8' }}>↻</span> 儲存中
        <span style={{ color: '#16a34a' }}>✓</span> 已儲存
        {loadState.status === 'error' && (
          <span style={{ marginLeft: 12, color: '#dc2626' }}>{loadState.msg}</span>
        )}
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px 4px 0 0', background: '#fff' }}
        onPaste={onPaste}
      >
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', minWidth: WIDTHS.reduce((a, b) => a + b, 0) + 250 }}>
          <colgroup>
            {WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
            <col style={{ width: 130 }} />{/* 建立者 */}
            <col style={{ width: 56 }} />{/* 完成 */}
            <col style={{ width: 28 }} />{/* 狀態 */}
            <col style={{ width: 24 }} />{/* 刪除 */}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              {LABELS.map(l => <th key={l} style={TH}>{l}</th>)}
              <th style={TH}>建立者</th>
              <th style={{ ...TH, textAlign: 'center' }}>完成</th>
              <th style={{ ...TH, padding: '5px 4px', textAlign: 'center' }}></th>
              <th style={{ ...TH, padding: '5px 2px' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const editable = canEdit(row)
              return (
              <tr key={row._k} style={{ background: tab === 'done' ? '#f8fafc' : '#fff' }}>
                {KEYS.map((key, c) => {
                  const isSel = tab === 'pending' && sel[0] === r && sel[1] === c
                  const ro = tab === 'done' || !editable
                  return (
                    <td key={key} style={{
                      ...tdBase,
                      background: isSel ? '#dbeafe' : (!editable && row._id ? '#f8fafc' : 'inherit'),
                      outline: isSel ? '2px solid #2563eb' : 'none',
                      outlineOffset: '-2px',
                    }}>
                      <input
                        ref={el => { cellRefs.current[`${r}-${c}`] = el }}
                        value={row[key] || ''}
                        readOnly={ro}
                        title={!editable && row._id ? `僅 ${row.creator_name} 或管理員可修改` : ''}
                        onChange={e => !ro && onChange(r, c, e.target.value)}
                        onFocus={() => setSel([r, c])}
                        onKeyDown={e => onKeyDown(r, c, e)}
                        onBlur={() => !ro && onCellBlur(r)}
                        style={{ ...INP, color: ro ? '#64748b' : '#111', cursor: ro ? 'not-allowed' : 'cell' }}
                      />
                    </td>
                  )
                })}

                {/* 建立者 / 時間 */}
                <td style={{ ...tdBase, padding: '4px 6px', fontSize: 11.5, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row._id && (
                    <>
                      <div style={{ fontWeight: 600, color: '#475569' }}>{row.creator_name || '—'}</div>
                      <div style={{ fontSize: 10.5 }}>{fmtTime(row.created_at)}</div>
                    </>
                  )}
                </td>

                {/* 完成按鈕 */}
                <td style={{ ...tdBase, textAlign: 'center', padding: '3px 5px' }}>
                  {tab === 'pending' && hasData(row) && (
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => markDone(r)}
                      title="標記完成，移至已處理"
                      style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', position: 'relative', zIndex: 1 }}
                    >完成</button>
                  )}
                  {tab === 'done' && editable && (
                    <button
                      type="button"
                      onClick={() => undoDone(row)}
                      title="撤回到待處理"
                      style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: 4, padding: '2px 6px', fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}
                    >撤回</button>
                  )}
                </td>

                {/* 儲存狀態指示 */}
                <td style={{ ...tdBase, textAlign: 'center', padding: '2px', color: '#94a3b8' }}>
                  {hasData(row) && <StatusDot k={row._k} />}
                </td>

                {/* 刪除 */}
                <td style={{ ...tdBase, textAlign: 'center', padding: '2px' }}>
                  {hasData(row) && (isAdmin || !row._id || row.creator_name === currentUser) && (
                    <button onClick={() => del(row, tab === 'done')} title="刪除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e2e8f0', fontSize: 16, lineHeight: 1, padding: '1px 3px' }}>×</button>
                  )}
                </td>
              </tr>
              )
            })}
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
