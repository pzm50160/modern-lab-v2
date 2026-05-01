import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const adminNames = new Set(
  (process.env.ADMIN_NAMES || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
)

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

function getDisplayName(user) {
  return user.user_metadata?.display_name || user.email?.split('@')[0] || '未命名員工'
}

async function fixProfiles() {
  console.log('Syncing Supabase Auth users into public.profiles...')

  const { data, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) {
    console.error('Could not list auth users:', listError.message)
    process.exit(1)
  }

  const users = data?.users || []
  console.log(`Found ${users.length} auth users.`)

  for (const user of users) {
    const displayName = getDisplayName(user)
    const metadataRole = user.user_metadata?.role
    const role = metadataRole || (adminNames.has(displayName) ? 'admin' : 'staff')
    const accountId = user.email?.split('@')[0] || null

    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      display_name: displayName,
      role,
      account_id: accountId,
      updated_at: new Date().toISOString(),
    })

    if (upsertError) {
      console.error(`Failed to sync ${displayName}:`, upsertError.message)
    } else {
      console.log(`Synced ${displayName} (${role})`)
    }
  }

  console.log('Profile sync complete.')
}

fixProfiles()
