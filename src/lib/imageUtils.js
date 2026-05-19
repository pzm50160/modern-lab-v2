import { supabase } from './supabase'

function compressToBlob(file, maxWidth = 1280, maxHeight = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = (event) => {
      const img = new Image()
      img.src = event.target.result
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > maxWidth) { height *= maxWidth / width; width = maxWidth }
        } else {
          if (height > maxHeight) { width *= maxHeight / height; height = maxHeight }
        }

        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(resolve, 'image/jpeg', quality)
      }
      img.onerror = () => reject(new Error('圖片載入失敗'))
    }
    reader.onerror = () => reject(new Error('檔案讀取失敗'))
  })
}

export async function compressAndUploadImage(file) {
  const blob = await compressToBlob(file)
  const fileName = `tasks/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`

  const { error } = await supabase.storage
    .from('task-images')
    .upload(fileName, blob, { contentType: 'image/jpeg' })

  if (error) throw new Error(`圖片上傳失敗：${error.message}`)

  const { data } = supabase.storage.from('task-images').getPublicUrl(fileName)
  return data.publicUrl
}

export async function deleteStorageImage(url) {
  if (!url || url.startsWith('data:')) return
  const path = url.split('/task-images/')[1]
  if (!path) return
  await supabase.storage.from('task-images').remove([path])
}
