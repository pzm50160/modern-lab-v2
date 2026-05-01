import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, updateDoc, doc, serverTimestamp, getDocs, where, deleteDoc } from 'firebase/firestore';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "AIzaSyCaxWnFi78Rrra5gEuFRWPN-4jdEUFWLp8",
  authDomain: "modern-lab-app.firebaseapp.com",
  projectId: "modern-lab-app",
  storageBucket: "modern-lab-app.firebasestorage.app",
  messagingSenderId: "154018152899",
  appId: "1:154018152899:web:21c8435ed7e68221b13d76"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const messaging = getMessaging(app);

const getTodayStr = () => new Date().toLocaleDateString('en-CA');

const getTaskCardColors = (cat, priority, isDeleted) => {
  if (isDeleted) return { bg: '#f5f5f5', border: '#d9d9d9', text: '#bfbfbf' };
  if (priority) return { bg: '#fff1f0', border: '#ff4d4f', text: '#cf1322' };
  const config = {
    '收檢': { bg: '#fff7e6', border: '#ffa940', text: '#d46b08' },
    '耗材': { bg: '#f6ffed', border: '#73d13d', text: '#389e0d' },
    '其他': { bg: '#f0f5ff', border: '#91d5ff', text: '#1d39c4' }
  };
  return config[cat] || { bg: '#f9f0ff', border: '#d3adf7', text: '#722ed1' };
};

