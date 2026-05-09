import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import AdminPanel from './components/AdminPanel'
import TaskModal from './components/TaskModal'
import LegacySpecimen from './components/LegacySpecimen'
import RecheckDashboard from './components/RecheckDashboard'
import {
  AlertCircle,
  Archive,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  FlaskConical,
  History,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Star,
  Truck,
  Undo2,
  UserCheck,
  UserCog,
  X,
  Camera,
  Edit2,
  Trash2,
  Tag,
  MessageSquare,
} from 'lucide-react'
import { db } from './components/LegacySpecimen'
import { collection, query, where, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { getToken } from 'firebase/messaging'
import { messaging, db as firebaseDb } from './components/LegacySpecimen'
import { compressImage } from './lib/imageUtils'
import { migrateToHtml, ContentEditableEditor } from './lib/richText'

const DEFAULT_TABS = [
  { id: 'all', label: '總覽', icon: LayoutDashboard },
  { id: 'reported', label: '報告完成', icon: PackageCheck },
  { id: 'history', label: '歷史', icon: ClipboardCheck },
]

const TAB_ICONS = {
  '交接': ClipboardList,
  '備忘': FileText,
  '待辦': AlertCircle,
  '特殊項目': Star,
}

const DEFAULT_ICON = Tag

const SPECIMEN_CATEGORIES = ['收檢', '耗材', '其他']
const SPECIMEN_STATUS = {
  lobby: 0,
  claimed: 1,
  done: 2,
  voided: 3,
}
const STATUS_READ = 1
const STATUS_DONE = 2
const STATUS_VOIDED = 3

function displayNameFromSession(session) {
  return session?.user?.email?.split('@')[0] || '員工'
}

function formatDateTime(value) {
  if (!value) return '未設定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function appendHistory(task, action, user, details = null) {
  const history = Array.isArray(task.history) ? task.history : []
  return [
    ...history,
    {
      action,
      user,
      time: new Date().toISOString(),
      details,
    },
  ]
}

function getTaskDiff(task, patch) {
  const fieldMap = {
    content: '內容',
    clinic: '院所內容',
    category_name: '分類',
    category: '分類',
    deadline: '期限',
    priority: '優先',
  }
  
  for (const key in patch) {
    if (key === 'content' && task.content !== patch.content) {
      const oldLines = (task.content || '').split('\n')
      const newLines = (patch.content || '').split('\n')
      
      // 偵測是否為單一勾選框狀態變更
      if (oldLines.length === newLines.length) {
        const diffIndices = []
        for (let i = 0; i < oldLines.length; i++) {
          if (oldLines[i] !== newLines[i]) diffIndices.push(i)
        }
        
        if (diffIndices.length === 1) {
          const idx = diffIndices[0]
          const oldL = oldLines[idx], newL = newLines[idx]
          const m1 = oldL.match(/^-\s*\[([xX ])\]\s*(.*?)(?:\s*\(@(.*?)\))?$/)
          const m2 = newL.match(/^-\s*\[([xX ])\]\s*(.*?)(?:\s*\(@(.*?)\))?$/)
          if (m1 && m2 && m1[2] === m2[2]) {
            const isDone = m2[1].toLowerCase() === 'x'
            return `${isDone ? '勾選了' : '取消勾選了'}「${m2[2]}」`
          }
        }
      }
      return '更新了內容文字'
    }

    if (key === 'is_collected') {
      return patch[key] ? '收集了檢體' : '取消了檢體收集'
    }

    if (fieldMap[key] && task[key] !== patch[key]) {
      let oldVal = task[key]
      let newVal = patch[key]
      
      if (key === 'deadline') {
        oldVal = formatDateTime(oldVal)
        newVal = formatDateTime(newVal)
      }
      if (key === 'priority') {
        oldVal = oldVal ? '是' : '否'
        newVal = newVal ? '是' : '否'
      }
      if (oldVal === newVal) continue;
      return `將${fieldMap[key]}由「${oldVal || '無'}」改為「${newVal || '無'}」`
    }
  }
  return null
}

function isSpecimenTask(task) {
  if (task.type === '檢體收送') return true
  if (task.type === '工作交接') return false
  return task.workflow === 'specimen' || Boolean(task.clinic) || SPECIMEN_CATEGORIES.includes(task.category)
}

function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [modalCategory, setModalCategory] = useState('待辦')
  const [tasks, setTasks] = useState([])
  const [taskError, setTaskError] = useState('')
  const [module, setModule] = useState('general')
  const moduleRef = React.useRef('general')
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [activeTab, setActiveTab] = useState('all')
  const [query, setQuery] = useState('')
  const [searchStartDate, setSearchStartDate] = useState('')
  const [searchEndDate, setSearchEndDate] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [categories, setCategories] = useState([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession)
      if (currentSession) fetchProfile(currentSession.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) fetchProfile(nextSession.user.id)
      else {
        setProfile(null)
        setTasks([])
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [showAdmin])

  async function fetchCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('name')
    if (error) {
      console.error('Error fetching categories:', error)
      return
    }
    setCategories(data || [])
  }

  useEffect(() => {
    if (!session) return undefined

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    fetchTasks()

    const currentUserName = profile?.display_name || displayNameFromSession(session)

    const channel = supabase
      .channel('work-items')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks' }, (payload) => {
        if (payload.new.creator_name && payload.new.creator_name !== currentUserName) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🚨 實驗室新任務', {
              body: `${payload.new.creator_name} 發布了：[${payload.new.category || payload.new.category_name}] ${payload.new.clinic || payload.new.content}`
            })
          }
        }
        fetchTasks()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks' }, fetchTasks)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks' }, fetchTasks)
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [session, profile, searchStartDate, searchEndDate])

  // 同步 moduleRef
  useEffect(() => { moduleRef.current = module }, [module])

  // 留言板未讀計數
  useEffect(() => {
    if (!session?.user?.id) return
    const lastReadKey = `chat_lastRead_${session.user.id}`
    const lastRead = localStorage.getItem(lastReadKey) || '1970-01-01T00:00:00Z'

    async function fetchUnread() {
      const { count, error } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', lastRead)
      if (!error) setUnreadChatCount(count || 0)
    }
    fetchUnread()

    const chatBadgeChannel = supabase
      .channel('chat-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        // 如果是自己發的，不算未讀
        if (payload.new.creator_id === session.user.id) return
        if (moduleRef.current !== 'chat') {
          setUnreadChatCount(prev => prev + 1)
        }
      })
      .subscribe()

    return () => supabase.removeChannel(chatBadgeChannel)
  }, [session?.user?.id])

  async function fetchProfile(uid) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle()

      if (error) console.error('Error fetching profile:', error)
      setProfile(data)

      // 同步 FCM Token 到 Supabase 和 Firebase
      if (data && session) {
        setupPushNotifications(uid, data.display_name || session.user.email.split('@')[0])
      }
    } finally {
      setLoading(false)
    }
  }

  async function setupPushNotifications(uid, displayName) {
    if (!('Notification' in window)) return

    try {
      let permission = Notification.permission
      if (permission === 'default') {
        permission = await Notification.requestPermission()
      }

      if (permission === 'granted') {
        console.log('[Push] 權限已核准，正在準備 Service Worker...')
        const registration = await navigator.serviceWorker.ready
        console.log('[Push] Service Worker 已就緒:', registration.scope)

        const token = await getToken(messaging, {
          vapidKey: 'BEQDpcx_iPGyzx-0-e_vctw5TqCseajRjCHCE9XeRi4TIfXEk5ndC-XwRyJFYuSmrTxej_zweULO6ib3DGbYCeE',
          serviceWorkerRegistration: registration
        })

        if (token) {
          console.log('[Push] 成功取得 Token:', token.substring(0, 10) + '...')
          
          // 1. 同步到 Supabase profiles (優先執行)
          const { error: sbError } = await supabase.from('profiles').update({ fcm_token: token }).eq('id', uid)
          if (sbError) {
            console.error('[Push] 寫入 Supabase 失敗:', sbError)
          } else {
            console.log('[Push] 寫入 Supabase 成功')
          }

          // 2. 同步到 Firebase users (供舊版系統使用，失敗不影響新版)
          try {
            const q = query(collection(firebaseDb, 'users'), where('name', '==', displayName))
            const snap = await getDocs(q)
            if (!snap.empty) {
              const userDocId = snap.docs[0].id
              await updateDoc(doc(firebaseDb, 'users', userDocId), { 
                fcmToken: token,
                lastTokenUpdate: serverTimestamp() 
              })
              console.log('[Push] 寫入 Firebase 成功')
            } else {
              console.warn('[Push] Firebase 找不到對應的使用者:', displayName)
            }
          } catch (fbErr) {
            console.error('[Push] 寫入 Firebase 失敗:', fbErr)
          }
        } else {
          console.warn('[Push] 無法取得 Token')
        }
      } else {
        console.warn('[Push] 通知權限被拒絕:', permission)
      }
    } catch (error) {
      console.error('[Push] 同步 Token 失敗:', error)
    }
  }

  async function fetchTasks() {
    setTaskError('')
    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (searchStartDate || searchEndDate) {
      const start = searchStartDate ? `${searchStartDate}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z'
      const end = searchEndDate ? `${searchEndDate}T23:59:59.999Z` : '9999-12-31T23:59:59.999Z'
      
      // 確保「待辦/進行中 (status=0)」的任務不論日期都會被抓取，而歷史任務則根據日期範圍過濾
      query = query.or(`status.eq.0,and(created_at.gte.${start},created_at.lte.${end}),and(completed_at.gte.${start},completed_at.lte.${end}),and(updated_at.gte.${start},updated_at.lte.${end})`)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching tasks:', error)
      setTaskError('讀取事項失敗，請確認 Supabase 的 tasks 資料表與權限設定。')
      return
    }

    setTasks(data || [])
  }

  async function updateTask(task, patch, fallbackMessage = '更新失敗') {
    // 樂觀更新：先立即更新本地 UI，再背景寫入 DB
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...patch } : t))

    const { error } = await supabase.from('tasks').update(patch).eq('id', task.id)

    if (error) {
      alert(`${fallbackMessage}：${error.message}`)
      // 寫入失敗時重新抓取以還原正確狀態
      await fetchTasks()
    }
  }

  async function syncPassword(newPassword) {
    const name = profile?.display_name || displayNameFromSession(session)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      const q = query(collection(db, 'users'), where('name', '==', name))
      const snap = await getDocs(q)
      if (!snap.empty) {
        const userDocId = snap.docs[0].id
        await updateDoc(doc(db, 'users', userDocId), { password: newPassword })
      }
      
      alert('密碼已成功在雙系統同步更新！')
      setShowPasswordModal(false)
    } catch (err) {
      alert(`修改密碼失敗：${err.message}`)
    }
  }

  async function updateGeneralStatus(task, status) {
    const name = profile?.display_name || displayNameFromSession(session)
    const isDone = status === STATUS_DONE
    await updateTask(task, {
      status,
      completed_at: isDone ? new Date().toISOString() : null,
      history: appendHistory(task, isDone ? '完成事項' : '撤回到待辦', name),
      updated_at: new Date().toISOString(),
    })
  }

  async function toggleChecklistItem(task, itemId) {
    const name = profile?.display_name || displayNameFromSession(session)
    const checklist = Array.isArray(task.checklist) ? task.checklist : []
    const target = checklist.find((item) => item.id === itemId)
    
    if (!target) return

    // 如果要取消勾選，檢查權限（管理員或是當初勾選的人）
    if (target.done) {
      if (profile?.role !== 'admin' && target.done_by && target.done_by !== name) {
        alert(`只有勾選的人 (${target.done_by}) 可以取消勾選`)
        return
      }
    }

    const nextChecklist = checklist.map((item) => (
      item.id === itemId 
        ? { ...item, done: !item.done, done_by: !item.done ? name : null } 
        : item
    ))

    await updateTask(task, {
      checklist: nextChecklist,
      history: appendHistory(task, `${target.done ? '取消勾選' : '勾選'}了 ${target.text || '項目'}`, name),
      updated_at: new Date().toISOString(),
    }, '更新勾選項目失敗')

    // 檢查是否所有項目都已完成，跳出確認視窗
    const updatedTask = { ...task, checklist: nextChecklist }
    if (checkAllItemsDone(updatedTask)) {
      // 特殊項目：如果尚未收集檢體，不提示完成
      const isSpecial = task.category_name === '特殊項目' || task.category_name === '特殊檢驗'
      const hasCollected = Array.isArray(task.history) && task.history.some(h => h.action.includes('收集了檢體'))
      if (isSpecial && !hasCollected) return // 尚未收集檢體，不自動完成

      const shouldComplete = window.confirm('所有項目都已勾選完畢，是否要完成此單並移至歷史紀錄？')
      if (shouldComplete) {
        await updateGeneralStatus(updatedTask, STATUS_DONE)
      }
    }
  }

  function checkAllItemsDone(task) {
    // 檢查主要內容中的勾選框
    const contentLines = (task.content || '').split('\n')
    const contentCheckboxes = contentLines.filter(line => line.match(/^-\s*\[([xX ])\]/))
    const allContentDone = contentCheckboxes.length > 0 && contentCheckboxes.every(line => line.match(/^-\s*\[[xX]\]/))
    const hasContentCheckboxes = contentCheckboxes.length > 0

    // 檢查附加項目
    const checklist = Array.isArray(task.checklist) ? task.checklist : []
    const allChecklistDone = checklist.length > 0 && checklist.every(item => item.done)
    const hasChecklist = checklist.length > 0

    // 如果完全沒有勾選框，則不自動完成
    if (!hasContentCheckboxes && !hasChecklist) return false

    // 如果有主要勾選框但沒完成，回傳 false
    if (hasContentCheckboxes && !allContentDone) return false
    
    // 如果有附加項目但沒完成，回傳 false
    if (hasChecklist && !allChecklistDone) return false

    return true
  }

  async function voidGeneralTask(task) {
    if (!window.confirm('確定要作廢此事項嗎？')) return
    const name = profile?.display_name || displayNameFromSession(session)
    await updateTask(task, {
      status: STATUS_VOIDED,
      history: appendHistory(task, '作廢事項', name),
      updated_at: new Date().toISOString(),
    }, '作廢失敗')
  }

  async function deleteGeneralTask(task) {
    if (!window.confirm('管理員您好，確定要永久刪除此任務嗎？此動作無法復原。')) return
    setUpdatingId(task.id)
    const { error } = await supabase.from('tasks').delete().eq('id', task.id)
    if (error) alert(`刪除失敗：${error.message}`)
    else await fetchTasks()
    setUpdatingId(null)
  }

  async function editGeneralTask(task, patch) {
    const name = profile?.display_name || displayNameFromSession(session)
    const updatedTask = { ...task, ...patch }
    
    const logOnly = patch._log_only
    const cleanPatch = { ...patch }
    delete cleanPatch._log_only

    const diff = getTaskDiff(task, cleanPatch)
    await updateTask(task, {
      ...cleanPatch,
      history: appendHistory(task, logOnly || diff || '修改事項', name),
      updated_at: new Date().toISOString()
    }, '修改失敗')

    // 如果是修改勾選內容，檢查是否全數完成
    if (patch.content && checkAllItemsDone(updatedTask)) {
      // 特殊項目：如果尚未收集檢體，不提示完成
      const isSpecial = task.category_name === '特殊項目' || task.category_name === '特殊檢驗'
      const hasCollected = Array.isArray(task.history) && task.history.some(h => h.action.includes('收集了檢體'))
      if (isSpecial && !hasCollected) return // 尚未收集檢體，不自動完成

      const shouldComplete = window.confirm('所有項目都已勾選完畢，是否要完成此單並移至歷史紀錄？')
      if (shouldComplete) {
        await updateGeneralStatus(updatedTask, STATUS_DONE)
      }
    }
  }

  function openCreateModal(category = '待辦') {
    setEditingTask(null)
    setModalCategory(category)
    setShowTaskModal(true)
  }

  function handleOpenEditModal(task) {
    setEditingTask(task)
    setShowTaskModal(true)
  }

  const handleGeneralTabChange = (newTab) => {
    setActiveTab(newTab)
    if (newTab === 'history' && !searchStartDate && !searchEndDate) {
      const today = new Date().toISOString().slice(0, 10)
      setSearchStartDate(today)
      setSearchEndDate(today)
    }
  }

  const dynamicTabs = useMemo(() => {
    const defaultHandoffNames = ['交接', '備忘', '待辦', '特殊項目']
    
    const customHandoffCategories = categories
      .filter(c => (c.type || '工作交接') === '工作交接' && !defaultHandoffNames.includes(c.name))
      .map(c => ({
        id: c.name,
        label: c.name,
        icon: TAB_ICONS[c.name] || DEFAULT_ICON
      }))
      
    const defaultHandoffTabs = defaultHandoffNames.map(name => ({
      id: name,
      label: name,
      icon: TAB_ICONS[name] || DEFAULT_ICON
    }))

    const handoffCategories = [...defaultHandoffTabs, ...customHandoffCategories]
    
    return [
      DEFAULT_TABS[0],
      ...handoffCategories,
      DEFAULT_TABS[1],
      DEFAULT_TABS[2]
    ]
  }, [categories])

  if (loading) {
    return (
      <div className="loading-screen">
        <RefreshCw className="spin" size={28} />
        <span>系統載入中</span>
      </div>
    )
  }

  if (!session) return <Login />

  const isAdmin = profile?.role === 'admin'
  const name = profile?.display_name || displayNameFromSession(session)
  const generalTasks = tasks.filter((task) => !isSpecimenTask(task))
  const specimenTasks = tasks.filter(isSpecimenTask)

  return (
    <div className="app-shell">
      {showAdmin && isAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
      <nav className="nav-bar">
        <div>
          <div className="nav-logo">Modern Lab 工作台</div>
          <div className="nav-subtitle">交接、備忘、待辦、檢體收送與已辦事項</div>
        </div>

        <div className="nav-actions">
          <div className="user-chip">
            <span>{name}</span>
            <small>{isAdmin ? '管理員' : '員工'}</small>
          </div>
          {isAdmin && (
            <button className="icon-text-button ghost" onClick={() => setShowAdmin(true)}>
              <UserCog size={18} />
              人員管理
            </button>
          )}
          <button className="icon-text-button ghost" onClick={() => setShowPasswordModal(true)}>
            <ShieldCheck size={18} />
            修改密碼
          </button>
          <button className="icon-button" title="登出" onClick={() => supabase.auth.signOut()}>
            <LogOut size={19} />
          </button>
        </div>
      </nav>

      <main className="workspace">
        <div className="module-switch" role="tablist" aria-label="工作模組">
          <button className={module === 'general' ? 'module-tab active' : 'module-tab'} onClick={() => setModule('general')}>
            <ClipboardList size={17} />
            工作交接
          </button>
          <button className={module === 'specimen' ? 'module-tab active' : 'module-tab'} onClick={() => setModule('specimen')}>
            <Truck size={17} />
            檢體收送
          </button>
          <button className={module === 'chat' ? 'module-tab active' : 'module-tab'} onClick={() => setModule('chat')} style={{ position: 'relative' }}>
            <MessageSquare size={17} />
            留言板
            {unreadChatCount > 0 && module !== 'chat' && (
              <span className="chat-unread-badge">{unreadChatCount > 99 ? '99+' : unreadChatCount}</span>
            )}
          </button>
          <button className={module === 'recheck' ? 'module-tab active' : 'module-tab'} onClick={() => setModule('recheck')}>
            <FlaskConical size={17} />
            複驗
          </button>
        </div>

        {module === 'general' ? (
          <GeneralDashboard
            name={name}
            tasks={generalTasks}
            activeTab={activeTab}
            query={query}
            searchStartDate={searchStartDate}
            searchEndDate={searchEndDate}
            taskError={taskError}
            updatingId={updatingId}
            onTabChange={handleGeneralTabChange}
            onQueryChange={setQuery}
            onStartDateChange={setSearchStartDate}
            onEndDateChange={setSearchEndDate}
            onCreate={openCreateModal}
            onOpenEditModal={handleOpenEditModal}
            onDone={(task) => updateGeneralStatus(task, STATUS_DONE)}
            onRestore={(task) => updateGeneralStatus(task, 0)}
            onToggleChecklist={(task, itemId) => toggleChecklistItem(task, itemId)}
            onVoid={voidGeneralTask}
            onDelete={deleteGeneralTask}
            onEdit={editGeneralTask}
            isAdmin={isAdmin}
            onOpenImage={setPreviewImage}
            tabs={dynamicTabs}
          />
        ) : module === 'chat' ? (
          <ChatBoard currentUser={name} session={session} onResetUnread={() => setUnreadChatCount(0)} />
        ) : module === 'specimen' ? (
          <LegacySpecimen
            currentUser={name}
            isAdmin={isAdmin}
          />
        ) : null}

        {/* RecheckDashboard 永遠保持掛載，只用 CSS 顯示/隱藏，避免切換模組時狀態消失 */}
        <div style={{ display: module === 'recheck' ? 'block' : 'none' }}>
          <RecheckDashboard currentUser={name} isAdmin={isAdmin} />
        </div>
      </main>

      {showTaskModal && (
        <TaskModal
          isOpen={showTaskModal}
          onClose={() => {
            setShowTaskModal(false)
            setEditingTask(null)
          }}
          creatorId={session.user.id}
          creatorName={name}
          defaultCategory={modalCategory}
          onTaskAdded={fetchTasks}
          dynamicHandoffCategories={dynamicTabs.filter(t => t.id !== 'all' && t.id !== 'history' && t.id !== 'reported').map(t => t.id)}
          editTask={editingTask}
        />
      )}

      {previewImage && <ImageViewer image={previewImage} onClose={() => setPreviewImage(null)} />}
      
      {showPasswordModal && (
        <PasswordModal 
          isOpen={showPasswordModal} 
          onClose={() => setShowPasswordModal(false)} 
          onUpdate={syncPassword} 
        />
      )}
    </div>
  )
}

function GeneralDashboard({
  name,
  tasks,
  activeTab,
  query,
  searchStartDate,
  searchEndDate,
  taskError,
  updatingId,
  onTabChange,
  onQueryChange,
  onStartDateChange,
  onEndDateChange,
  onCreate,
  onOpenEditModal,
  onDone,
  onRestore,
  onToggleChecklist,
  onVoid,
  onDelete,
  onEdit,
  isAdmin,
  onOpenImage,
  tabs,
}) {
  const stats = useMemo(() => {
    const openTasks = tasks.filter((task) => task.status === 0)
    
    // 備忘統計：看個人是否已讀且尚未歸檔
    const personalMemos = tasks.filter((task) => 
      task.category_name === '備忘' && 
      task.status === 0 &&
      !(Array.isArray(task.archived_by) && task.archived_by.includes(name))
    )
    const unreadMemos = personalMemos.filter((task) => 
      !(Array.isArray(task.read_by) && task.read_by.includes(name))
    )

    return {
      handoff: openTasks.filter((task) => task.category_name === '交接').length,
      memo: unreadMemos.length, // 個人未讀數量
      todo: openTasks.filter((task) => task.category_name === '待辦').length,
      special: openTasks.filter((task) => task.category_name === '特殊項目' && !task.reported_done).length,
      reported: tasks.filter((task) => task.category_name === '特殊項目' && task.status === 0 && task.reported_done).length,
      done: tasks.filter((task) => task.status !== 0).length,
      urgent: openTasks.filter((task) => task.priority).length,
    }
  }, [tasks, name])

  // 動態計算未完成總數
  const totalOpenCount = useMemo(() => {
    const activeCategoryIds = tabs.filter(t => t.id !== 'all' && t.id !== 'history' && t.id !== 'reported').map(t => t.id)
    return tasks.filter(task =>
      task.status === 0 &&
      activeCategoryIds.includes(task.category_name) &&
      !(task.category_name === '備忘' && Array.isArray(task.archived_by) && task.archived_by.includes(name)) &&
      !((task.category_name === '特殊項目' || task.category_name === '特殊檢驗') && Array.isArray(task.history) && task.history.some(h => h.action.includes('收集了檢體'))) &&
      !(task.category_name === '特殊項目' && task.reported_done)
    ).length
  }, [tasks, tabs, name])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks.filter((task) => {
      const isClosed = task.status === STATUS_DONE || task.status === STATUS_VOIDED
      const isArchivedByMe = Array.isArray(task.archived_by) && task.archived_by.includes(name)
      const isReadByMe = Array.isArray(task.read_by) && task.read_by.includes(name)

      const matchesTab = (() => {
        if (activeTab === 'all') {
          if (task.category_name === '備忘') return task.status === 0 && !isArchivedByMe && !isReadByMe
          if ((task.category_name === '特殊項目' || task.category_name === '特殊檢驗') && Array.isArray(task.history) && task.history.some(h => h.action.includes('收集了檢體'))) return false
          if (task.category_name === '特殊項目' && task.reported_done) return false
          return task.status === 0 && !isArchivedByMe
        }
        if (activeTab === 'reported') {
          return task.category_name === '特殊項目' && task.status === 0 && task.reported_done === true
        }
        if (activeTab === 'history') {
          if (task.category_name === '備忘') return isArchivedByMe
          return isClosed
        }
        if (activeTab === '備忘') {
          return task.category_name === '備忘' && task.status === 0 && !isArchivedByMe
        }
        if (activeTab === '特殊項目') {
          return task.category_name === '特殊項目' && task.status === 0 && !task.reported_done
        }
        return task.status === 0 && task.category_name === activeTab
      })()

      const searchable = [task.content, task.category_name, task.deadline]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return matchesTab && (!normalizedQuery || searchable.includes(normalizedQuery))
    }).sort((a, b) => {
      // 優先權高的排前面
      if (a.priority && !b.priority) return -1
      if (!a.priority && b.priority) return 1
      // 其次按時間排序（新的在前）
      return new Date(b.created_at) - new Date(a.created_at)
    })
  }, [activeTab, query, tasks])

  return (
    <>
      <section className="work-header">
        <div>
          <p className="eyebrow">今日工作清單</p>
          <h1>
            {name}，目前有 {totalOpenCount} 件未完成事項
            {stats.urgent > 0 && <span style={{ color: 'var(--red)', fontSize: '0.8em', marginLeft: '12px' }}>({stats.urgent} 件優先)</span>}
          </h1>
        </div>
        <div className="header-actions">
          <button className="icon-text-button primary" onClick={() => onCreate('待辦')}>
            <PlusCircle size={18} />
            新增事項
          </button>
        </div>
      </section>

      <section className="tool-row">
        <div className="tabs" role="tablist" aria-label="事項分類">
          {tabs.map((tab) => {
            const Icon = tab.icon
            let count = 0
            if (tab.id === 'all') {
              count = totalOpenCount
            } else if (tab.id === 'history') {
              count = 0 // 歷史不顯示數字
            } else if (tab.id === 'reported') {
              count = stats.reported
            } else {
              // 對於單一分類，計算未完成且未被個人歸檔/讀取的數量
              count = tasks.filter(task =>
                task.category_name === tab.id &&
                task.status === 0 &&
                !(task.category_name === '備忘' && Array.isArray(task.archived_by) && task.archived_by.includes(name)) &&
                !(task.category_name === '特殊項目' && task.reported_done)
              ).length
            }

            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'tab active' : 'tab'}
                onClick={() => onTabChange(tab.id)}
                type="button"
              >
                <Icon size={16} />
                {tab.label}
                {count > 0 && <span style={{ background: tab.id === 'reported' ? '#16a34a' : 'var(--red)', color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '11px', marginLeft: '4px' }}>{count}</span>}
              </button>
            )
          })}
        </div>

        <label className="search-box">
          <Search size={17} />
          <input
            type="search"
            placeholder="搜尋內容、分類..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        {activeTab === 'history' && (
          <label className="search-box date-search">
            <History size={17} />
            <input
              type="date"
              value={searchStartDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              title="開始日期"
            />
            <span style={{ margin: '0 4px', color: 'var(--text-muted)' }}>至</span>
            <input
              type="date"
              value={searchEndDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              title="結束日期"
            />
            {(searchStartDate || searchEndDate) && (
              <button className="icon-button mini" onClick={() => { onStartDateChange(''); onEndDateChange('') }} title="清除日期">
                <X size={14} />
              </button>
            )}
          </label>
        )}
      </section>

      {taskError && <div className="notice error">{taskError}</div>}

      <section className="task-board">
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              busy={updatingId === task.id}
              isAdmin={isAdmin}
              currentUser={name}
              onDone={() => onDone(task)}
              onRestore={() => onRestore(task)}
              onToggleChecklist={(itemId) => onToggleChecklist(task, itemId)}
              onVoid={() => onVoid(task)}
              onDelete={() => onDelete(task)}
              onEdit={(patch) => onEdit(task, patch)}
              onOpenEditModal={onOpenEditModal}
              onOpenImage={onOpenImage}
              handoffCategories={tabs.filter(t => t.id !== 'all' && t.id !== 'history').map(t => t.id)}
            />
          ))
        ) : (
          <EmptyState
            title="目前沒有符合條件的事項"
            body="新增交接、備忘或待辦後，員工就能在這裡追蹤處理狀態。"
          />
        )}
      </section>
    </>
  )
}

function SpecimenDashboard({ currentUser, isAdmin, tasks, taskError, updatingId, onCreate, onUpdate, onDelete, onEdit }) {
  const [tab, setTab] = useState('lobby')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [form, setForm] = useState({
    clinic: '',
    category: '收檢',
    priority: false,
    deadline: '',
  })

  const counts = useMemo(() => ({
    lobby: tasks.filter((task) => task.status === SPECIMEN_STATUS.lobby).length,
    mine: tasks.filter((task) => task.status === SPECIMEN_STATUS.claimed && task.picker === currentUser).length,
    done: tasks.filter((task) => task.status === SPECIMEN_STATUS.done).length,
    urgent: tasks.filter((task) => task.status !== SPECIMEN_STATUS.done && task.priority).length,
  }), [currentUser, tasks])

  const visibleTasks = useMemo(() => {
    const term = search.trim().toLowerCase()
    return sortSpecimenTasks(tasks).filter((task) => {
      const statusDate = task.completed_at || task.claimed_at || task.created_at
      const day = statusDate ? new Date(statusDate).toISOString().slice(0, 10) : ''
      const text = [task.clinic, task.category, task.creator_name, task.picker]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      if (tab === 'lobby') return task.status === SPECIMEN_STATUS.lobby
      if (tab === 'mine') return task.status === SPECIMEN_STATUS.claimed && task.picker === currentUser
      return (
        [SPECIMEN_STATUS.claimed, SPECIMEN_STATUS.done, SPECIMEN_STATUS.voided].includes(task.status) &&
        (!term || text.includes(term)) &&
        (!day || (day >= startDate && day <= endDate))
      )
    })
  }, [currentUser, endDate, search, startDate, tab, tasks])

  async function submitSpecimen(event) {
    event.preventDefault()
    if (!form.clinic.trim()) return
    await onCreate(form)
    setForm({ clinic: '', category: '收檢', priority: false, deadline: '' })
  }

  function patchWithHistory(task, patch, action) {
    const diff = getTaskDiff(task, patch)
    return onUpdate(task, {
      ...patch,
      history: appendHistory(task, diff || action, currentUser),
      updated_at: new Date().toISOString(),
    })
  }

  return (
    <>
      <section className="work-header">
        <div>
          <p className="eyebrow">檢體收送</p>
          <h1>
            待領 {counts.lobby} 件，我的任務 {counts.mine} 件
            {counts.urgent > 0 && <span style={{ color: 'var(--red)', fontSize: '0.8em', marginLeft: '12px' }}>({counts.urgent} 件優先)</span>}
          </h1>
        </div>
        <div className="header-actions">
          <button className="icon-text-button primary" onClick={() => setTab('lobby')}>
            <Truck size={18} />
            待領大廳
          </button>
        </div>
      </section>

      <form className="specimen-form" onSubmit={submitSpecimen}>
        <label className="field specimen-note">
          <span>院所 / 檢體內容</span>
          <textarea
            value={form.clinic}
            onChange={(event) => setForm({ ...form, clinic: event.target.value })}
            placeholder="例如：仁愛診所 3 管血液、尿液 1 件"
            rows="3"
            required
          />
        </label>
        <label className="field">
          <span>分類</span>
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            {SPECIMEN_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>期限</span>
          <input type="datetime-local" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
        </label>
        <label className="priority-toggle specimen-priority">
          <span><AlertCircle size={18} /> 優先</span>
          <input type="checkbox" checked={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.checked })} />
        </label>
        <button className="icon-text-button primary full" type="submit">
          <Send size={18} />
          新增收送
        </button>
      </form>

      <section className="tool-row">
        <div className="tabs">
          <button className={tab === 'lobby' ? 'tab active' : 'tab'} onClick={() => setTab('lobby')}>
            <Truck size={16} />待領大廳
            {counts.lobby > 0 && <span style={{ background: 'var(--red)', color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '11px', marginLeft: '4px' }}>{counts.lobby}</span>}
          </button>
          <button className={tab === 'mine' ? 'tab active' : 'tab'} onClick={() => setTab('mine')}>
            <UserCheck size={16} />我的任務
            {counts.mine > 0 && <span style={{ background: 'var(--blue)', color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '11px', marginLeft: '4px' }}>{counts.mine}</span>}
          </button>
          <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}><History size={16} />歷史紀錄</button>
        </div>
        {tab === 'history' && (
          <div className="history-filters">
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            <label className="search-box">
              <Search size={17} />
              <input type="search" placeholder="搜尋院所、人員或分類" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
          </div>
        )}
      </section>

      {taskError && <div className="notice error">{taskError}</div>}

      <section className="task-board">
        {visibleTasks.length > 0 ? (
          visibleTasks.map((task) => (
            <SpecimenCard
              key={task.id}
              task={task}
              currentUser={currentUser}
              isAdmin={isAdmin}
              busy={updatingId === task.id}
              onClaim={() => patchWithHistory(task, {
                status: SPECIMEN_STATUS.claimed,
                picker: currentUser,
                claimed_at: new Date().toISOString(),
              }, '領取任務')}
              onReturn={() => patchWithHistory(task, {
                status: SPECIMEN_STATUS.lobby,
                picker: '',
                claimed_at: null,
              }, '退回待領')}
              onDone={() => patchWithHistory(task, {
                status: SPECIMEN_STATUS.done,
                completed_at: new Date().toISOString(),
              }, '完成收送')}
              onStock={() => patchWithHistory(task, {
                is_stocked: true,
                stocker: currentUser,
                stocked_at: new Date().toISOString(),
              }, '完成備貨')}
              onUndoStock={() => patchWithHistory(task, {
                is_stocked: false,
                stocker: '',
                stocked_at: null,
              }, '取消備貨')}
              onVoid={() => patchWithHistory(task, {
                status: SPECIMEN_STATUS.voided,
              }, '作廢任務')}
              onDelete={() => onDelete(task)}
              onEdit={(patch) => onEdit(task, patch)}
            />
          ))
        ) : (
          <EmptyState title="目前沒有檢體收送任務" body="新增收送後，待領、我的任務和歷史紀錄會在這裡呈現。" />
        )}
      </section>
    </>
  )
}

function sortSpecimenTasks(taskList) {
  const weights = { 收檢: 1, 耗材: 2, 其他: 3 }
  return [...taskList].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1
    const wa = weights[a.category] || 99
    const wb = weights[b.category] || 99
    if (wa !== wb) return wa - wb
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  })
}

function Metric({ label, value, tone }) {
  return (
    <div className={`metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function TaskRow({ 
  task, 
  busy, 
  isAdmin, 
  currentUser, 
  onDone, 
  onRestore, 
  onToggleChecklist, 
  onVoid, 
  onDelete, 
  onEdit, 
  onOpenEditModal,
  onOpenImage,
  handoffCategories 
}) {
  const isDone = task.status === STATUS_DONE
  const isVoided = task.status === STATUS_VOIDED
  const isHistorical = isDone || isVoided || (task.category_name === '備忘' && Array.isArray(task.archived_by) && task.archived_by.includes(currentUser))
  const images = Array.isArray(task.image_urls) ? task.image_urls : []
  const checklist = Array.isArray(task.checklist) ? task.checklist : []
  const history = Array.isArray(task.history) ? task.history : []

  const [localContent, setLocalContent] = React.useState(task.content)
  const [isEditing, setIsEditing] = React.useState(false)
  const [editForm, setEditForm] = React.useState({
    content: task.content || '',
    category_name: task.category_name || '待辦',
    deadline: (() => {
      try {
        return task.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : ''
      } catch (e) {
        return ''
      }
    })(),
    priority: task.priority || false,
    image_urls: Array.isArray(task.image_urls) ? task.image_urls : [],
    checklist: Array.isArray(task.checklist) ? task.checklist : [],
  })

  // 逐行編輯模式狀態
  const [isChecklistMode, setIsChecklistMode] = React.useState(false)
  const savedHtmlRef = React.useRef(null)
  const [contentLines, setContentLines] = React.useState([{ text: '', checked: false }])
  const contentTextareaRef = React.useRef(null)
  const [checkItem, setCheckItem] = React.useState('')
  const [savedTemplateItems, setSavedTemplateItems] = React.useState(() => {
    try {
      return JSON.parse(localStorage.getItem('modernLabChecklistTemplates') || '[]')
    } catch {
      return []
    }
  })

  React.useEffect(() => {
    setLocalContent(task.content)
    setEditForm(prev => ({ ...prev, content: task.content }))
  }, [task.content])

  function handleOpenEdit() {
    const lines = (task.content || '').split('\n')
    const hasChecks = lines.some(l => /^-\s*\[[xX ]\]/.test(l))
    
    if (hasChecks) {
      setIsChecklistMode(true)
      const nextLines = lines.filter(l => l.trim()).map(text => {
        const isCheck = /^-\s*\[[xX ]\]\s*/.test(text)
        const cleanText = text.replace(/^-\s*\[[xX ]\]\s*/, '').replace(/\s*\(@.*?\)\s*$/, '')
        return { text: cleanText, checked: isCheck }
      })
      setContentLines(nextLines.length > 0 ? nextLines : [{ text: '', checked: false }])
    } else {
      setIsChecklistMode(false)
      setContentLines([{ text: '', checked: false }])
    }

    setEditForm({
      content: task.content || '',
      category_name: task.category_name || '待辦',
      deadline: (() => {
        try {
          return task.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : ''
        } catch (e) {
          return ''
        }
      })(),
      priority: task.priority || false,
      image_urls: Array.isArray(task.image_urls) ? task.image_urls : [],
      checklist: Array.isArray(task.checklist) ? task.checklist : [],
    })
    setIsEditing(true)
  }

  function handleSave() {
    let finalContent = editForm.content
    if (isChecklistMode) {
      finalContent = contentLines
        .map(line => {
          const text = line.text.trim()
          if (!text) return ''
          return line.checked ? `- [ ] ${text}` : text
        })
        .filter(Boolean)
        .join('\n')
    }
    
    onEdit({ 
      content: finalContent,
      category_name: editForm.category_name,
      deadline: editForm.deadline ? new Date(editForm.deadline).toISOString() : null,
      priority: editForm.priority,
      image_urls: editForm.image_urls,
      checklist: editForm.checklist,
    })
    setIsEditing(false)
  }

  async function handleAddImages(event) {
    const remaining = 9 - editForm.image_urls.length
    if (remaining <= 0) {
      alert('最多只能上傳 9 張圖片。')
      return
    }
    const files = Array.from(event.target.files || []).slice(0, remaining)
    if (!files.length) return

    try {
      const compressedImages = await Promise.all(files.map((file) => compressImage(file)))
      setEditForm({
        ...editForm,
        image_urls: [...editForm.image_urls, ...compressedImages].slice(0, 9),
      })
    } catch (error) {
      alert(`處理圖片時發生錯誤: ${error.message}`)
    } finally {
      event.target.value = ''
    }
  }

  function removeImage(index) {
    setEditForm({
      ...editForm,
      image_urls: editForm.image_urls.filter((_, i) => i !== index)
    })
  }

  const [localChecklist, setLocalChecklist] = React.useState(checklist)

  React.useEffect(() => {
    setLocalChecklist(checklist)
  }, [checklist])

  return (
    <article className={`task-row ${task.category_name || ''} ${isVoided ? 'voided' : ''} ${task.priority ? 'priority' : ''}`} style={task.priority ? { borderLeft: '6px solid var(--red)', boxShadow: '0 4px 12px rgba(239, 68, 68, 0.12)', background: 'linear-gradient(to right, #fff8f8, #ffffff)', position: 'relative' } : {}}>
      {task.priority && (
        <div style={{ position: 'absolute', top: '-10px', left: '12px', background: 'var(--red)', color: '#fff', padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '4px', zIndex: 10 }}>
          <AlertCircle size={12} /> 優先處理
        </div>
      )}
      <div className="task-main">
        <div className="task-meta">
          <span className={`category-pill ${task.category_name || '待辦'}`}>{task.category_name || '待辦'}</span>
          <strong style={{ color: 'var(--text)', marginLeft: '4px', marginRight: '8px' }}>{task.creator_name || '系統'}</strong>
          {task.priority && <span className="priority-pill">優先</span>}
          {task.category_name === '備忘' && Array.isArray(task.read_by) && task.read_by.includes(currentUser) && (
            <span className="status-pill read" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>您已讀</span>
          )}
          {isDone && task.category_name !== '備忘' && <span className="status-pill done">已完成</span>}
          {isVoided && <span className="status-pill voided">已作廢</span>}
          <span>{formatDateTime(task.created_at)}</span>
        </div>
        
        {isEditing ? (
          <div className="inline-editor" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--text-muted)' }}>編輯內容</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--blue)', fontWeight: '600' }}>
                <input 
                  type="checkbox" 
                  checked={isChecklistMode} 
                  onChange={(e) => {
                    const enabled = e.target.checked
                    setIsChecklistMode(enabled)
                    if (enabled) {
                      savedHtmlRef.current = editForm.content
                      let raw = editForm.content || ''
                      raw = raw.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '')
                      raw = raw.replace(/<br\s*\/?>/gi, '\n')
                      raw = raw.replace(/<[^>]+>/g, '')
                      raw = raw.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                      const lines = raw.split('\n').filter(l => l.trim() !== '')
                      if (lines.length > 0) {
                        const nextLines = lines.map(text => {
                          const isCheck = /^-\s*\[[xX ]?\]\s*/.test(text)
                          return { text: text.replace(/^-\s*\[[xX ]?\]\s*/, ''), checked: isCheck }
                        })
                        setContentLines(nextLines)
                      }
                    } else {
                      if (savedHtmlRef.current) {
                        setEditForm(prev => ({ ...prev, content: savedHtmlRef.current }))
                        savedHtmlRef.current = null
                      } else {
                        const plainContent = contentLines.map(l => l.text).filter(Boolean).join('\n')
                        setEditForm(prev => ({ ...prev, content: plainContent }))
                      }
                    }
                  }}
                  style={{ width: '15px', height: '15px', minHeight: 'auto' }}
                />
                開啟逐行勾選
              </label>
            </div>

            {isChecklistMode ? (
              <div className="line-editor" style={{ maxHeight: 'none', border: '1px solid var(--border)', background: '#fff' }}>
                {contentLines.map((line, index) => (
                  <div key={index} className="line-editor-row">
                    <input
                      type="checkbox"
                      className="line-editor-checkbox"
                      checked={line.checked}
                      onChange={() => {
                        const next = [...contentLines]
                        next[index] = { ...next[index], checked: !next[index].checked }
                        setContentLines(next)
                      }}
                    />
                    <textarea
                      className="line-editor-input"
                      value={line.text}
                      rows={1}
                      onChange={(e) => {
                        const next = [...contentLines]
                        next[index] = { ...next[index], text: e.target.value }
                        setContentLines(next)
                        e.target.style.height = 'auto'
                        e.target.style.height = e.target.scrollHeight + 'px'
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          const next = [...contentLines]
                          next.splice(index + 1, 0, { text: '', checked: false })
                          setContentLines(next)
                        }
                        if (e.key === 'Backspace' && contentLines[index].text === '' && contentLines.length > 1) {
                          e.preventDefault()
                          const next = [...contentLines]
                          next.splice(index, 1)
                          setContentLines(next)
                        }
                      }}
                      onFocus={(e) => {
                        e.target.style.height = 'auto'
                        e.target.style.height = e.target.scrollHeight + 'px'
                      }}
                      placeholder="寫下內容..."
                    />
                    {contentLines.length > 1 && (
                      <button type="button" className="line-editor-remove" onClick={() => {
                        const next = [...contentLines]
                        next.splice(index, 1)
                        setContentLines(next)
                      }}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
                <button 
                  type="button" 
                  className="link-button" 
                  style={{ padding: '8px', justifyContent: 'flex-start' }} 
                  onClick={() => setContentLines([...contentLines, { text: '', checked: false }])}
                >
                  <Plus size={16} /> 新增一行
                </button>
              </div>
            ) : (
              <ContentEditableEditor
                value={editForm.content}
                onChange={(val) => setEditForm({ ...editForm, content: val })}
                placeholder="輸入事項內容..."
              />
            )}

            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
              <label className="field" style={{ margin: 0 }}>
                <span style={{ fontSize: '13px' }}>分類</span>
                <select 
                  style={{ minHeight: '38px', padding: '0 10px', background: '#fff' }}
                  value={editForm.category_name} 
                  onChange={(e) => setEditForm({ ...editForm, category_name: e.target.value })}
                >
                  {handoffCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span style={{ fontSize: '13px' }}>截止時間</span>
                <input 
                  type="datetime-local" 
                  style={{ minHeight: '38px', padding: '0 10px', background: '#fff' }}
                  value={editForm.deadline} 
                  onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} 
                />
              </label>
            </div>

            <div className="composer-section" style={{ padding: '0', background: 'transparent', border: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                  <Camera size={14} /> 圖片 (最多 9 張)
                </span>
                <label className="image-picker" style={{ margin: 0, padding: '4px 10px', minHeight: '30px', fontSize: '12px' }}>
                  <input type="file" accept="image/*" multiple onChange={handleAddImages} />
                  <Camera size={14} /> 補傳圖片
                </label>
              </div>
              {editForm.image_urls.length > 0 && (
                <div className="image-preview-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(60px, 80px))', margin: '0 0 12px' }}>
                  {editForm.image_urls.map((image, index) => (
                    <div className="image-preview" key={index} style={{ width: '80px', height: '80px' }}>
                      <img src={image} alt={`附件 ${index + 1}`} />
                      <button type="button" className="image-remove" onClick={() => removeImage(index)} style={{ width: '20px', height: '20px' }}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <label className={editForm.priority ? 'priority-toggle active' : 'priority-toggle'} style={{ margin: '0 0 8px' }}>
              <span>
                <AlertCircle size={20} />
                <strong>優先處理</strong>
              </span>
              <input
                type="checkbox"
                checked={editForm.priority}
                onChange={(e) => setEditForm({ ...editForm, priority: e.target.checked })}
              />
            </label>

            <div className="composer-section" style={{ padding: '12px', margin: '0 0 8px' }}>
              <div className="composer-title">
                <Plus size={17} />
                附加勾選項目
              </div>
              <div className="checklist-composer">
                <input
                  type="text"
                  value={checkItem}
                  onChange={(e) => setCheckItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const text = checkItem.trim()
                      if (!text) return
                      const nextSaved = [text, ...savedTemplateItems.filter(i => i !== text)].slice(0, 12)
                      setSavedTemplateItems(nextSaved)
                      localStorage.setItem('modernLabChecklistTemplates', JSON.stringify(nextSaved))
                      setEditForm(prev => ({
                        ...prev,
                        checklist: [...prev.checklist, { id: `${text}-${prev.checklist.length}`, text, done: false }]
                      }))
                      setCheckItem('')
                    }
                  }}
                  placeholder="例如：確認交班、補拍照片"
                />
                <button type="button" className="icon-button" title="新增項目" onClick={() => {
                  const text = checkItem.trim()
                  if (!text) return
                  const nextSaved = [text, ...savedTemplateItems.filter(i => i !== text)].slice(0, 12)
                  setSavedTemplateItems(nextSaved)
                  localStorage.setItem('modernLabChecklistTemplates', JSON.stringify(nextSaved))
                  setEditForm(prev => ({
                    ...prev,
                    checklist: [...prev.checklist, { id: `${text}-${prev.checklist.length}`, text, done: false }]
                  }))
                  setCheckItem('')
                }}>
                  <Plus size={18} />
                </button>
              </div>
              {savedTemplateItems.length > 0 && (
                <div className="quick-check-buttons" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
                  {savedTemplateItems.map((item) => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-soft)', border: '1px solid var(--border)', borderRadius: '16px', paddingLeft: '12px', paddingRight: '4px', gap: '4px' }}>
                      <button type="button" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '13px', color: 'var(--text)' }} onClick={() => {
                        setEditForm(prev => ({
                          ...prev,
                          checklist: [...prev.checklist, { id: `${item}-${prev.checklist.length}`, text: item, done: false }]
                        }))
                      }}>
                        {item}
                      </button>
                      <button type="button" className="icon-button" style={{ width: '24px', height: '24px', minHeight: '24px', color: 'var(--red)', background: 'var(--red-soft)', borderRadius: '50%', padding: 0 }} onClick={() => {
                        const next = savedTemplateItems.filter(i => i !== item)
                        setSavedTemplateItems(next)
                        localStorage.setItem('modernLabChecklistTemplates', JSON.stringify(next))
                      }} title="刪除快捷鍵">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {editForm.checklist.length > 0 && (
                <div className="checklist-preview" style={{ marginTop: '8px' }}>
                  {editForm.checklist.map((item) => (
                    <div className="checklist-preview-item" key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span>{item.text}</span>
                      <button type="button" className="icon-button mini" onClick={() => {
                        setEditForm(prev => ({
                          ...prev,
                          checklist: prev.checklist.filter(i => i.id !== item.id)
                        }))
                      }} title="移除">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="icon-text-button complete" style={{ flex: 1 }} onClick={handleSave}>
                <Send size={18} /> 存檔
              </button>
              <button className="icon-text-button ghost" style={{ flex: 1 }} onClick={() => setIsEditing(false)}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="post-content parsed-content">
            {localContent.split('\n').map((line, index) => {
                const match = line.match(/^-\s*\[([xX ])\]\s*(.*?)(?:\s*\(@(.*?)\))?$/)
                if (match) {
                  const [, char, rawText, owner] = match
                  const isChecked = char.toLowerCase() === 'x'
                  return (
                    <label key={index} className={isChecked ? 'task-check done' : 'task-check'} style={{ marginTop: '4px', marginBottom: '4px' }}>
                      <input 
                        type="checkbox" 
                        checked={isChecked} 
                        onChange={() => {
                          if (isChecked) {
                            if (owner && owner !== currentUser) {
                              alert(`只有打勾的人 (${owner}) 可以取消勾選`)
                              return
                            }
                            const lines = localContent.split('\n')
                            lines[index] = `- [ ] ${rawText}`
                            const newContent = lines.join('\n')
                            setLocalContent(newContent)
                            onEdit({ content: newContent })
                          } else {
                            const lines = localContent.split('\n')
                            lines[index] = `- [x] ${rawText} (@${currentUser})`
                            const newContent = lines.join('\n')
                            setLocalContent(newContent)
                            onEdit({ content: newContent })
                          }
                        }}
                        disabled={isHistorical}
                      />
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span dangerouslySetInnerHTML={{ __html: migrateToHtml(rawText) }} />
                        {owner && <small style={{ fontWeight: 'bold', color: '#fff', background: 'var(--blue)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', whiteSpace: 'nowrap' }}>{owner}</small>}
                      </span>
                    </label>
                  )
                }
                // Check if the line itself looks like HTML from WYSIWYG
                if (line.includes('<') && line.includes('>')) {
                  return <div key={index} dangerouslySetInnerHTML={{ __html: line }} style={{ margin: 0, padding: 0 }} />
                }
                return <h2 key={index} style={{ fontSize: 'inherit', fontWeight: 'inherit', margin: 0, padding: 0 }} dangerouslySetInnerHTML={{ __html: migrateToHtml(line) }} />
              })}
            </div>
        )}

        {localChecklist.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px', borderTop: '1px dashed var(--border)', paddingTop: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}>
              📝 附加項目
            </div>
            <div className="task-checklist" style={{ marginTop: 0, gap: '8px 20px' }}>
              {localChecklist.map((item) => (
                <label className={item.done ? 'task-check done' : 'task-check'} key={item.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(item.done)}
                    onChange={() => {
                      if (item.done) {
                        if (!isAdmin && item.done_by && item.done_by !== currentUser) {
                          alert(`只有勾選的人 (${item.done_by}) 可以取消勾選`)
                          return
                        }
                        setLocalChecklist(prev => prev.map(i => i.id === item.id ? { ...i, done: false, done_by: null } : i))
                      } else {
                        setLocalChecklist(prev => prev.map(i => i.id === item.id ? { ...i, done: true, done_by: currentUser } : i))
                      }
                      onToggleChecklist(item.id)
                    }}
                    disabled={isHistorical}
                  />
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {item.text}
                    {item.done_by && <small style={{ fontWeight: 'bold', color: '#fff', background: 'var(--blue)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', whiteSpace: 'nowrap' }}>{item.done_by}</small>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="task-details">
          <span style={task.deadline ? { color: '#ffffff', fontWeight: '900', background: '#ef4444', padding: '3px 10px', borderRadius: '6px', boxShadow: '0 2px 4px rgba(239,68,68,0.3)', display: 'inline-block' } : {}}>
            ⚠️ 截止：{formatDateTime(task.deadline)}
          </span>
          {task.completed_at && <span>完成：{formatDateTime(task.completed_at)}</span>}
        </div>

        {history.length > 0 && (
          <details className="history-details" style={{ marginTop: '15px', width: '100%', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>
            <summary style={{ fontSize: '13px', color: 'var(--blue)', cursor: 'pointer', display: 'inline-block', fontWeight: 'bold' }}>
              📋 點擊查看詳細操作歷程 ({history.length})
            </summary>
            <div style={{ fontSize: '12px', color: 'var(--text)', background: '#fff', padding: '15px', borderRadius: '12px', textAlign: 'left', marginTop: '10px', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
              {history.map((item, index) => (
                <div key={`${item.time}-${index}`} style={{ margin: '8px 0', lineHeight: '1.6', display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px', borderBottom: '1px solid #f1f5f9', paddingBottom: '6px' }}>
                  <span style={{ color: 'var(--blue)', fontWeight: '800' }}>{item.user || '系統'}</span>
                  <span style={{ fontWeight: '500' }}>{item.action}</span>
                  {item.details && (
                    <span style={{ color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: '6px', border: '1px solid #fde68a', fontWeight: '600' }}>
                      {item.details}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '11px' }}>{formatDateTime(item.time)}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {task.category_name === '備忘' && Array.isArray(task.read_by) && task.read_by.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-soft)', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontWeight: '600' }}>已讀：</span>
            {task.read_by.map((uname, idx) => (
              <span key={idx} style={{ background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: '4px' }}>{uname}</span>
            ))}
          </div>
        )}

      </div>

      <div className="task-side-container">
        {images.length > 0 && !isEditing && (
          <div className="task-images-side">
            {images.map((image, index) => (
              <button type="button" onClick={() => onOpenImage(image)} key={`${image}-${index}`}>
                <img src={image} alt={`附件 ${index + 1}`} />
              </button>
            ))}
          </div>
        )}

        <div className="task-actions">
          {!isEditing && (
            <div className="button-group" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', marginBottom: '4px' }}>
              {(!isHistorical) ? (
                <>
                  {(task.category_name === '特殊項目' || task.category_name === '特殊檢驗') && !task.history?.some(h => h.action.includes('收集了檢體')) && (
                    <button type="button" className="icon-text-button collect" disabled={busy} onClick={() => onEdit({ _log_only: '收集了檢體' })}>
                      <Boxes size={18} />
                      收集檢體
                    </button>
                  )}
                  {task.category_name === '特殊項目' && !task.reported_done && (
                    <button type="button" className="icon-text-button" style={{ background: 'var(--green, #16a34a)', color: '#fff' }} disabled={busy} onClick={() => onEdit({ reported_done: true, _log_only: '報告完成' })}>
                      <PackageCheck size={18} />
                      報告完成
                    </button>
                  )}
                  {task.category_name === '特殊項目' && task.reported_done && (
                    <button type="button" className="icon-text-button ghost" disabled={busy} onClick={() => onEdit({ reported_done: false, _log_only: '撤回報告完成' })}>
                      <Undo2 size={18} />
                      撤回報告
                    </button>
                  )}
                  <button
                    className="icon-text-button complete"
                    disabled={busy || (task.category_name === '特殊項目' && !task.reported_done)}
                    title={task.category_name === '特殊項目' && !task.reported_done ? '請先按「報告完成」' : undefined}
                    onClick={() => {
                      if (task.category_name === '備忘') {
                        const readers = Array.isArray(task.read_by) ? task.read_by : []
                        const archivers = Array.isArray(task.archived_by) ? task.archived_by : []
                        
                        if (!readers.includes(currentUser)) {
                          onEdit({ read_by: [...readers, currentUser] })
                        } else if (!archivers.includes(currentUser)) {
                          onEdit({ archived_by: [...archivers, currentUser] })
                        }
                      } else {
                        onDone()
                      }
                    }}
                  >
                    {task.category_name === '備忘' 
                      ? (!(Array.isArray(task.read_by) && task.read_by.includes(currentUser)) ? '標記已讀' : '移至歷史') 
                      : '完成'}
                  </button>
                  <button className="icon-text-button ghost" style={{ padding: '6px 10px' }} disabled={busy} onClick={handleOpenEdit} title="編輯">
                    <Edit2 size={18} />
                  </button>
                  <button className="icon-text-button danger" style={{ padding: '6px 10px' }} disabled={busy} onClick={onVoid} title="作廢">
                    <Trash2 size={18} />
                  </button>
                </>
              ) : (
                <>
                  <button 
                    className="icon-text-button ghost" 
                    disabled={busy} 
                    onClick={() => {
                      if (task.category_name === '備忘') {
                        const archivers = Array.isArray(task.archived_by) ? task.archived_by : []
                        onEdit({ archived_by: archivers.filter(u => u !== currentUser) })
                      } else {
                        onRestore()
                      }
                    }}
                  >
                    撤回
                  </button>
                  {isAdmin && (
                    <button className="icon-text-button danger" style={{ padding: '6px 10px' }} disabled={busy} onClick={onDelete} title="永久刪除">
                      <Trash2 size={18} />
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        
        </div>
      </div>
    </article>
  )
}

function ImageViewer({ image, onClose }) {
  return (
    <div className="image-viewer" role="dialog" aria-modal="true">
      <div className="image-viewer-bar">
        <a className="icon-text-button primary" href={image} download="modern-lab-image.png">
          <Download size={18} />
          下載
        </a>
        <button className="icon-button" type="button" onClick={onClose} title="關閉">
          <X size={20} />
        </button>
      </div>
      <img src={image} alt="放大附件" />
    </div>
  )
}

function SpecimenCard({
  task,
  currentUser,
  isAdmin,
  busy,
  onClaim,
  onReturn,
  onDone,
  onStock,
  onUndoStock,
  onVoid,
  onDelete,
  onEdit,
}) {
  const isMaterial = task.category === '耗材'
  const canClaim = task.status === SPECIMEN_STATUS.lobby && (!isMaterial || task.is_stocked)
  const isMine = task.status === SPECIMEN_STATUS.claimed && task.picker === currentUser
  const isHistorical = task.status === SPECIMEN_STATUS.done || task.status === SPECIMEN_STATUS.voided
  const latestHistory = Array.isArray(task.history) ? task.history.at(-1) : null

  const [isEditing, setIsEditing] = React.useState(false)
  const [editForm, setEditForm] = React.useState({ clinic: task.clinic, category: task.category, deadline: task.deadline || '' })

  function handleSave() {
    onEdit(editForm)
    setIsEditing(false)
  }

  return (
    <article className={`task-row specimen-card ${task.priority ? 'urgent' : ''} status-${task.status}`} style={task.priority ? { borderLeft: '6px solid var(--red)', boxShadow: '0 4px 12px rgba(239, 68, 68, 0.12)', background: 'linear-gradient(to right, #fff8f8, #ffffff)', position: 'relative' } : {}}>
      {task.priority && (
        <div style={{ position: 'absolute', top: '-10px', left: '12px', background: 'var(--red)', color: '#fff', padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '4px', zIndex: 10 }}>
          <AlertCircle size={12} /> 優先處理
        </div>
      )}
      <div className="task-main">
        <div className="task-meta">
          <span className={`category-pill specimen-${task.category || '其他'}`}>{task.category || '其他'}</span>
          <strong style={{ color: 'var(--text)', marginLeft: '4px', marginRight: '8px' }}>{task.creator_name || '系統'}</strong>
          {task.priority && <span className="priority-pill">優先</span>}
          <span>建立：{formatDateTime(task.created_at)}</span>
          {task.deadline && <span style={{ color: 'var(--red)', fontWeight: 'bold' }}>期限：{formatDateTime(task.deadline)}</span>}
        </div>
        
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            <textarea className="field" style={{ minHeight: '60px' }} value={editForm.clinic} onChange={(e) => setEditForm({ ...editForm, clinic: e.target.value })} />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select className="field" style={{ minHeight: '34px', padding: '0 8px' }} value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                {SPECIMEN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="datetime-local" className="field" style={{ minHeight: '34px', padding: '0 8px' }} value={editForm.deadline} onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} />
              <button className="icon-text-button complete" onClick={handleSave}>存檔</button>
              <button className="icon-text-button ghost" onClick={() => setIsEditing(false)}>取消</button>
            </div>
          </div>
        ) : (
          <div className="parsed-content">
            {(task.clinic || task.content).split('\n').map((line, index) => {
              const match = line.match(/^-\s*\[([xX ])\]\s*(.*?)(?:\s*\(@(.*?)\))?$/)
              if (match) {
                const [, char, rawText, owner] = match
                const isChecked = char.toLowerCase() === 'x'
                return (
                  <label key={index} className={isChecked ? 'task-check done' : 'task-check'} style={{ marginTop: '4px', marginBottom: '4px' }}>
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      onChange={() => {
                        if (isChecked) {
                          if (owner && owner !== currentUser) {
                            alert(`只有打勾的人 (${owner}) 可以取消勾選`)
                            return
                          }
                          const lines = (task.clinic || task.content).split('\n')
                          lines[index] = `- [ ] ${rawText}`
                          onEdit({ clinic: lines.join('\n') })
                        } else {
                          const lines = (task.clinic || task.content).split('\n')
                          lines[index] = `- [x] ${rawText} (@${currentUser})`
                          onEdit({ clinic: lines.join('\n') })
                        }
                      }}
                      disabled={isHistorical}
                    />
                    <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <span dangerouslySetInnerHTML={{ __html: migrateToHtml(rawText) }} />
                      {owner && <small style={{ fontWeight: 'bold', color: '#fff', marginLeft: '8px', background: 'var(--blue)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', whiteSpace: 'nowrap' }}>{owner}</small>}
                    </span>
                  </label>
                )
              }
              if (line.includes('<') && line.includes('>')) {
                return <div key={index} dangerouslySetInnerHTML={{ __html: line }} style={{ margin: 0, padding: 0 }} />
              }
              return <h2 key={index} style={{ fontSize: 'inherit', fontWeight: 'inherit', margin: 0, padding: 0 }} dangerouslySetInnerHTML={{ __html: migrateToHtml(line) }} />
            })}
          </div>
        )}

        <div className="task-details">
          {task.creator_name && <span>建立人：{task.creator_name}</span>}
          {task.is_stocked && <span>備貨：{task.stocker || '-'} / {formatDateTime(task.stocked_at)}</span>}
          {task.picker && <span>領取：{task.picker} / {formatDateTime(task.claimed_at)}</span>}
          {task.status === SPECIMEN_STATUS.done && <span>完成：{formatDateTime(task.completed_at)}</span>}
          {task.status === SPECIMEN_STATUS.voided && <span className="danger-text">已作廢</span>}
        </div>
        {latestHistory && (
          <div className="history-line">
            <span style={{ color: 'var(--blue)', fontWeight: '600' }}>{latestHistory.user}</span> {latestHistory.action}
            {latestHistory.details && <span style={{ color: 'var(--text)', background: 'var(--amber-soft)', padding: '0 4px', borderRadius: '4px', margin: '0 4px' }}>({latestHistory.details})</span>}
            <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>/ {formatDateTime(latestHistory.time)}</span>
          </div>
        )}
      </div>

      <div className="task-actions">
        {!isEditing && (
          <>
            <div className="button-group">
              {task.status === SPECIMEN_STATUS.lobby && isMaterial && (
                task.is_stocked ? (
                  <button className="icon-text-button ghost" disabled={busy} onClick={onUndoStock}>取消備貨</button>
                ) : (
                  <button className="icon-text-button stock" disabled={busy} onClick={onStock}>備貨</button>
                )
              )}
              {task.status === SPECIMEN_STATUS.lobby && (
                <button className="icon-text-button primary" disabled={busy || !canClaim} onClick={onClaim}>領取</button>
              )}
              {isMine && (
                <>
                  <button className="icon-text-button complete" disabled={busy} onClick={onDone}>完成</button>
                  <button className="icon-text-button ghost" disabled={busy} onClick={onReturn}>退回</button>
                </>
              )}
              {(isAdmin || task.creator_name === currentUser) && task.status !== SPECIMEN_STATUS.voided && (
                <>
                  <button className="icon-text-button ghost" disabled={busy} onClick={() => setIsEditing(true)}>編輯</button>
                  <button className="icon-text-button danger" disabled={busy} onClick={onVoid}>作廢</button>
                </>
              )}
            </div>
            {isAdmin && (
              <button className="icon-text-button danger" disabled={busy} onClick={onDelete}>
                永久刪除
              </button>
            )}
          </>
        )}
      </div>
    </article>
  )
}

function EmptyState({ title, body }) {
  return (
    <div className="empty-state">
      <Archive size={34} />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}

function PasswordModal({ isOpen, onClose, onUpdate }) {
  const [pwd, setPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    if (pwd.length < 6) {
      alert('密碼長度至少需 6 位數！')
      return
    }
    if (pwd !== confirmPwd) {
      alert('兩次輸入的密碼不一致！')
      return
    }
    onUpdate(pwd)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <h2>修改登入密碼</h2>
          <button className="close-button" onClick={onClose}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div className="field-group">
            <label className="label">新密碼</label>
            <input 
              type="password" 
              className="field" 
              value={pwd} 
              onChange={e => setPwd(e.target.value)} 
              placeholder="請輸入新密碼 (至少 6 位)"
              required 
            />
          </div>
          <div className="field-group">
            <label className="label">確認新密碼</label>
            <input 
              type="password" 
              className="field" 
              value={confirmPwd} 
              onChange={e => setConfirmPwd(e.target.value)} 
              placeholder="請再次輸入新密碼"
              required 
            />
          </div>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '-5px' }}>
            💡 修改後，新系統與舊版檢體系統將同步使用此密碼。
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button type="button" className="icon-text-button ghost" style={{ flex: 1 }} onClick={onClose}>取消</button>
            <button type="submit" className="icon-text-button primary" style={{ flex: 1 }}>
              <ShieldCheck size={18} /> 確認修改
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ChatBoard({ currentUser, session, onResetUnread }) {
  const [messages, setMessages] = useState([])
  const [inputMsg, setInputMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const messagesEndRef = React.useRef(null)
  const lastReadRef = React.useRef(null) // 進入時的已讀時間戳，用於顯示分隔線
  const hasMarkedRead = React.useRef(false)

  useEffect(() => {
    // 讀取上次已讀時間
    const lastReadKey = `chat_lastRead_${session?.user?.id}`
    lastReadRef.current = localStorage.getItem(lastReadKey) || null

    fetchMessages()

    const channel = supabase
      .channel('chat-room')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        setMessages(prev => [...prev, payload.new])
        setTimeout(() => scrollToBottom(), 100)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      // 離開留言板時，標記所有訊息為已讀
      markAllRead()
    }
  }, [])

  function markAllRead() {
    if (!session?.user?.id) return
    const lastReadKey = `chat_lastRead_${session.user.id}`
    localStorage.setItem(lastReadKey, new Date().toISOString())
    if (onResetUnread) onResetUnread()
  }

  async function fetchMessages() {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    
    if (error) {
      console.error('Error fetching messages:', error)
    } else {
      setMessages((data || []).reverse())
      setTimeout(() => {
        scrollToBottom()
        // 載入完成後延遲標記已讀
        setTimeout(() => {
          if (!hasMarkedRead.current) {
            markAllRead()
            hasMarkedRead.current = true
          }
        }, 1500)
      }, 100)
    }
    setLoading(false)
  }

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!inputMsg.trim()) return

    const msgToSend = inputMsg.trim()
    setInputMsg('')

    const { error } = await supabase.from('messages').insert([{
      content: msgToSend,
      creator_name: currentUser,
      creator_id: session?.user?.id
    }])

    if (error) {
      alert(`發送失敗: ${error.message}`)
      setInputMsg(msgToSend)
    }
  }

  // 判斷某則訊息是否為未讀分隔線的位置
  function isFirstUnread(msg, index) {
    if (!lastReadRef.current) return false
    if (msg.creator_id === session?.user?.id) return false // 自己的訊息不算
    const msgTime = new Date(msg.created_at).getTime()
    const lastReadTime = new Date(lastReadRef.current).getTime()
    if (msgTime <= lastReadTime) return false
    // 確認是第一條未讀（前面的都已讀或是自己的）
    for (let i = 0; i < index; i++) {
      const prev = messages[i]
      if (prev.creator_id === session?.user?.id) continue
      const prevTime = new Date(prev.created_at).getTime()
      if (prevTime > lastReadTime) return false // 前面已有未讀
    }
    return true
  }

  return (
    <div className="chat-board-container">
      <section className="work-header" style={{ marginBottom: '0', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
        <div>
          <p className="eyebrow">全體交流</p>
          <h1>留言板</h1>
        </div>
      </section>

      <div className="chat-messages-area">
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>載入中...</div>
        ) : messages.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>目前還沒有人留言，來打聲招呼吧！</div>
        ) : (
          messages.map((msg, index) => {
            const isMe = msg.creator_id === session?.user?.id
            const showUnreadDivider = isFirstUnread(msg, index)
            return (
              <React.Fragment key={msg.id}>
                {showUnreadDivider && (
                  <div className="chat-unread-divider">
                    <span>以下為未讀訊息</span>
                  </div>
                )}
                <div className={`chat-bubble-wrapper ${isMe ? 'is-me' : 'is-other'}`}>
                  {!isMe && <div className="chat-avatar">{msg.creator_name.charAt(0)}</div>}
                  <div className="chat-bubble-content">
                    {!isMe && <div className="chat-sender-name">{msg.creator_name}</div>}
                    <div className="chat-bubble">
                      {msg.content}
                    </div>
                    <div className="chat-time">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSend}>
        <input 
          type="text" 
          value={inputMsg} 
          onChange={e => setInputMsg(e.target.value)} 
          placeholder="輸入留言..." 
          autoComplete="off"
        />
        <button type="submit" disabled={!inputMsg.trim()} className="icon-button" style={{ background: inputMsg.trim() ? 'var(--blue)' : 'var(--border)', color: '#fff', border: 'none' }}>
          <Send size={18} />
        </button>
      </form>
    </div>
  )
}

export default App
