import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Image, X } from 'lucide-react';
import { loadLocalPhoto, type LocalPhotoRef } from './localPhotos';

interface PhotoPreview {
  key: string;
  name: string;
  url?: string;
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
  const [position, setPosition] = useState(0);
  const [loading, setLoading] = useState(true);
  const photoKey = photos.map((photo) => `${photo.id}:${photo.name}`).join('|');
  const fileKey = newFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|');

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setLoading(true);

    async function buildPreviews() {
      const existing: PhotoPreview[] = await Promise.all(photos.map(async (photo) => {
        const missing = { key: photo.id, storedId: photo.id, name: photo.name };
        try {
          const blob = await loadLocalPhoto(photo.id);
          if (!blob || !active) return missing;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          return { key: photo.id, storedId: photo.id, name: photo.name, url };
        } catch {
          return missing;
        }
      }));
      if (!active) return;
      const pending = newFiles.map((file, index) => {
        const url = URL.createObjectURL(file);
        urls.push(url);
        return { key: `new-${index}-${file.name}`, fileIndex: index, name: file.name, url };
      });
      if (active) {
        setPreviews([...existing, ...pending]);
        setPosition(0);
        setLoading(false);
      }
    }

    void buildPreviews();
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoKey, fileKey]);

  if (!photos.length && !newFiles.length) return null;

  return (
    <div className={`activity-photo-gallery ${readOnly ? 'memory-carousel' : ''}`} role="region" aria-label={label}>
      {loading && <span role="status">Loading photos...</span>}
      {!loading && previews.map((photo, index) => (
        <figure key={photo.key} className="activity-photo-preview" hidden={readOnly && index !== Math.min(position, previews.length - 1)}>
          {photo.url ? <img src={photo.url} alt={photo.name} loading="lazy" onError={() => setPreviews((current) => current.map((item) => item.key === photo.key ? { ...item, url: undefined } : item))} /> : <p className="field-hint"><Image size={16} /> {photo.name}: unavailable on this device.</p>}
          {!readOnly && <button
            type="button"
            className="photo-remove"
            aria-label={`Remove ${photo.name}`}
            onClick={() => photo.storedId ? onRemoveStored?.(photo.storedId) : onRemoveFile?.(photo.fileIndex ?? -1)}
          ><X size={14} /></button>}
          <figcaption>{photo.name}</figcaption>
        </figure>
      ))}
      {readOnly && !loading && previews.length > 1 && <div className="carousel-controls">
        <button type="button" className="icon-button" aria-label={`Previous ${label.toLowerCase()}`} title="Previous photo" disabled={position === 0} onClick={() => setPosition(position - 1)}><ChevronLeft size={18} /></button>
        <span role="status">{position + 1} / {previews.length}</span>
        <button type="button" className="icon-button" aria-label={`Next ${label.toLowerCase()}`} title="Next photo" disabled={position >= previews.length - 1} onClick={() => setPosition(position + 1)}><ChevronRight size={18} /></button>
      </div>}
    </div>
  );
}
