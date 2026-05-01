import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import AdminPanel from './components/AdminPanel'
import TaskModal from './components/TaskModal'
import LegacySpecimen from './components/LegacySpecimen'
import {
  AlertCircle,
  Archive,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  PackageCheck,
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
  Edit2,
  Trash2,
} from 'lucide-react'
import { db } from './components/LegacySpecimen'
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore'

const GENERAL_TABS = [
  { id: 'all', label: '總覽', icon: LayoutDashboard },
  { id: '交接', label: '交接', icon: ClipboardList },
  { id: '備忘', label: '備忘', icon: FileText },
  { id: '待辦', label: '待辦', icon: AlertCircle },
  { id: '特殊項目', label: '特殊項目', icon: Star },
  { id: 'history', label: '歷史', icon: ClipboardCheck },
]

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

function appendHistory(task, action, user) {
  const history = Array.isArray(task.history) ? task.history : []
  return [
    ...history,
    {
      action,
      user,
      time: new Date().toISOString(),
    },
  ]
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
  const [modalCategory, setModalCategory] = useState('待辦')
  const [tasks, setTasks] = useState([])
  const [taskError, setTaskError] = useState('')
  const [module, setModule] = useState('general')
  const [activeTab, setActiveTab] = useState('all')
  const [query, setQuery] = useState('')
  const [searchStartDate, setSearchStartDate] = useState('')
  const [searchEndDate, setSearchEndDate] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const [previewImage, setPreviewImage] = useState(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)

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

  async function fetchProfile(uid) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', uid)
        .maybeSingle()

      if (error) console.error('Error fetching profile:', error)
      setProfile(data)
    } finally {
      setLoading(false)
    }
  }

  async function fetchTasks() {
    setTaskError('')
    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (searchStartDate) {
      const start = `${searchStartDate}T00:00:00.000Z`
      query = query.gte('created_at', start)
    }
    if (searchEndDate) {
      const end = `${searchEndDate}T23:59:59.999Z`
      query = query.lte('created_at', end)
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
    setUpdatingId(task.id)
    const { error } = await supabase.from('tasks').update(patch).eq('id', task.id)

    if (error) {
      alert(`${fallbackMessage}：${error.message}`)
    } else {
      await fetchTasks()
    }
    setUpdatingId(null)
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
    const nextChecklist = checklist.map((item) => (
      item.id === itemId ? { ...item, done: !item.done } : item
    ))
    await updateTask(task, {
      checklist: nextChecklist,
      history: appendHistory(task, `${target?.done ? '取消勾選' : '勾選完成'}：${target?.text || '項目'}`, name),
      updated_at: new Date().toISOString(),
    }, '更新勾選項目失敗')
  }

  async function voidGeneralTask(task) {
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
    await updateTask(task, {
      ...patch,
      history: appendHistory(task, '修改內容', name),
      updated_at: new Date().toISOString()
    }, '修改失敗')
  }

  function openCreateModal(category = '待辦') {
    setModalCategory(category)
    setShowTaskModal(true)
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <RefreshCw className="spin" size={28} />
        <span>系統載入中</span>
      </div>
    )
  }

  if (!session) return <Login />

  if (showAdmin && profile?.role === 'admin') {
    return <AdminPanel onClose={() => setShowAdmin(false)} />
  }

  const isAdmin = profile?.role === 'admin'
  const name = profile?.display_name || displayNameFromSession(session)
  const generalTasks = tasks.filter((task) => !isSpecimenTask(task))
  const specimenTasks = tasks.filter(isSpecimenTask)

  return (
    <div className="app-shell">
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
            onTabChange={setActiveTab}
            onQueryChange={setQuery}
            onStartDateChange={setSearchStartDate}
            onEndDateChange={setSearchEndDate}
            onCreate={openCreateModal}
            onDone={(task) => updateGeneralStatus(task, STATUS_DONE)}
            onRestore={(task) => updateGeneralStatus(task, 0)}
            onToggleChecklist={(task, itemId) => toggleChecklistItem(task, itemId)}
            onVoid={voidGeneralTask}
            onDelete={deleteGeneralTask}
            onEdit={editGeneralTask}
            isAdmin={isAdmin}
            onOpenImage={setPreviewImage}
          />
        ) : (
          <LegacySpecimen
            currentUser={name}
            isAdmin={isAdmin}
          />
        )}
      </main>

      {showTaskModal && (
        <TaskModal
          isOpen={showTaskModal}
          onClose={() => setShowTaskModal(false)}
          creatorId={session.user.id}
          creatorName={name}
          defaultCategory={modalCategory}
          onTaskAdded={fetchTasks}
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
  onDone,
  onRestore,
  onToggleChecklist,
  onVoid,
  onDelete,
  onEdit,
  isAdmin,
  onOpenImage,
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
      special: openTasks.filter((task) => task.category_name === '特殊項目').length,
      done: tasks.filter((task) => task.status !== 0).length,
      urgent: openTasks.filter((task) => task.priority).length,
    }
  }, [tasks, name])

  const filteredTasks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tasks.filter((task) => {
      const isClosed = task.status === STATUS_DONE || task.status === STATUS_VOIDED
      const isArchivedByMe = Array.isArray(task.archived_by) && task.archived_by.includes(name)
      const isReadByMe = Array.isArray(task.read_by) && task.read_by.includes(name)

      const matchesTab = (() => {
        if (activeTab === 'all') {
          if (task.category_name === '備忘') return task.status === 0 && !isArchivedByMe && !isReadByMe
          return task.status === 0 && !isArchivedByMe
        }
        if (activeTab === 'history') {
          if (task.category_name === '備忘') return isArchivedByMe
          return isClosed
        }
        if (activeTab === '備忘') {
          return task.category_name === '備忘' && task.status === 0 && !isArchivedByMe
        }
        return task.status === 0 && task.category_name === activeTab
      })()

      const searchable = [task.content, task.category_name, task.deadline]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return matchesTab && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [activeTab, query, tasks])

  return (
    <>
      <section className="work-header">
        <div>
          <p className="eyebrow">今日工作清單</p>
          <h1>
            {name}，目前有 {stats.handoff + stats.memo + stats.todo + stats.special} 件未完成事項
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
          {GENERAL_TABS.map((tab) => {
            const Icon = tab.icon
            let count = 0
            if (tab.id === 'all') count = stats.handoff + stats.memo + stats.todo + stats.special
            if (tab.id === '交接') count = stats.handoff
            if (tab.id === '備忘') count = stats.memo
            if (tab.id === '待辦') count = stats.todo
            if (tab.id === '特殊項目') count = stats.special
            return (
              <button
                key={tab.id}
                className={activeTab === tab.id ? 'tab active' : 'tab'}
                onClick={() => onTabChange(tab.id)}
                type="button"
              >
                <Icon size={16} />
                {tab.label}
                {count > 0 && <span style={{ background: 'var(--red)', color: 'white', padding: '2px 6px', borderRadius: '10px', fontSize: '11px', marginLeft: '4px' }}>{count}</span>}
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
              onOpenImage={onOpenImage}
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
    return onUpdate(task, {
      ...patch,
      history: appendHistory(task, action, currentUser),
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

function TaskRow({ task, busy, isAdmin, currentUser, onDone, onRestore, onToggleChecklist, onVoid, onDelete, onEdit, onOpenImage }) {
  const isDone = task.status === STATUS_DONE
  const isVoided = task.status === STATUS_VOIDED
  const isHistorical = isDone || isVoided || (task.category_name === '備忘' && Array.isArray(task.archived_by) && task.archived_by.includes(currentUser))
  const images = Array.isArray(task.image_urls) ? task.image_urls : []
  const checklist = Array.isArray(task.checklist) ? task.checklist : []
  const history = Array.isArray(task.history) ? task.history : []

  const [isEditing, setIsEditing] = React.useState(false)
  const [editForm, setEditForm] = React.useState({ content: task.content, category_name: task.category_name, deadline: task.deadline || '' })
  const [localContent, setLocalContent] = React.useState(task.content)

  React.useEffect(() => {
    setLocalContent(task.content)
  }, [task.content])

  function handleSave() {
    onEdit(editForm)
    setIsEditing(false)
  }

  const [localChecklist, setLocalChecklist] = React.useState(checklist)

  React.useEffect(() => {
    setLocalChecklist(checklist)
  }, [checklist])

  return (
    <article className={`task-row ${task.category_name || ''} ${isVoided ? 'voided' : ''}`}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            <textarea className="field" style={{ minHeight: '60px' }} value={editForm.content} onChange={(e) => setEditForm({ ...editForm, content: e.target.value })} />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input type="datetime-local" className="field" style={{ minHeight: '34px', padding: '0 8px' }} value={editForm.deadline} onChange={(e) => setEditForm({ ...editForm, deadline: e.target.value })} />
              <button className="icon-text-button complete" onClick={handleSave}>存檔</button>
              <button className="icon-text-button ghost" onClick={() => setIsEditing(false)}>取消</button>
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
                      {rawText}
                      {owner && <small style={{ fontWeight: 'bold', color: '#fff', background: 'var(--blue)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', whiteSpace: 'nowrap' }}>{owner}</small>}
                    </span>
                  </label>
                )
              }
              return <h2 key={index} style={{ fontSize: 'inherit', fontWeight: 'inherit', margin: 0, padding: 0 }}>{line}</h2>
            })}
          </div>
        )}

        {localChecklist.length > 0 && (
          <div className="task-checklist">
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-muted)', marginBottom: '8px', borderTop: '1px dashed var(--border)', paddingTop: '12px' }}>
              📝 附加項目
            </div>
            {localChecklist.map((item) => (
              <label className={item.done ? 'task-check done' : 'task-check'} key={item.id}>
                <input
                  type="checkbox"
                  checked={Boolean(item.done)}
                  onChange={() => {
                    setLocalChecklist(prev => prev.map(i => i.id === item.id ? { ...i, done: !i.done } : i))
                    onToggleChecklist(item.id)
                  }}
                  disabled={isHistorical || (!isAdmin && task.creator_name !== currentUser)}
                />
                <span>{item.text}</span>
              </label>
            ))}
          </div>
        )}
        <div className="task-details">
          <span>截止：{formatDateTime(task.deadline)}</span>
          {task.completed_at && <span>完成：{formatDateTime(task.completed_at)}</span>}
        </div>
        {task.category_name === '備忘' && Array.isArray(task.read_by) && task.read_by.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-soft)', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontWeight: '600' }}>已讀：</span>
            {task.read_by.map((uname, idx) => (
              <span key={idx} style={{ background: 'rgba(0,0,0,0.05)', padding: '1px 5px', borderRadius: '4px' }}>{uname}</span>
            ))}
          </div>
        )}
        {history.length > 0 && (
          <details className="history-details">
            <summary>操作紀錄 {history.length}</summary>
            <div>
              {history.map((item, index) => (
                <p key={`${item.time}-${index}`}>
                  {item.action} / {item.user || '-'} / {formatDateTime(item.time)}
                </p>
              ))}
            </div>
          </details>
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
          <>
            {(!isHistorical) ? (
              <div style={{ display: 'flex', gap: '5px' }}>
                <button 
                  className="icon-text-button complete" 
                  disabled={busy} 
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
                <button className="icon-text-button ghost" style={{ padding: '6px 10px' }} disabled={busy} onClick={() => setIsEditing(true)} title="編輯">
                  <Edit2 size={18} />
                </button>
                <button className="icon-text-button danger" style={{ padding: '6px 10px' }} disabled={busy} onClick={onVoid} title="作廢">
                  <Trash2 size={18} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '5px' }}>
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
              </div>
            )}
          </>
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
    <article className={`task-row specimen-card ${task.priority ? 'urgent' : ''} status-${task.status}`}>
      <div className="task-main">
        <div className="task-meta">
          <span className={`category-pill specimen-${task.category || '其他'}`}>{task.category || '其他'}</span>
          <strong style={{ color: 'var(--text)', marginLeft: '4px', marginRight: '8px' }}>{task.creator_name || '系統'}</strong>
          {task.priority && <span className="priority-pill">優先</span>}
          <span>建立：{formatDateTime(task.created_at)}</span>
          {task.deadline && <span>期限：{formatDateTime(task.deadline)}</span>}
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
                      {rawText}
                      {owner && <small style={{ fontWeight: 'bold', color: '#fff', marginLeft: '8px', background: 'var(--blue)', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', whiteSpace: 'nowrap' }}>{owner}</small>}
                    </span>
                  </label>
                )
              }
              return <h2 key={index} style={{ fontSize: 'inherit', fontWeight: 'inherit', margin: 0, padding: 0 }}>{line}</h2>
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
            {latestHistory.action}：{latestHistory.user} / {formatDateTime(latestHistory.time)}
          </div>
        )}
      </div>

      <div className="task-actions">
        {!isEditing && (
          <>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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

export default App
