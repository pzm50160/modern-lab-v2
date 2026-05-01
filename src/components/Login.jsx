import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loader2, Lock, ShieldCheck, User } from 'lucide-react'

function encodeAccountName(name) {
  const bytes = new TextEncoder().encode(name.trim())
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '')
}

export default function Login() {
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleLogin(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const email = `${encodeAccountName(name)}@modern-lab.com`
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) throw authError
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        setError('系統目前連不上 Supabase，請確認 .env 的 VITE_SUPABASE_URL 是否為正確專案網址。')
      } else {
        setError(err.message === 'Invalid login credentials' ? '姓名或密碼不正確' : err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrapper">
      <form className="auth-card" onSubmit={handleLogin}>
        <div className="auth-mark">
          <ShieldCheck size={31} />
        </div>
        <h1>員工工作台登入</h1>
        <p>請使用員工姓名與密碼進入交接系統。</p>

        <label className="field">
          <span>員工姓名</span>
          <div className="field-control">
            <User size={18} />
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：王小明"
              autoComplete="username"
              required
            />
          </div>
        </label>

        <label className="field">
          <span>密碼</span>
          <div className="field-control">
            <Lock size={18} />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="輸入密碼"
              autoComplete="current-password"
              required
            />
          </div>
        </label>

        {error && <div className="notice error">{error}</div>}

        <button className="icon-text-button primary full" type="submit" disabled={loading}>
          {loading ? <Loader2 className="spin" size={19} /> : <ShieldCheck size={19} />}
          登入
        </button>
      </form>
    </div>
  )
}