export default function LegacySpecimen({ currentUser, isAdmin }) {
  const [tasks, setTasks] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeTab, setActiveTab] = useState('lobby');
  
  const [form, setForm] = useState({ clinic: '', category: '收檢', priority: false, deadline: '' });
  
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState(getTodayStr());
  const [historyEndDate, setHistoryEndDate] = useState(getTodayStr());
  
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ clinic: '', category: '', deadline: '' });

  useEffect(() => {
    if (activeTab === 'history') {
      setHistoryStartDate(getTodayStr());
      setHistoryEndDate(getTodayStr());
      setHistorySearchTerm('');
    }
  }, [activeTab]);

  useEffect(() => {
    if (currentUser) {
      console.log("[Firebase] 偵測到使用者，確保帳號與 Token...");
      ensureUserAndSetupNotifications(currentUser);
    }
  }, [currentUser]);

  const ensureUserAndSetupNotifications = async (name) => {
    try {
      const q = query(collection(db, "users"), where("name", "==", name));
      const snap = await getDocs(q);
      
      let userDocId;
      let oldToken = '';

      if (snap.empty) {
        const docRef = await addDoc(collection(db, "users"), { name, role: isAdmin ? 'admin' : 'user' });
        userDocId = docRef.id;
      } else {
        const userDoc = snap.docs[0];
        userDocId = userDoc.id;
        oldToken = userDoc.data().fcmToken || '';
      }

      let currentPermission = 'Notification' in window ? Notification.permission : 'denied';
      if ('Notification' in window && (!oldToken || currentPermission !== 'granted')) {
        currentPermission = await Notification.requestPermission();
      }

      if (currentPermission === 'granted') {
        const registration = await navigator.serviceWorker.ready;
        const newToken = await getToken(messaging, { 
          vapidKey: 'BEQDpcx_iPGyzx-0-e_vctw5TqCseajRjCHCE9XeRi4TIfXEk5ndC-XwRyJFYuSmrTxej_zweULO6ib3DGbYCeE',
          serviceWorkerRegistration: registration 
        });
        
        if (newToken && newToken !== oldToken) {
          await updateDoc(doc(db, "users", userDocId), { 
            fcmToken: newToken,
            lastTokenUpdate: serverTimestamp() 
          });
          console.log("Token 已同步至 Firebase 雲端");
        }
      }
    } catch (error) {
      console.error("推播設定錯誤:", error);
    }
  };

  useEffect(() => {
    const unsubMessage = onMessage(messaging, (payload) => {
      console.log("收到前景訊息封包:", payload);
      if (payload.notification) {
        alert(`${payload.notification.title}\n${payload.notification.body}`);
      } else if (payload.data && payload.data.body) {
        alert(`${payload.data.title || '🚨 實驗室新任務'}\n${payload.data.body}`);
      }
    });

    const qTasks = query(collection(db, "tasks"), orderBy("createdAt", "desc"));
    const unsubTasks = onSnapshot(qTasks, (s) => setTasks(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    const qCats = query(collection(db, "categories"), orderBy("name", "asc"));
    const unsubCats = onSnapshot(qCats, (s) => setCategories(s.docs.map(d => ({ id: d.id, ...d.data() }))));
    
    return () => { unsubTasks(); unsubCats(); unsubMessage(); };
  }, [currentUser]);

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!form.clinic) return;
    try {
      await addDoc(collection(db, "tasks"), {
        ...form, status: 0, creator: currentUser, createdAt: serverTimestamp(), picker: '', history: []
      });
      setForm({ clinic: '', category: '收檢', priority: false, deadline: '' });
    } catch (err) { console.error("發布失敗", err); }
  };

  const updateStatus = async (task, newStatus) => {
    const data = { status: newStatus };
    const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });
    if (newStatus === 1) { data.picker = currentUser; data.claimedAt = serverTimestamp(); }
    else if (newStatus === 2) { data.completedAt = serverTimestamp(); }
    else if (newStatus === 0) {
      if (!window.confirm("確定退回？")) return;
      data.picker = ''; data.claimedAt = null;
      data.history = [...(task.history || []), `⚠️ ${currentUser} 於 ${nowStr} 退回` ];
    }
    await updateDoc(doc(db, "tasks", task.id), data);
  };

  const updateStocking = async (task) => {
    const data = {
      isStocked: true,
      stocker: currentUser,
      stockedAt: serverTimestamp()
    };
    await updateDoc(doc(db, "tasks", task.id), data);
  };

  const undoStocking = async (task) => {
    if (!window.confirm("確定退回備貨？")) return;
    const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });
    const log = `⚠️ ${currentUser} 於 ${nowStr} 退回備貨`;
    await updateDoc(doc(db, "tasks", task.id), {
      isStocked: false,
      stocker: '',
      stockedAt: null,
      history: [...(task.history || []), log]
    });
  };

  const saveEdit = async (task) => {
    const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });
    const log = `✏️ ${currentUser} 於 ${nowStr} 修改內容`;
    await updateDoc(doc(db, "tasks", task.id), { ...editForm, history: [...(task.history || []), log] });
    setEditingId(null);
  };

  const handleDeleteTask = async (task) => {
    if (isAdmin) {
      if (!window.confirm(`管理員「${currentUser}」您好，確定要「永久刪除」此任務嗎？（此動作後資料將直接消失，無法恢復）`)) return;
      await deleteDoc(doc(db, "tasks", task.id));
    } else {
      if (!window.confirm("確定刪除此任務？刪除後將移至歷史記錄。")) return;
      const nowStr = new Date().toLocaleString('zh-TW', { hour12: false });
      const log = `🗑️ ${currentUser} 於 ${nowStr} 刪除任務`;
      await updateDoc(doc(db, "tasks", task.id), { status: 3, history: [...(task.history || []), log] });
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '...';
    return ts.toDate().toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const getSortedTasks = (taskList) => {
    const weights = { '收檢': 1, '耗材': 2, '其他': 3 };
    return [...taskList].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      const wa = weights[a.category] || 99, wb = weights[b.category] || 99;
      if (wa !== wb) return wa - wb;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
  };

  const filteredHistory = tasks.filter(t => {
    if (t.status !== 1 && t.status !== 2 && t.status !== 3) return false; 
    const matchesKeyword = t.clinic?.toLowerCase().includes(historySearchTerm.toLowerCase()) || 
      t.creator?.toLowerCase().includes(historySearchTerm.toLowerCase()) ||
      t.picker?.toLowerCase().includes(historySearchTerm.toLowerCase());
    const compareDateTs = t.completedAt || t.createdAt;
    if (!compareDateTs) return false;
    const taskDateStr = compareDateTs.toDate().toISOString().split('T')[0];
    return matchesKeyword && (taskDateStr >= historyStartDate && taskDateStr <= historyEndDate);
  });

  const lobbyCount = tasks.filter(t => t.status === 0).length;
  const myTasksCount = tasks.filter(t => t.status === 1 && t.picker === currentUser).length;

  return (
    <div style={styles.mobileWrapper}>
      <nav style={styles.tabNav}>
        <button onClick={() => setActiveTab('lobby')} style={activeTab === 'lobby' ? styles.activeTab : styles.tab}>大廳 {lobbyCount > 0 && <span style={styles.badge}>{lobbyCount}</span>}</button>
        <button onClick={() => setActiveTab('myTasks')} style={activeTab === 'myTasks' ? styles.activeTab : styles.tab}>我的 {myTasksCount > 0 && <span style={styles.badgeMy}>{myTasksCount}</span>}</button>
        <button onClick={() => setActiveTab('history')} style={activeTab === 'history' ? styles.activeTab : styles.tab}>歷史搜尋</button>
      </nav>

      {activeTab === 'lobby' && (
        <section>
          <div style={styles.formBox}>
            <textarea value={form.clinic} onChange={e => setForm({...form, clinic: e.target.value})} placeholder="請輸入任務內容" style={styles.textarea} />
            <div style={styles.row}>
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} style={styles.select}>
                <option value="收檢">收檢</option><option value="耗材">耗材</option><option value="其他">其他</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <label style={{color:'red', display:'flex', alignItems:'center', gap:'5px'}}>
                <input type="checkbox" checked={form.priority} onChange={e => setForm({...form, priority: e.target.checked})} /> 緊急
              </label>
            </div>
            <div style={styles.row}>
              <span style={{fontSize:'14px', color:'#666'}}>限時：</span>
              <input type="time" value={form.deadline} onChange={e => setForm({...form, deadline: e.target.value})} style={styles.timeInput} />
              <button onClick={handleAddTask} style={styles.blueBtnSmall}>發布任務</button>
            </div>
          </div>
          {getSortedTasks(tasks.filter(t => t.status === 0)).map(t => (
            <TaskCard key={t.id} task={t} userName={currentUser} isAdmin={isAdmin} onClaim={() => updateStatus(t, 1)} onCancel={() => updateStatus(t, 0)} onComplete={() => updateStatus(t, 2)} onDelete={() => handleDeleteTask(t)} onEdit={() => {setEditingId(t.id); setEditForm({clinic: t.clinic, category: t.category, deadline: t.deadline || ''});}} isEditing={editingId === t.id} editForm={editForm} setEditForm={setEditForm} saveEdit={() => saveEdit(t)} cancelEdit={() => setEditingId(null)} formatTime={formatTime} cats={categories} onStock={() => updateStocking(t)} onUndoStock={() => undoStocking(t)} />
          ))}
        </section>
      )}

      {activeTab === 'myTasks' && getSortedTasks(tasks.filter(t => t.status === 1 && t.picker === currentUser)).map(t => (
        <TaskCard key={t.id} task={t} userName={currentUser} isAdmin={isAdmin} onCancel={() => updateStatus(t, 0)} onComplete={() => updateStatus(t, 2)} formatTime={formatTime} />
      ))}
      
      {activeTab === 'history' && (
        <section>
          <div style={styles.searchContainer}>
            <input type="text" placeholder="🔍 搜尋關鍵字..." value={historySearchTerm} onChange={e => setHistorySearchTerm(e.target.value)} style={styles.searchInput} />
            <div style={{display:'flex', flexWrap:'wrap', alignItems:'center', gap:'8px', marginTop:'10px'}}>
              <div style={{display:'flex', alignItems:'center', gap:'5px'}}>
                <span style={{fontSize:'12px', color:'#666'}}>從:</span>
                <input type="date" value={historyStartDate} onChange={e => setHistoryStartDate(e.target.value)} style={styles.dateInputSmall} />
              </div>
              <div style={{display:'flex', alignItems:'center', gap:'5px'}}>
                <span style={{fontSize:'12px', color:'#666'}}>至:</span>
                <input type="date" value={historyEndDate} onChange={e => setHistoryEndDate(e.target.value)} style={styles.dateInputSmall} />
              </div>
              <button onClick={() => {
                setHistorySearchTerm(''); setHistoryStartDate(getTodayStr()); setHistoryEndDate(getTodayStr());
              }} style={styles.clearBtn}>重置今天</button>
            </div>
          </div>
          {filteredHistory.length > 0 ? filteredHistory.map(t => (
            <TaskCard key={t.id} task={t} userName={currentUser} isAdmin={isAdmin} formatTime={formatTime} isHistory onDelete={() => handleDeleteTask(t)} />
          )) : <div style={{textAlign:'center', padding:'40px', color:'#999'}}>今天尚無歷史任務</div>}
        </section>
      )}
    </div>
  );
}

