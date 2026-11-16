// Photo helpers: shrink the phone photo before sending, and make the small
// thumbnail kept in the log. All of this runs in the browser; the photo
// never leaves the phone except as one shrunk JPEG to the score function.

// Shrink to a JPEG with its longest side about maxSide px. Returns a data URL.
export async function fileToJpeg(file: File, maxSide: number): Promise<string> {
  const img = await loadImage(URL.createObjectURL(file));
  try {
    return drawToJpeg(img, maxSide);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

// A small square-ish thumbnail (about `size` px on the longest side).
export async function makeThumb(dataUrl: string, size: number): Promise<string> {
  const img = await loadImage(dataUrl);
  return drawToJpeg(img, size);
}

// Strip the "data:image/jpeg;base64," part so the function gets plain base64.
export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that photo'));
    img.src = src;
  });
}

function drawToJpeg(img: HTMLImageElement, maxSide: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that photo');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
