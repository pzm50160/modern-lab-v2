import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function setup() {
  // 建立 bucket
  const { error } = await supabase.storage.createBucket('task-images', {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  })

  if (error && !error.message.includes('already exists')) {
    console.error('建立 bucket 失敗:', error.message)
    process.exit(1)
  }

  console.log('✓ task-images bucket 已建立（或已存在）')
}

setup()
