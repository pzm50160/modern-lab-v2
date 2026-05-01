import { initializeApp } from 'firebase/app'
import { collection, getDocs, getFirestore } from 'firebase/firestore'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
}

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error('Missing Firebase settings in .env. See README.md for required keys.')
  process.exit(1)
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const firebaseApp = initializeApp(firebaseConfig)
const db = getFirestore(firebaseApp)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

function encodeAccountName(name) {
  return Buffer.from(name.trim(), 'utf-8').toString('base64').replace(/=/g, '')
}

async function findAuthUserByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw error
  return data.users.find((user) => user.email === email)
}

async function upsertProfile(userId, sourceUser, accountId) {
  const displayName = sourceUser.name.trim()
  const role = sourceUser.role || 'staff'

  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    display_name: displayName,
    role,
    account_id: accountId,
    updated_at: new Date().toISOString(),
  })

  if (error) throw error
}

async function migrateUsers() {
  console.log('Starting Firebase users migration...')

  const querySnapshot = await getDocs(collection(db, 'users'))
  const firebaseUsers = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))

  console.log(`Found ${firebaseUsers.length} Firebase users.`)

  for (const sourceUser of firebaseUsers) {
    if (!sourceUser.name || !sourceUser.password) {
      console.warn(`Skipped ${sourceUser.id}: missing name or password.`)
      continue
    }

    const accountId = encodeAccountName(sourceUser.name)
    const email = `${accountId}@modern-lab.com`
    const role = sourceUser.role || 'staff'

    console.log(`Processing ${sourceUser.name} (${role})...`)

    let authUserId
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: String(sourceUser.password),
      email_confirm: true,
      user_metadata: {
        display_name: sourceUser.name,
        role,
      },
    })

    if (createError) {
      if (!createError.message.includes('already registered')) {
        console.error(`Could not create ${sourceUser.name}:`, createError.message)
        continue
      }

      const existingUser = await findAuthUserByEmail(email)
      if (!existingUser) {
        console.error(`Auth user exists but could not be loaded: ${email}`)
        continue
      }
      authUserId = existingUser.id
    } else {
      authUserId = created.user.id
    }

    try {
      await upsertProfile(authUserId, sourceUser, accountId)
      console.log(`Migrated ${sourceUser.name}`)
    } catch (error) {
      console.error(`Could not upsert profile for ${sourceUser.name}:`, error.message)
    }
  }

  console.log('Migration complete.')
}

migrateUsers().catch((error) => {
  console.error('Migration failed:', error)
  process.exit(1)
})
