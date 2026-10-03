import { createRoot } from 'react-dom/client'
import R from '../src/components/C13Dashboard.jsx'
createRoot(document.getElementById('root')).render(<R currentUser="測試" isAdmin={false} />)