const TaskCard = ({ task, userName, isAdmin, onClaim, onCancel, onComplete, onDelete, onEdit, isEditing, editForm, setEditForm, saveEdit, cancelEdit, formatTime, isHistory, cats, onStock, onUndoStock }) => {
  const isDeleted = task.status === 3;
  const colors = getTaskCardColors(isEditing ? editForm.category : task.category, task.priority, isDeleted);
  return (
    <div style={{...styles.card, backgroundColor: colors.bg, border: `1px solid ${colors.border}`, borderLeft: `8px solid ${colors.border}`}}>
      <div style={{flex: 1, minWidth: 0}}>
        {isEditing ? (
          <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
            <textarea style={styles.textareaSmall} value={editForm.clinic} onChange={e => setEditForm({...editForm, clinic: e.target.value})} />
            <div style={{display:'flex', gap:'5px'}}>
              <select style={styles.selectSmall} value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})}>
                <option value="收檢">收檢</option><option value="耗材">耗材</option><option value="其他">其他</option>
                {cats?.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <button onClick={saveEdit} style={styles.saveBtn}>存檔</button>
              <button onClick={cancelEdit} style={styles.cancelBtn}>✕</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{fontSize:'18px', fontWeight:'bold', color: colors.text, marginBottom:'8px', whiteSpace:'pre-wrap', wordBreak:'break-word', textDecoration: isDeleted ? 'line-through' : 'none'}}>
              {isDeleted && "【已刪除】"} {task.priority && "🚨 "}[{task.category}] {task.clinic}
            </div>
            <div style={styles.details}>
              {task.deadline && <span style={{color:'#d4380d', fontWeight:'bold'}}>⏰ 限時: {task.deadline} | </span>}
              <div>📝 發布: {task.creator} | {formatTime(task.createdAt)}</div>
              {task.isStocked && <div style={{color:'#722ed1', fontWeight:'bold'}}>📦 備貨: {task.stocker} | {formatTime(task.stockedAt)}</div>}
              {task.picker && <div style={{color:'#0056b3', fontWeight:'bold'}}>🏃 接單: {task.picker} | {formatTime(task.claimedAt)}</div>}
              {task.status === 2 && <div style={{color:'green', fontWeight:'bold'}}>✅ 完成: {formatTime(task.completedAt)}</div>}
              {task.history && task.history.length > 0 && (
                <div style={{marginTop:'5px', color:'#666', fontStyle:'italic', fontSize:'12px', borderTop:'1px dashed #ccc', paddingTop:'3px'}}>
                  {task.history[task.history.length - 1]}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div style={styles.actionArea}>
        {!isEditing && (
          <div style={{display:'flex', flexDirection:'column', gap:'5px', alignItems:'center'}}>
            {task.status === 0 && !isHistory && (
              <>
                {task.category === "耗材" && (
                  <div style={{display:'flex', gap:'5px', width:'100%'}}>
                    <button 
                      onClick={onStock} 
                      disabled={task.isStocked}
                      style={task.isStocked ? styles.stockedBtn : styles.stockBtn}
                    >
                      {task.isStocked ? '已備貨' : '備貨'}
                    </button>
                    {task.isStocked && (
                      <button onClick={onUndoStock} style={styles.undoStockBtn}>✕</button>
                    )}
                  </div>
                )}
                <button 
                  onClick={onClaim} 
                  disabled={task.category === "耗材" && !task.isStocked}
                  style={(task.category === "耗材" && !task.isStocked) ? styles.disabledBtn : styles.claimBtn}
                >
                  接單
                </button>
              </>
            )}
            {task.status === 1 && task.picker === userName && (
              <div style={{display:'flex', flexDirection:'column', gap:'5px'}}>
                <button onClick={onComplete} style={styles.doneBtn}>完成</button>
                <button onClick={onCancel} style={styles.undoBtn}>退回</button>
              </div>
            )}
            <div style={{marginTop:'5px'}}>
               {!isHistory && <button onClick={onEdit} style={styles.iconBtn}>✏️</button>}
               {(task.creator === userName || isAdmin) && <button onClick={onDelete} style={styles.iconBtn}>🗑️</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  mobileWrapper: { maxWidth: '100%', margin: '0', padding: '10px 0', backgroundColor: 'transparent', minHeight: 'auto', fontFamily: 'sans-serif' },
  tabNav: { display: 'flex', gap: '5px', marginBottom: '15px' },
  tab: { flex: 1, padding: '12px 5px', border: 'none', background: '#fff', borderRadius: '8px', fontSize: '16px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
  activeTab: { flex: 1, padding: '12px 5px', border: 'none', background: '#003366', color: '#fff', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold' },
  badge: { background: '#ff4d4f', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '12px', marginLeft: '3px' },
  badgeMy: { background: '#1890ff', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '12px', marginLeft: '3px' },
  formBox: { backgroundColor: '#fff', padding: '15px', borderRadius: '12px', marginBottom: '15px', boxShadow:'0 2px 4px rgba(0,0,0,0.05)' },
  textarea: { width:'100%', padding: '10px', fontSize: '16px', borderRadius: '8px', border: '1px solid #ddd', minHeight: '80px', boxSizing:'border-box' },
  textareaSmall: { width:'100%', padding: '5px', fontSize: '14px', borderRadius: '5px', border: '1px solid #ccc', boxSizing:'border-box' },
  row: { display: 'flex', gap: '10px', alignItems:'center', marginTop: '10px' },
  select: { padding: '8px', fontSize: '14px', borderRadius: '5px', flex:1 },
  selectSmall: { padding: '5px', fontSize: '12px', borderRadius: '5px', flex:1 },
  timeInput: { padding: '8px', fontSize: '14px', borderRadius: '5px', border: '1px solid #ddd' },
  blueBtnSmall: { padding: '8px 20px', backgroundColor: '#003366', color: '#fff', border: 'none', borderRadius: '5px', fontWeight: 'bold' },
  searchContainer: { background: '#fff', padding: '15px', borderRadius: '10px', marginBottom: '10px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
  searchInput: { width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #ddd', boxSizing: 'border-box' },
  dateInputSmall: { padding: '5px', fontSize: '12px', borderRadius: '5px', border: '1px solid #ccc' },
  clearBtn: { padding: '5px 10px', backgroundColor: '#eee', border: 'none', borderRadius: '5px', fontSize: '12px' },
  card: { padding: '12px', borderRadius: '10px', marginBottom: '10px', display: 'flex', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' },
  details: { fontSize: '13px', color: '#666', lineHeight: '1.6' },
  actionArea: { marginLeft: '10px', textAlign: 'center', minWidth:'80px' },
  claimBtn: { padding: '10px 15px', backgroundColor: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', width:'100%', cursor: 'pointer' },
  stockBtn: { padding: '10px 15px', backgroundColor: '#722ed1', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', width:'100%', cursor: 'pointer' },
  stockedBtn: { padding: '10px 15px', backgroundColor: '#d9d9d9', color: '#8c8c8c', border: 'none', borderRadius: '8px', fontWeight: 'bold', width:'100%' },
  undoStockBtn: { padding: '5px 10px', backgroundColor: '#ffccc7', color: '#a8071a', border: '1px solid #ff4d4f', borderRadius: '5px', cursor: 'pointer' },
  disabledBtn: { padding: '10px 15px', backgroundColor: '#ffa39e', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', width:'100%', cursor: 'not-allowed', opacity: 0.6 },
  doneBtn: { padding: '8px 15px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  undoBtn: { padding: '5px 10px', backgroundColor: '#888', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  saveBtn: { padding: '5px 10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' },
  cancelBtn: { padding: '5px 10px', backgroundColor: '#eee', border: 'none', borderRadius: '5px', cursor: 'pointer' },
  iconBtn: { background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', padding: '0 5px' }
};
