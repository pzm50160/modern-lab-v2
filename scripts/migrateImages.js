import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

function base64ToBuffer(dataUrl) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  return Buffer.from(base64, 'base64')
}

async function migrate() {
  console.log('讀取所有含圖片的任務...')
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, image_urls')
    .neq('image_urls', '[]')

  if (error) { console.error('讀取失敗:', error.message); process.exit(1) }

  const targets = tasks.filter(t =>
    Array.isArray(t.image_urls) && t.image_urls.some(u => u.startsWith('data:'))
  )

  console.log(`找到 ${targets.length} 個任務含 base64 圖片，開始搬移...`)

  let success = 0
  let failed = 0

  for (const task of targets) {
    const newUrls = []
    for (const url of task.image_urls) {
      if (!url.startsWith('data:')) { newUrls.push(url); continue }

      try {
        const buffer = base64ToBuffer(url)
        const fileName = `tasks/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`

        const { error: uploadError } = await supabase.storage
          .from('task-images')
          .upload(fileName, buffer, { contentType: 'image/jpeg' })

        if (uploadError) throw uploadError

        const { data } = supabase.storage.from('task-images').getPublicUrl(fileName)
        newUrls.push(data.publicUrl)
        success++
      } catch (err) {
        console.error(`  任務 ${task.id} 圖片上傳失敗:`, err.message)
        newUrls.push(url) // 保留原始 base64，不影響顯示
        failed++
      }
    }

    await supabase.from('tasks').update({ image_urls: newUrls }).eq('id', task.id)
    console.log(`  任務 ${task.id} 完成`)
  }

  console.log(`\n搬移完成！成功 ${success} 張，失敗 ${failed} 張`)
}

migrate()
