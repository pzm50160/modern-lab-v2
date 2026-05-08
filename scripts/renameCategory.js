import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const OLD_NAME = '特殊檢驗'
  const NEW_NAME = '特殊項目'

  // 1. Update all tasks referencing the old category name
  const { data: tasks, error: taskErr } = await supabase
    .from('tasks')
    .update({ category_name: NEW_NAME })
    .eq('category_name', OLD_NAME)
    .select('id')

  if (taskErr) {
    console.error('Failed to update tasks:', taskErr.message)
  } else {
    console.log(`Updated ${tasks?.length || 0} tasks from "${OLD_NAME}" to "${NEW_NAME}"`)
  }

  // 2. Check if the new category already exists
  const { data: existing } = await supabase
    .from('categories')
    .select('*')
    .eq('name', NEW_NAME)
    .single()

  if (existing) {
    // New name already exists, just delete the old one
    const { error: delErr } = await supabase
      .from('categories')
      .delete()
      .eq('name', OLD_NAME)
    
    if (delErr) {
      console.error('Failed to delete old category:', delErr.message)
    } else {
      console.log(`Deleted old category "${OLD_NAME}" (new name already exists)`)
    }
  } else {
    // Rename old to new
    const { error: renameErr } = await supabase
      .from('categories')
      .update({ name: NEW_NAME })
      .eq('name', OLD_NAME)
    
    if (renameErr) {
      console.error('Failed to rename category:', renameErr.message)
    } else {
      console.log(`Renamed category "${OLD_NAME}" to "${NEW_NAME}"`)
    }
  }

  console.log('Done.')
}

main()
