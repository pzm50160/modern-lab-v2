const rows = [
  { id: 1, date: '', sender: '', vendor: '', specimen_id: '', patient_name: '', report: '', test_item: 'PLA', initial_value: '629', recheck_value: '635', note: '', creator_name: '測試', completed: false, created_at: '2026-09-24T03:46:00Z' },
  { id: 2, date: '9/24', sender: '富', vendor: '長榮', specimen_id: '850911', patient_name: '甲', test_item: 'PLA', initial_value: '39', recheck_value: '37', note: '', creator_name: '測試', completed: false },
  { id: 3, date: '9/25', sender: '富', vendor: '長榮', specimen_id: '850990', patient_name: '乙', test_item: 'GOT', initial_value: '36', recheck_value: '35', note: '', creator_name: '別人', completed: false },
]
window.__writes = []
function q() {
  const b = {
    select() { return b }, order() { return Promise.resolve({ data: rows, error: null }) },
    update(v) { window.__writes.push(['update', v]); return { eq: () => Promise.resolve({ error: null }) } },
    insert(v) { window.__writes.push(['insert', v]); return { select: () => Promise.resolve({ data: [{ id: 99 }], error: null }) } },
    delete() { return { eq: () => Promise.resolve({ error: null }) } },
  }
  return b
}
export const supabase = { from: q }
