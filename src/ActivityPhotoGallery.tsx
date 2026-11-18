import { useEffect, useState } from 'react';
import { Image, X } from 'lucide-react';
import { loadLocalPhoto, type LocalPhotoRef } from './localPhotos';

interface PhotoPreview {
  key: string;
  name: string;
  url: string;
  storedId?: string;
  fileIndex?: number;
}

export default function ActivityPhotoGallery({
  photos,
  newFiles,
  readOnly = false,
  label = 'Activity photos',
  onRemoveStored,
  onRemoveFile,
}: {
  photos: LocalPhotoRef[];
  newFiles: File[];
  readOnly?: boolean;
  label?: string;
  onRemoveStored?: (id: string) => void;
  onRemoveFile?: (index: number) => void;
}) {
  const [previews, setPreviews] = useState<PhotoPreview[]>([]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];

    async function buildPreviews() {
      const existing: Array<PhotoPreview | undefined> = await Promise.all(photos.map(async (photo) => {
        try {
          const blob = await loadLocalPhoto(photo.id);
          if (!blob) return undefined;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          return { key: photo.id, storedId: photo.id, name: photo.name, url };
        } catch {
          return undefined;
        }
      }));
      const pending = newFiles.map((file, index) => {
        const url = URL.createObjectURL(file);
        urls.push(url);
        return { key: `new-${index}-${file.name}`, fileIndex: index, name: file.name, url };
      });
      if (active) setPreviews([...existing.filter(Boolean) as PhotoPreview[], ...pending]);
    }

    void buildPreviews();
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photos, newFiles]);

  if (!photos.length && !newFiles.length) return null;

  return (
    <div className="activity-photo-gallery" aria-label={label}>
      {previews.map((photo) => (
        <figure key={photo.key} className="activity-photo-preview">
          <img src={photo.url} alt={photo.name} />
          {!readOnly && <button
            type="button"
            className="photo-remove"
            aria-label={`Remove ${photo.name}`}
            onClick={() => photo.storedId ? onRemoveStored?.(photo.storedId) : onRemoveFile?.(photo.fileIndex ?? -1)}
          ><X size={14} /></button>}
          <figcaption>{photo.name}</figcaption>
        </figure>
      ))}
      {!previews.length && <span className="field-hint"><Image size={13} /> Photos are available only on the device where they were added.</span>}
    </div>
  );
}
