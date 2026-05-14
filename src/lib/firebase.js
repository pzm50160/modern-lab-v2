import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getMessaging } from 'firebase/messaging'

const firebaseConfig = {
  apiKey: "AIzaSyCaxWnFi78Rrra5gEuFRWPN-4jdEUFWLp8",
  authDomain: "modern-lab-app.firebaseapp.com",
  projectId: "modern-lab-app",
  storageBucket: "modern-lab-app.firebasestorage.app",
  messagingSenderId: "154018152899",
  appId: "1:154018152899:web:21c8435ed7e68221b13d76"
}

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const messaging = (() => {
  try { return getMessaging(app) } catch { return null }
})()
