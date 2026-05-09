import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Edit2,
  Loader2,
  Plus,
  Shield,
  Tag,
  Trash2,
  Users,
  Key,
  RefreshCw,
} from 'lucide-react'
import { db } from './LegacySpecimen'
import { collection, query, where, getDocs, addDoc, updateDoc, doc } from 'firebase/firestore'

export default function AdminPanel({ onClose, session }) {
  const [users, setUsers] = useState([])
  const [categories, setCategories] = useState([])
  const [newCategory, setNewCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const [cleanupDate, setCleanupDate] = useState('')
  const [showPwdModal, setShowPwdModal] = useState(false)
  const [cleanupPwd, setCleanupPwd] = useState('')
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult, setCleanupResult] = useState('')

  async function handleCleanup() {
    if (!cleanupDate || !cleanupPwd) return
    setCleanupLoading(true)
    const email = session?.user?.email
    if (!email) { alert('無法取得帳號 email，請重新登入'); setCleanupLoading(false); return }
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password: cleanupPwd })
    if (authError) {
      alert('密碼驗證失敗：' + authError.message)
      setCleanupLoading(false)
      return
    }
    // 截止時間：選定日期當天的最後一刻（本地時間）
    const cutoff = new Date(cleanupDate + 'T23:59:59')
    const iso = cutoff.toISOString()
    const [rTasks, rMsg, rRecheck, rC13] = await Promise.all([
      supabase.from('tasks').delete().in('status', [2, 3]).lt('completed_at', iso).select('id'),
      supabase.from('messages').delete().lt('created_at', iso).select('id'),
      supabase.from('recheck_records').delete().eq('completed', true).lt('created_at', iso).select('id'),
      supabase.from('c13_records').delete().eq('completed', true).lt('created_at', iso).select('id'),
    ])
    const errs = [rTasks, rMsg, rRecheck, rC13].map(r => r.error).filter(Boolean)
    if (errs.length > 0) {
      alert('部分清除失敗：\n' + errs.map(e => e.message).join('\n'))
    } else {
      const total = (rTasks.data?.length || 0) + (rMsg.data?.length || 0) + (rRecheck.data?.length || 0) + (rC13.data?.length || 0)
      setCleanupResult(
        `清除完成！共刪除 ${total} 筆（任務 ${rTasks.data?.length || 0}、留言 ${rMsg.data?.length || 0}、複驗 ${rRecheck.data?.length || 0}、碳13 ${rC13.data?.length || 0}）`
      )
      setTimeout(() => setCleanupResult(''), 8000)
    }
    setShowPwdModal(false)
    setCleanupPwd('')
    setCleanupLoading(false)
  }

  async function fetchUsers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('display_name', { ascending: true })

    if (error) console.error('Error fetching users:', error)
    setUsers(data || [])
    setLoading(false)
  }

  async function fetchCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('name')
    if (error) console.error('Error fetching categories:', error)
    setCategories(data || [])
  }

  useEffect(() => {
    fetchUsers()
    fetchCategories()
  }, [])

  async function toggleRole(userId, currentRole) {
    const newRole = currentRole === 'admin' ? 'staff' : 'admin'
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId)

    if (error) {
      alert(`更新權限失敗：${error.message}`)
      return
    }

    setMessage(`權限已更新為 ${newRole === 'admin' ? '管理員' : '員工'}`)
    await fetchUsers()
    setTimeout(() => setMessage(''), 3000)
  }

  async function syncToFirebase(displayName) {
    if (!displayName) {
      alert('該使用者尚未設定顯示姓名，無法同步。')
      return
    }

    const password = window.prompt(`請輸入「${displayName}」在舊版檢體系統的密碼：`)
    if (!password) return

    try {
      const q = query(collection(db, 'users'), where('name', '==', displayName))
      const snap = await getDocs(q)

      if (snap.empty) {
        await addDoc(collection(db, 'users'), {
          name: displayName,
          password: password,
          role: 'user',
        })
        setMessage(`已成功將「${displayName}」新增至 Firebase 系統`)
      } else {
        const userDocId = snap.docs[0].id
        await updateDoc(doc(db, 'users', userDocId), {
          password: password,
        })
        setMessage(`已更新「${displayName}」在 Firebase 的密碼`)
      }
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      alert(`同步至 Firebase 失敗：${error.message}`)
    }
  }

  async function syncAllToFirebase() {
    if (!window.confirm('確定要將「所有人員」的基本資料同步至 Firebase 嗎？\n(注意：這只會同步姓名與權限，不會包含密碼)')) return
    
    setLoading(true)
    let count = 0
    try {
      for (const user of users) {
        if (!user.display_name) continue
        
        const q = query(collection(db, 'users'), where('name', '==', user.display_name))
        const snap = await getDocs(q)
        
        if (snap.empty) {
          await addDoc(collection(db, 'users'), {
            name: user.display_name,
            password: '123456', // 給予預設密碼，提醒員工登入後自行修改
            role: user.role === 'admin' ? 'admin' : 'user'
          })
          count++
        }
      }
      setMessage(`同步完成！共新增了 ${count} 位人員至 Firebase。`)
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      alert(`一鍵同步失敗：${error.message}`)
    }
    setLoading(false)
  }

  async function updateDisplayName(userId, currentName) {
    const newName = window.prompt('請輸入新的顯示姓名：', currentName || '')
    if (!newName || newName === currentName) return

    const { error } = await supabase.from('profiles').update({ display_name: newName }).eq('id', userId)
    if (error) {
      alert(`修改姓名失敗：${error.message}`)
    } else {
      setMessage('姓名已更新')
      await fetchUsers()
      setTimeout(() => setMessage(''), 3000)
    }
  }

  const [newCategoryType, setNewCategoryType] = useState('工作交接')

  async function handleAddCategory(e) {
    e.preventDefault()
    if (!newCategory.trim()) return
    // Note: The 'type' column needs to be added to the database via SQL first
    const { error } = await supabase.from('categories').insert([{ name: newCategory.trim(), type: newCategoryType }])
    if (error) alert(`新增分類失敗：${error.message}`)
    else {
      setNewCategory('')
      setMessage('分類已新增')
      await fetchCategories()
      setTimeout(() => setMessage(''), 3000)
    }
  }

  async function handleDeleteCategory(id) {
    if (!window.confirm('確定要刪除此分類嗎？')) return
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) alert(`刪除分類失敗：${error.message}`)
    else {
      setMessage('分類已刪除')
      await fetchCategories()
      setTimeout(() => setMessage(''), 3000)
    }
  }

  return (
    <div className="admin-page">
      <div className="workspace">
        <section className="work-header">
          <div>
            <button className="link-button" onClick={onClose}>
              <ArrowLeft size={18} />
              返回工作台
            </button>
            <p className="eyebrow">系統管理</p>
            <h1>人員與權限</h1>
          </div>
          <div className="metric-card blue compact">
            <span>目前人員</span>
            <strong>{users.length}</strong>
          </div>
          <button className="icon-text-button primary" onClick={syncAllToFirebase} disabled={loading}>
            <RefreshCw size={16} />
            一鍵同步至 Firebase
          </button>
        </section>

        {message && (
          <div className="notice success">
            <CheckCircle size={18} />
            {message}
          </div>
        )}

        <section className="table-card">
          <div className="table-title">
            <Users size={20} />
            <h2>員工清單</h2>
          </div>

          {loading ? (
            <div className="empty-state">
              <Loader2 className="spin" size={28} />
              <p>讀取人員資料中</p>
            </div>
          ) : (
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>帳號 ID</th>
                    <th>角色</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {user.display_name || '未命名'}
                          <button 
                            className="icon-button" 
                            style={{ padding: '2px' }}
                            onClick={() => updateDisplayName(user.id, user.display_name)}
                          >
                            <Edit2 size={12} />
                          </button>
                        </div>
                      </td>
                      <td>{user.account_id || '-'}</td>
                      <td>
                        <span className={user.role === 'admin' ? 'role-badge admin' : 'role-badge'}>
                          {user.role === 'admin' ? '管理員' : '員工'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="icon-text-button ghost"
                            onClick={() => toggleRole(user.id, user.role)}
                          >
                            <Shield size={16} />
                            切換權限
                          </button>
                          <button
                            className="icon-text-button ghost"
                            style={{ color: 'var(--primary)' }}
                            onClick={() => syncToFirebase(user.display_name)}
                          >
                            <Key size={16} />
                            同步 Firebase 密碼
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="table-card">
          <div className="table-title">
            <Tag size={20} />
            <h2>分類管理</h2>
          </div>
          <form style={{ display: 'flex', gap: '10px', padding: '16px', borderBottom: '1px solid var(--border)' }} onSubmit={handleAddCategory}>
            <input className="field" style={{ flex: 1 }} value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="輸入新分類名稱" required />
            <select className="field" value={newCategoryType} onChange={e => setNewCategoryType(e.target.value)}>
              <option value="工作交接">工作交接</option>
              <option value="檢體收送">檢體收送</option>
            </select>
            <button className="icon-text-button primary" type="submit">
              <Plus size={16} /> 新增
            </button>
          </form>
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>分類名稱</th>
                  <th>類型</th>
                  <th style={{ width: '100px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <tr key={cat.id}>
                    <td>{cat.name}</td>
                    <td>{cat.type || '通用'}</td>
                    <td>
                      <button className="icon-text-button danger" onClick={() => handleDeleteCategory(cat.id)}>
                        <Trash2 size={16} /> 刪除
                      </button>
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr>
                    <td colSpan="2" style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>尚無自訂分類</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="notice muted">
          <AlertTriangle size={18} />
          新增或刪除帳號仍需在 Supabase Auth 內處理，這裡負責調整員工顯示資料與角色。
        </div>

        <section className="table-card">
          <div className="table-title">
            <Trash2 size={20} />
            <h2>清除舊資料</h2>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
              清除以下分頁中，所選日期（含）之前的舊資料：
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: 'var(--text-muted)', lineHeight: 2 }}>
              <li>工作交接 → 歷史</li>
              <li>檢體收送 → 歷史搜尋</li>
              <li>留言板</li>
              <li>複驗 → 已處理</li>
              <li>碳13報告 → 已處理</li>
            </ul>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>清除此日期之前：</label>
              <input
                type="date"
                className="field"
                style={{ width: 160 }}
                value={cleanupDate}
                onChange={e => setCleanupDate(e.target.value)}
              />
              <button
                className="icon-text-button danger"
                onClick={() => setShowPwdModal(true)}
                disabled={!cleanupDate}
              >
                <Trash2 size={16} />
                清除
              </button>
            </div>
            {cleanupResult && (
              <div className="notice success">
                <CheckCircle size={18} />
                {cleanupResult}
              </div>
            )}
          </div>
        </section>
      </div>

      {showPwdModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 340, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ margin: 0, fontSize: 17, color: '#dc2626' }}>確認清除</h3>
            <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.6 }}>
              將永久刪除 <strong>{cleanupDate}</strong> 之前的舊資料，此動作無法復原。<br />
              請輸入您的管理員密碼確認：
            </p>
            <input
              type="password"
              className="field"
              placeholder="登入密碼"
              value={cleanupPwd}
              onChange={e => setCleanupPwd(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !cleanupLoading) handleCleanup() }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="icon-text-button ghost" onClick={() => { setShowPwdModal(false); setCleanupPwd('') }} disabled={cleanupLoading}>
                取消
              </button>
              <button className="icon-text-button danger" onClick={handleCleanup} disabled={!cleanupPwd || cleanupLoading}>
                {cleanupLoading ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                確認清除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
