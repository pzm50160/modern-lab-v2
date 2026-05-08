import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const { data, error } = await supabase.from('categories').select('*').order('name')
  if (error) {
    console.error('Error:', error.message)
  } else {
    console.log('Current categories:')
    data.forEach(c => console.log(`  - ${c.name} (type: ${c.type})`))
  }
}

main()
