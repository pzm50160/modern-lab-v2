// 記憶體假資料庫：支援本元件用到的查詢鏈 + 模擬遠端即時事件
const db = [
  { id: 'a1', date: '', sender: '', vendor: '', specimen_id: '', patient_name: '', test_item: 'PLA', initial_value: '629', recheck_value: '635', note: '', report: '', creator_name: '測試', completed: false, created_at: '2026-09-24T03:46:00Z', updated_at: null },
  { id: 'a2', date: '9/24', sender: '富', vendor: '長榮', specimen_id: '850911', patient_name: '甲', test_item: 'PLA', initial_value: '39', recheck_value: '37', note: '', report: 'x', creator_name: '測試', completed: false, created_at: '2026-09-24T03:46:00Z', updated_at: '2026-09-24T03:46:00.123456+00:00' },
  { id: 'a3', date: '9/25', sender: '富', vendor: '長榮', specimen_id: '850990', patient_name: '乙', test_item: 'GOT', initial_value: '36', recheck_value: '35', note: '', report: 'y', creator_name: '別人', completed: false, created_at: '2026-09-25T03:46:00Z', updated_at: null },
]
let listener = null, seq = 100
window.__db = db
window.__log = []
const same = (a, b) => (a == null && b == null) || (a != null && b != null && new Date(a).getTime() === new Date(b).getTime())
window.__remote = (eventType, row) => listener && listener({ eventType, new: row || {}, old: row ? { id: row.id } : {} })
function q() {
  let op = 'select', payload = null, filters = []
  const run = () => {
    window.__log.push([op, payload, filters.map(f => f.join(':')).join(',')])
    let rows = db.filter(r => filters.every(([k, t, v]) => t === 'eq' ? (k === 'updated_at' ? same(r[k], v) : r[k] === v) : r[k] == null))
    if (op === 'update') { rows.forEach(r => Object.assign(r, payload)); return { data: rows.map(r => ({ ...r })), error: null } }
    if (op === 'insert') { const n = payload.map(p => ({ id: 'n' + (++seq), created_at: new Date().toISOString(), ...p })); db.push(...n); return { data: n, error: null } }
    if (op === 'delete') { rows.forEach(r => db.splice(db.indexOf(r), 1)); return { data: rows, error: null } }
    return { data: rows.map(r => ({ ...r })), error: null }
  }
  const b = {
    select() { return b }, order() { return b },
    update(v) { op = 'update'; payload = v; return b }, insert(v) { op = 'insert'; payload = v; return b }, delete() { op = 'delete'; return b },
    eq(k, v) { filters.push([k, 'eq', v]); return b }, is(k) { filters.push([k, 'is', null]); return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }) },
    then(res, rej) { return Promise.resolve(run()).then(res, rej) },
  }
  return b
}
export const supabase = {
  from: q,
  channel() { const c = { on(_e, _f, cb) { listener = cb; return c }, subscribe() { return c } }; return c },
  removeChannel() {},
}
