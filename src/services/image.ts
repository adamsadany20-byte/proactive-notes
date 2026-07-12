// Client-side image downscale + JPEG re-encode. Keeps attachments small enough
// to store inline on the note (localStorage + Supabase JSON) and to send to the
// vision endpoint under its body limit, while staying legible for OCR.

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

// Returns a compressed JPEG data URL. maxDim caps the longest edge.
export async function compressImage(
  file: File,
  maxDim = 1280,
  quality = 0.68,
): Promise<string> {
  const img = await loadImage(file)
  const longest = Math.max(img.width, img.height) || 1
  const scale = Math.min(1, maxDim / longest)
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  // White backing so transparent PNGs don't turn black once flattened to JPEG.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  return canvas.toDataURL('image/jpeg', quality)
}
