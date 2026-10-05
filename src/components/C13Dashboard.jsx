import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ── 欄位定義（不含「完成」欄，改為按鈕） ─────────────────
const TABLE  = 'c13_records'
const LABELS = ['日期','外檢單位','姓名','碳13報告']
const KEYS   = ['date','sender','patient_name','report']
const WIDTHS = [120, 140, 110, 360]
const NC = KEYS.length
// 選填欄位：其餘欄位皆為必填，未填完不能儲存
const OPTIONAL = new Set()
// 同上：在空白列開始輸入時，自動帶入上一列的這些欄位
const CARRY = ['date','sender']

let _uid = 0
function mkRow(db = {}, k) {
  const row = {
    _k:           k || ++_uid,
    _id:          db.id            || null,
    _updated_at:  db.updated_at    || null,   // 衝突檢查用：載入時的最後修改時間
    creator_name: db.creator_name  || '',
    created_at:   db.created_at    || null,
    done_at:      db.done_at       || null,
  }
  KEYS.forEach(key => { row[key] = db[key] || '' })
  return row
}
function hasData(row) {
  return KEYS.some(k => (row[k] || '').trim() !== '')
}
function isMissing(row, key) {
  return !OPTIONAL.has(key) && (row[key] || '').trim() === ''
}
function missingLabels(row) {
  return KEYS.filter(k => isMissing(row, k)).map(k => LABELS[KEYS.indexOf(k)])
}
// 確保列表最後剛好有一列空白列（沿用原本的空白列，避免正在輸入的格子失去焦點）
function withBlankTail(list) {
  const kept = list.filter(r => r._id || hasData(r))
  const tail = list[list.length - 1]
  return [...kept, tail && !tail._id && !hasData(tail) ? tail : mkRow()]
}
// 已處理：依建立時間排序，最新的在最上面
function sortDone(list) {
  const t = r => new Date(r.created_at || 0).getTime() || 0
  return [...list].sort((a, b) => t(b) - t(a))
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
export default function C13Dashboard({ currentUser, isAdmin, onPendingCountChange, active = true }) {
  const [tab, setTab]         = useState('pending')
  const [pending, setPending] = useState([mkRow()])
  const [done, setDone]       = useState([])
  const [sel, setSel]         = useState([0, 0])
  const [selEnd, setSelEnd]   = useState([0, 0])
  // 'dirty'（未儲存）| 'saving' | 'saved'
  const [rowStatus, setRowStatus] = useState({}) // { [_k]: status }
  const [invalid, setInvalid]     = useState({}) // { [_k]: true } 按儲存時缺必填的列
  const [loadState, setLoadState] = useState({ status: 'loading', msg: '', count: 0 })

  const r0 = Math.min(sel[0], selEnd[0]), r1 = Math.max(sel[0], selEnd[0])
  const c0 = Math.min(sel[1], selEnd[1]), c1 = Math.max(sel[1], selEnd[1])
  const pendRef   = useRef(pending)
  const doneRef   = useRef(done)
  const statusRef = useRef(rowStatus)
  const activeRef = useRef(active)
  const loadedRef = useRef(false)
  const cellRefs  = useRef({})
  const dragging  = useRef(false)
  const selKeys   = useRef({ a: null, e: null })
  const remapSel  = useRef(false) // 僅在遠端同步造成列表變動時，才讓選取框跟著同一列走
  // 新增中的筆數；期間收到的即時 INSERT 先暫存，等新增完成再處理（避免自己新增的列重複出現）
  const inflight  = useRef(0)
  const deferred  = useRef([])

  useEffect(() => { pendRef.current = pending }, [pending])
  useEffect(() => { doneRef.current = done }, [done])
  useEffect(() => { statusRef.current = rowStatus }, [rowStatus])
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (onPendingCountChange) onPendingCountChange(pending.filter(hasData).length)
  }, [pending])
  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // ── 跨設備即時同步 ───────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`${TABLE}-sync`)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE }, onRemote)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  // 切回此分頁、或手機從背景回來時重新讀取（即時連線中斷時的保險）
  useEffect(() => {
    activeRef.current = active
    if (active && loadedRef.current) refresh()
  }, [active])
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && activeRef.current && loadedRef.current) refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // 有未儲存的列時，關閉或重新整理頁面前提醒
  useEffect(() => {
    if (!Object.values(rowStatus).includes('dirty')) return
    const warn = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [rowStatus])

  // 列表因同步而變動時，讓選取框跟著同一列走
  useEffect(() => {
    if (!remapSel.current) return
    remapSel.current = false
    const rows = tab === 'pending' ? pending : done
    const { a, e } = selKeys.current
    const ia = rows.findIndex(x => x._k === a)
    const ie = rows.findIndex(x => x._k === e)
    if (ia >= 0 && ia !== sel[0]) setSel([ia, sel[1]])
    if (ie >= 0 && ie !== selEnd[0]) setSelEnd([ie, selEnd[1]])
  }, [pending, done])
  useEffect(() => {
    const rows = tab === 'pending' ? pendRef.current : doneRef.current
    selKeys.current = { a: rows[sel[0]]?._k, e: rows[selEnd[0]]?._k }
  }, [sel, selEnd, tab])

  function setStatus(k, s) {
    setRowStatus(prev => ({ ...prev, [k]: s }))
  }
  function isLocalEditing(row) {
    const s = statusRef.current[row._k]
    return s === 'dirty' || s === 'saving'
  }

  // ── 載入 ─────────────────────────────────────────────────
  async function load() {
    setLoadState({ status: 'loading', msg: '載入中...', count: 0 })
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('date', { ascending: false })
      if (error) {
        console.error('碳13載入失敗:', error)
        setLoadState({ status: 'error', msg: '載入失敗：' + error.message, count: 0 })
        return
      }
      if (!data) {
        setLoadState({ status: 'error', msg: '載入失敗：無回應資料', count: 0 })
        return
      }
      const p = data.filter(r => !r.completed).map(r => mkRow(r))
      const d = data.filter(r =>  r.completed).map(r => mkRow(r))
      const initStatus = {}
      ;[...p, ...d].forEach(r => { initStatus[r._k] = 'saved' })
      setPending([...p, mkRow()])
      setDone(sortDone(d))
      setRowStatus(initStatus)
      loadedRef.current = true
      setLoadState({ status: 'ok', msg: `已載入 ${data.length} 筆`, count: data.length })
    } catch (e) {
      console.error('碳13載入例外:', e)
      setLoadState({ status: 'error', msg: '載入例外：' + (e.message || e), count: 0 })
    }
  }

  // ── 重新讀取並合併（保留自己尚未儲存的列） ───────────────
  async function refresh() {
    const { data, error } = await supabase.from(TABLE).select('*').order('date', { ascending: false })
    if (error || !data) { console.error('碳13重新讀取失敗:', error); return }
    const fresh = {}
    remapSel.current = true
    setPending(prev => {
      const local = new Map(prev.filter(r => r._id).map(r => [r._id, r]))
      const next = data.filter(r => !r.completed).map(db => {
        const loc = local.get(db.id)
        if (loc && isLocalEditing(loc)) return loc
        const row = mkRow(db, loc?._k)
        fresh[row._k] = 'saved'
        return row
      })
      // 自己正在改、但資料庫已完成或刪除的列：先保留，存檔時衝突檢查會提示
      prev.forEach(r => { if (r._id && isLocalEditing(r) && !next.includes(r)) next.push(r) })
      // 尚未存入資料庫的新列
      prev.forEach(r => { if (!r._id && hasData(r)) next.push(r) })
      const tail = prev[prev.length - 1]
      return withBlankTail(tail && !tail._id && !hasData(tail) ? [...next, tail] : next)
    })
    setDone(prev => {
      const local = new Map(prev.map(r => [r._id, r]))
      return sortDone(data.filter(r => r.completed).map(db => {
        const row = mkRow(db, local.get(db.id)?._k)
        fresh[row._k] = 'saved'
        return row
      }))
    })
    setRowStatus(prev => ({ ...prev, ...fresh }))
  }

  // ── 收到其他設備的變更 ───────────────────────────────────
  function onRemote({ eventType, new: n, old: o }) {
    if (eventType === 'DELETE') { removeRemote(o?.id); return }
    if (eventType === 'INSERT' && inflight.current > 0) { deferred.current.push(n); return }
    applyRemote(n)
  }
  function flushDeferred() {
    if (inflight.current > 0) return
    const list = deferred.current
    deferred.current = []
    list.forEach(applyRemote)
  }
  function applyRemote(n) {
    if (!n?.id) return
    const locP = pendRef.current.find(r => r._id === n.id)
    // 自己正在改這列（尚未儲存）：不覆蓋，存檔時衝突檢查會提示
    if (locP && isLocalEditing(locP)) return
    const locD = doneRef.current.find(r => r._id === n.id)
    const row = mkRow(n, (locP || locD)?._k)
    setStatus(row._k, 'saved')
    remapSel.current = true
    setPending(prev => {
      const i = prev.findIndex(r => r._id === n.id)
      if (n.completed) return i >= 0 ? withBlankTail(prev.filter((_, j) => j !== i)) : prev
      const next = [...prev]
      if (i >= 0) { next[i] = row; return next }
      // 新的列：插在最後一筆已存列之後（自己尚未儲存的新列維持在最下面）
      let at = 0
      prev.forEach((r, j) => { if (r._id) at = j + 1 })
      next.splice(at, 0, row)
      return next
    })
    setDone(prev => {
      const i = prev.findIndex(r => r._id === n.id)
      if (!n.completed) return i >= 0 ? prev.filter((_, j) => j !== i) : prev
      if (i >= 0) { const next = [...prev]; next[i] = row; return sortDone(next) }
      return sortDone([row, ...prev])
    })
  }
  function removeRemote(id) {
    if (!id) return
    const locP = pendRef.current.find(r => r._id === id)
    if (locP && isLocalEditing(locP)) return
    remapSel.current = true
    setPending(prev => prev.some(r => r._id === id) ? withBlankTail(prev.filter(r => r._id !== id)) : prev)
    setDone(prev => prev.filter(r => r._id !== id))
  }

  // ── 聚焦 ─────────────────────────────────────────────────
  function moveTo(r, c) {
    const rows = tab === 'pending' ? pendRef.current : done
    const nr = Math.max(0, Math.min(r, rows.length - 1))
    const nc = Math.max(0, Math.min(c, NC - 1))
    setSel([nr, nc])
    setSelEnd([nr, nc])
    setTimeout(() => {
      const el = cellRefs.current[`${nr}-${nc}`]
      if (el) { el.focus(); el.select() }
    }, 0)
  }

  // 擴大選取範圍（Shift+方向鍵 / 滑鼠拖曳），焦點留在起點格
  function extendTo(r, c) {
    const rows = tab === 'pending' ? pendRef.current : done
    setSelEnd([Math.max(0, Math.min(r, rows.length - 1)), Math.max(0, Math.min(c, NC - 1))])
  }
  function selectCell(r, c) {
    setSel([r, c])
    setSelEnd([r, c])
  }

  // ── 鍵盤 ─────────────────────────────────────────────────
  function onKeyDown(r, c, e) {
    const el = e.target
    const atS = el.selectionStart === 0
    const atE = el.selectionStart === el.value.length
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return }
    if (e.shiftKey && e.key.startsWith('Arrow')) {
      const multi = sel[0] !== selEnd[0] || sel[1] !== selEnd[1]
      const [er, ec] = selEnd
      if (e.key === 'ArrowUp')   { e.preventDefault(); extendTo(er - 1, ec) }
      if (e.key === 'ArrowDown') { e.preventDefault(); extendTo(er + 1, ec) }
      // 左右：格內文字游標在邊界（或已是多格範圍）才擴大範圍，否則維持格內選字
      if (e.key === 'ArrowLeft'  && (multi || el.selectionStart === 0))              { e.preventDefault(); extendTo(er, ec - 1) }
      if (e.key === 'ArrowRight' && (multi || el.selectionEnd === el.value.length)) { e.preventDefault(); extendTo(er, ec + 1) }
      return
    }
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

  // ── Ctrl+D 同上：多列範圍以第一列往下填；單格則複製正上方那格 ──
  function fillDown() {
    if (tab !== 'pending') return
    const top = r0 === r1 ? r0 - 1 : r0
    if (top < 0) return
    setPending(prev => {
      const next = [...prev]
      for (let r = top + 1; r <= r1; r++) {
        if (!next[r] || !canEdit(next[r])) continue
        const row = { ...next[r] }
        for (let c = c0; c <= c1; c++) row[KEYS[c]] = prev[top][KEYS[c]]
        next[r] = row
        setStatus(row._k, 'dirty')
      }
      if (hasData(next[next.length - 1])) next.push(mkRow())
      return next
    })
  }

  // ── 複製（Ctrl+C）：單格整格 / 多格 TSV ──────────────────
  function onCopy(e) {
    const multi = sel[0] !== selEnd[0] || sel[1] !== selEnd[1]
    const el = e.target
    // 單格且格內有選取部分文字：交給瀏覽器預設複製
    if (!multi && el.tagName === 'INPUT' && el.selectionStart !== el.selectionEnd) return
    const src = tab === 'pending' ? pendRef.current : done
    const lines = []
    for (let r = r0; r <= r1; r++) {
      const row = src[r]
      if (!row) continue
      lines.push(KEYS.slice(c0, c1 + 1).map(k => (row[k] || '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
    }
    e.preventDefault()
    e.clipboardData.setData('text/plain', lines.join('\n'))
  }

  // ── 貼上（Excel TSV）：只填入，需按儲存 ──────────────────
  function onPaste(e) {
    if (tab !== 'pending') return
    e.preventDefault()
    const text = (e.clipboardData || window.clipboardData).getData('text')
    const grid = text.replace(/\r/g, '').split('\n').filter(Boolean).map(l => l.split('\t'))
    const sr = r0, sc = c0

    setPending(prev => {
      const next = [...prev]
      grid.forEach((cells, dr) => {
        const ri = sr + dr
        while (next.length <= ri + 1) next.push(mkRow())
        if (!canEdit(next[ri])) return
        cells.forEach((val, dc) => {
          const ci = sc + dc
          if (ci < NC) next[ri] = { ...next[ri], [KEYS[ci]]: val.trim() }
        })
        setStatus(next[ri]._k, 'dirty')
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
      const row = { ...next[r], [key]: val }
      // 同上：空白新列開始輸入時，帶入上一列的日期／單位等欄位
      if (r > 0 && !prev[r]._id && !hasData(prev[r])) {
        CARRY.forEach(k => { if (k !== key && !row[k]) row[k] = prev[r - 1][k] || '' })
      }
      next[r] = row
      if (r === prev.length - 1 && hasData(next[r])) next.push(mkRow())
      setStatus(next[r]._k, 'dirty')
      return next
    })
  }

  // ── 儲存一列（檢查必填 + 衝突檢查）；回傳 true 代表已存 ──
  async function saveRow(k) {
    const row = pendRef.current.find(x => x._k === k)
    if (!row || !hasData(row)) return false
    const miss = missingLabels(row)
    if (miss.length) {
      setInvalid(prev => ({ ...prev, [k]: true }))
      return false
    }
    setInvalid(prev => { const n = { ...prev }; delete n[k]; return n })
    setStatus(k, 'saving')
    const now = new Date().toISOString()
    const body = { updated_at: now }
    KEYS.forEach(key => { body[key] = row[key] || '' })
    // 註：不寫入 completed，避免把別台設備剛標記完成的列退回待處理
    let serverTime = null
    try {
      if (row._id) {
        let q = supabase.from(TABLE).update(body).eq('id', row._id)
        q = row._updated_at ? q.eq('updated_at', row._updated_at) : q.is('updated_at', null)
        const { data, error } = await q.select('id, updated_at')
        if (error) { console.error('碳13儲存失敗:', error); alert('儲存失敗：' + error.message); setStatus(k, 'dirty'); return false }
        if (!data?.length) return await resolveConflict(row, body)
        serverTime = data[0].updated_at
      } else {
        inflight.current++
        let res
        try {
          res = await supabase.from(TABLE).insert([{ ...body, completed: false, creator_name: currentUser }]).select()
        } finally {
          inflight.current--
        }
        const { data, error } = res
        if (error || !data?.[0]) {
          console.error('碳13新增失敗:', error)
          alert('儲存失敗：' + (error?.message || '未知錯誤'))
          setStatus(k, 'dirty')
          flushDeferred()
          return false
        }
        const saved = data[0]
        serverTime = saved.updated_at
        setPending(prev => prev.map(r => r._k === k ? { ...r, _id: saved.id, creator_name: saved.creator_name, created_at: saved.created_at } : r))
        flushDeferred()
      }
      // 以資料庫回傳的 updated_at 為準（資料庫若有自動更新時間也不會誤判衝突）
      setPending(prev => prev.map(r => r._k === k ? { ...r, _updated_at: serverTime || now } : r))
      // 存檔途中又被修改過的話，維持未儲存
      if (statusRef.current[k] === 'saving') setStatus(k, 'saved')
      return true
    } catch (e) {
      console.error('碳13存檔例外:', e)
      alert('儲存失敗：' + (e.message || e))
      setStatus(k, 'dirty')
      return false
    }
  }

  // ── 衝突：這列在你打開後被別人改過或刪除 ────────────────
  async function resolveConflict(row, body) {
    const k = row._k
    const { data: cur, error } = await supabase.from(TABLE).select('*').eq('id', row._id).maybeSingle()
    if (error) { alert('儲存失敗：' + error.message); setStatus(k, 'dirty'); return false }
    if (!cur) {
      const again = confirm('這筆資料已被其他人（或你在另一台設備）刪除。\n\n按「確定」：用你的內容重新新增一筆\n按「取消」：放棄你的修改')
      if (again) {
        setPending(prev => prev.map(r => r._k === k ? { ...r, _id: null, _updated_at: null } : r))
        pendRef.current = pendRef.current.map(r => r._k === k ? { ...r, _id: null, _updated_at: null } : r)
        return saveRow(k)
      }
      setStatus(k, 'saved')
      setPending(prev => withBlankTail(prev.filter(r => r._k !== k)))
      return false
    }
    const diff = KEYS
      .filter(key => (cur[key] || '') !== (row[key] || ''))
      .map(key => `・${LABELS[KEYS.indexOf(key)]}：對方「${cur[key] || ''}」／你「${row[key] || ''}」`)
    const msg = `這列在你修改期間，已被其他人（或你在另一台設備）於 ${fmtTime(cur.updated_at)} 修改${cur.completed ? '，並已標記完成' : ''}。\n\n`
      + (diff.length ? diff.join('\n') : '（內容相同）')
      + '\n\n按「確定」：用你的內容覆蓋\n按「取消」：放棄你的修改，改用對方的版本'
    if (confirm(msg)) {
      const { data: d2, error: e2 } = await supabase.from(TABLE).update(body).eq('id', row._id).select()
      if (e2 || !d2?.[0]) { alert('儲存失敗：' + (e2?.message || '資料已不存在')); setStatus(k, 'dirty'); return false }
      applyServerRow(d2[0], k)
      return true
    }
    applyServerRow(cur, k)
    return false
  }
  // 以資料庫版本取代本地列（已完成的移到已處理）
  function applyServerRow(db, k) {
    const row = mkRow(db, k)
    setStatus(k, 'saved')
    if (db.completed) {
      setPending(prev => withBlankTail(prev.filter(r => r._k !== k)))
      setDone(prev => sortDone([row, ...prev.filter(r => r._id !== db.id)]))
    } else {
      setPending(prev => prev.map(r => r._k === k ? row : r))
    }
  }

  // ── 全部儲存 ─────────────────────────────────────────────
  async function saveAll() {
    const ks = pendRef.current.filter(r => hasData(r) && isDirtyRow(r)).map(r => r._k)
    let ok = 0, missing = 0
    for (const k of ks) {
      const row = pendRef.current.find(x => x._k === k)
      if (row && missingLabels(row).length) { missing++; setInvalid(prev => ({ ...prev, [k]: true })); continue }
      if (await saveRow(k)) ok++
    }
    if (missing) alert(`已儲存 ${ok} 筆；有 ${missing} 筆必填欄位未填完（紅色格子），尚未儲存。`)
  }

  // ── 標記完成（按鈕點擊）：需已儲存且必填填完 ─────────────
  async function markDone(r) {
    const row = pendRef.current[r]
    if (!row || !row._id || isDirtyRow(row) || missingLabels(row).length) return
    try {
      const now = new Date().toISOString()
      const { data: upData, error: upErr } = await supabase.from(TABLE).update({ completed: true, done_at: now, updated_at: now }).eq('id', row._id).select('updated_at')
      if (upErr) { alert('標記完成失敗（更新）：' + upErr.message); return }
      const doneRow = { ...row, done_at: now, _updated_at: upData?.[0]?.updated_at || now }
      setDone(prev => sortDone([doneRow, ...prev.filter(x => x._id !== row._id)]))
      setStatus(doneRow._k, 'saved')
      setPending(prev => withBlankTail(prev.filter(x => x._k !== row._k)))
    } catch (e) {
      alert('標記完成失敗：' + (e.message || e))
      console.error(e)
    }
  }

  // ── 撤回 ────────────────────────────────────────────────
  async function undoDone(row) {
    if (!row._id) return
    try {
      const now = new Date().toISOString()
      const { data: upData, error } = await supabase.from(TABLE).update({ completed: false, updated_at: now }).eq('id', row._id).select('updated_at')
      if (error) { alert('撤回失敗：' + error.message); return }
      setDone(prev => prev.filter(r => r._k !== row._k))
      setPending(prev => {
        const rest = prev.filter(r => hasData(r) && r._id !== row._id)
        return [...rest, { ...row, _updated_at: upData?.[0]?.updated_at || now }, mkRow()]
      })
      setStatus(row._k, 'saved')
    } catch (e) {
      alert('撤回失敗：' + (e.message || e))
    }
  }

  // ── 刪除 ────────────────────────────────────────────────
  async function del(row, fromDone) {
    if (!confirm('確定刪除這筆紀錄嗎？')) return
    if (row._id) await supabase.from(TABLE).delete().eq('id', row._id)
    setStatus(row._k, 'saved')
    if (fromDone) {
      setDone(prev => prev.filter(r => r._k !== row._k))
    } else {
      setPending(prev => withBlankTail(prev.filter(r => r._k !== row._k)))
    }
  }

  // 該列是否可編輯：尚未存檔（無 _id），或為自己建立，或為管理員
  function canEdit(row) {
    return !row._id || row.creator_name === currentUser || isAdmin
  }
  // 是否有未儲存的修改
  function isDirtyRow(row) {
    const s = rowStatus[row._k] ?? statusRef.current[row._k]
    return s === 'dirty' || s === 'saving' || (!row._id && hasData(row))
  }

  // ── 渲染 ────────────────────────────────────────────────
  const rows         = tab === 'pending' ? pending : done
  const pendingCount = pending.filter(hasData).length
  const doneCount    = done.length
  const dirtyCount   = pending.filter(r => hasData(r) && isDirtyRow(r)).length
  const incompleteCount = pending.filter(r => hasData(r) && KEYS.some(k => isMissing(r, k))).length

  const TH = { padding: '5px 8px', background: '#f1f5f9', fontWeight: '600', fontSize: '11.5px', color: '#64748b', borderRight: '1px solid #cbd5e1', borderBottom: '2px solid #94a3b8', whiteSpace: 'nowrap', textAlign: 'left', userSelect: 'none' }
  const tdBase = { padding: 0, borderRight: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }
  const INP = { width: '100%', border: 'none', outline: 'none', padding: '4px 6px', fontSize: '13px', background: 'transparent', fontFamily: 'inherit', boxSizing: 'border-box', cursor: 'cell' }
  const tabSt = (on) => ({ padding: '7px 22px', fontSize: '13px', border: 'none', borderTop: on ? '2px solid #2563eb' : '2px solid transparent', borderRight: '1px solid #e2e8f0', fontWeight: on ? '700' : '400', color: on ? '#1e40af' : '#64748b', background: on ? '#fff' : 'transparent', cursor: 'pointer', marginTop: '-2px' })
  const BTN = { border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', position: 'relative', zIndex: 1 }

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
          <p className="eyebrow">碳13報告追蹤</p>
          <h1>待處理 {pendingCount} 件</h1>
        </div>
        {tab === 'pending' && dirtyCount > 0 && (
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={saveAll}
            style={{ ...BTN, background: '#2563eb', color: '#fff', padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
          >全部儲存（{dirtyCount}）</button>
        )}
      </section>

      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: 6, lineHeight: 1.9 }}>
        填完一列請按<b style={{ color: '#2563eb' }}>「儲存」</b>
        <span style={{ marginLeft: 10, background: '#fff7ed', border: '1px solid #fed7aa', padding: '0 6px', borderRadius: 3, color: '#9a3412' }}>淡橘底＝未儲存</span>
        <span style={{ marginLeft: 6, background: '#fef9c3', padding: '0 6px', borderRadius: 3, color: '#a16207' }}>黃底＝必填未填</span>
        <span style={{ marginLeft: 10 }}>{OPTIONAL.size ? '除「備註」外皆必填' : '全部欄位必填'}</span>
        <span style={{ marginLeft: 10 }}>新的一列會自動帶入上一列的{CARRY.map(k => LABELS[KEYS.indexOf(k)]).join('／')}；Ctrl+D 同上（向下填滿）</span>
        <span style={{ marginLeft: 10 }}>Shift+方向鍵或拖曳可選多格，Ctrl+C 複製，可從 Excel 直接貼上</span>
        {dirtyCount > 0 && (
          <span style={{ marginLeft: 12, color: '#9a3412', fontWeight: 700 }}>{dirtyCount} 筆未儲存</span>
        )}
        {incompleteCount > 0 && (
          <span style={{ marginLeft: 12, color: '#a16207', fontWeight: 700 }}>{incompleteCount} 筆有必填未填</span>
        )}
        {loadState.status === 'error' && (
          <span style={{ marginLeft: 12, color: '#dc2626' }}>{loadState.msg}</span>
        )}
      </div>

      <div
        style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px 4px 0 0', background: '#fff' }}
        onPaste={onPaste}
        onCopy={onCopy}
      >
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%', minWidth: WIDTHS.reduce((a, b) => a + b, 0) + 260 }}>
          <colgroup>
            {WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
            <col style={{ width: 130 }} />{/* 建立者 */}
            <col style={{ width: 66 }} />{/* 儲存／完成 */}
            <col style={{ width: 28 }} />{/* 狀態 */}
            <col style={{ width: 24 }} />{/* 刪除 */}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr>
              {LABELS.map((l, i) => <th key={l} style={TH}>{l}{!OPTIONAL.has(KEYS[i]) && <span style={{ color: '#ef4444' }}> *</span>}</th>)}
              <th style={TH}>建立者</th>
              <th style={{ ...TH, textAlign: 'center' }}>{tab === 'pending' ? '儲存／完成' : '完成'}</th>
              <th style={{ ...TH, padding: '5px 4px', textAlign: 'center' }}></th>
              <th style={{ ...TH, padding: '5px 2px' }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const editable = canEdit(row)
              const filled   = hasData(row)
              const dirty    = tab === 'pending' && filled && isDirtyRow(row)
              const saving   = rowStatus[row._k] === 'saving'
              const missList = tab === 'pending' && filled ? missingLabels(row) : []
              return (
              <tr key={row._k} style={{ background: tab === 'done' ? '#f8fafc' : dirty ? '#fff7ed' : '#fff' }}>
                {KEYS.map((key, c) => {
                  const isSel = sel[0] === r && sel[1] === c
                  const inRange = r >= r0 && r <= r1 && c >= c0 && c <= c1
                  const ro = tab === 'done' || !editable
                  const missing = tab === 'pending' && filled && isMissing(row, key)
                  const bad = missing && invalid[row._k]
                  return (
                    <td key={key} onMouseEnter={() => { if (dragging.current) extendTo(r, c) }} style={{
                      ...tdBase,
                      background: inRange ? '#dbeafe' : bad ? '#fecaca' : missing ? '#fef9c3' : (!editable && row._id ? '#f8fafc' : 'inherit'),
                      outline: isSel ? '2px solid #2563eb' : 'none',
                      outlineOffset: '-2px',
                    }}>
                      <input
                        ref={el => { cellRefs.current[`${r}-${c}`] = el }}
                        value={row[key] || ''}
                        readOnly={ro}
                        title={!editable && row._id ? `僅 ${row.creator_name} 或管理員可修改` : ''}
                        onChange={e => !ro && onChange(r, c, e.target.value)}
                        placeholder={missing ? '必填' : ''}
                        onMouseDown={e => {
                          if (e.shiftKey) { e.preventDefault(); extendTo(r, c); return }
                          dragging.current = true
                          selectCell(r, c)
                        }}
                        onFocus={() => { if (!dragging.current) selectCell(r, c) }}
                        onKeyDown={e => onKeyDown(r, c, e)}
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

                {/* 儲存 / 完成按鈕 */}
                <td style={{ ...tdBase, textAlign: 'center', padding: '3px 5px' }}>
                  {tab === 'pending' && filled && dirty && (
                    <button
                      type="button"
                      disabled={saving}
                      onMouseDown={e => e.preventDefault()}
                      onClick={async () => {
                        const k = row._k
                        const ok = await saveRow(k)
                        const cur = pendRef.current.find(x => x._k === k)
                        if (!ok && cur && missingLabels(cur).length) alert('以下必填欄位尚未填寫：\n' + missingLabels(cur).join('、'))
                      }}
                      title="儲存這一列"
                      style={{ ...BTN, background: '#2563eb', color: '#fff', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1 }}
                    >{saving ? '儲存中' : '儲存'}</button>
                  )}
                  {tab === 'pending' && filled && !dirty && (
                    <button
                      type="button"
                      disabled={missList.length > 0}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => markDone(r)}
                      title={missList.length ? `必填未填：${missList.join('、')}（補齊後按儲存才能完成）` : '標記完成，移至已處理'}
                      style={{ ...BTN, background: missList.length ? '#cbd5e1' : '#16a34a', color: '#fff', cursor: missList.length ? 'not-allowed' : 'pointer' }}
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
                  {filled && <StatusDot k={row._k} />}
                </td>

                {/* 刪除 */}
                <td style={{ ...tdBase, textAlign: 'center', padding: '2px' }}>
                  {filled && (isAdmin || !row._id || row.creator_name === currentUser) && (
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
        <button style={tabSt(tab === 'pending')} onClick={() => { setTab('pending'); selectCell(0, 0) }}>
          待處理{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </button>
        <button style={tabSt(tab === 'done')} onClick={() => { setTab('done'); selectCell(0, 0) }}>
          已處理{doneCount > 0 ? ` (${doneCount})` : ''}
        </button>
      </div>
    </div>
  )
}
