import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import R from '../src/components/RecheckDashboard.jsx'
function App() {
  const [active, setActive] = useState(true)
  window.__setActive = setActive
  return <R currentUser="測試" isAdmin={false} active={active} />
}
createRoot(document.getElementById('root')).render(<App />)
