export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']);

export function photoValidationError(file: Pick<File, 'type' | 'size'>): string | undefined {
  if (!IMAGE_TYPES.has(file.type)) return 'Choose a JPEG, PNG, WebP, GIF, AVIF or HEIC image.';
  if (file.size < 1) return 'This image is empty.';
  if (file.size > MAX_PHOTO_BYTES) return 'Choose images no larger than 30 MiB each.';
  return undefined;
}

export async function preparePhoto(file: File): Promise<File> {
  const error = photoValidationError(file);
  if (error) throw new Error(error);
  if (file.type !== 'image/jpeg' || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const ratio = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: blob.type, lastModified: file.lastModified });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}