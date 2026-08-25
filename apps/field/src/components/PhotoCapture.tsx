import { useEffect, useRef, useState } from 'react';
import { newLocalId, type Photo } from '@geotech/core';
import { db } from '../db/database.js';
import { IconClose, IconPhoto } from './Icons.js';

/**
 * Face photography (§8).
 *
 * Compression is deliberately gentle. A photograph of a face exists so a
 * geologist can see a contact, a slickenside, a gouge — detail that aggressive
 * compression destroys precisely where it matters. The long edge is capped at
 * 2048px at high JPEG quality: a meaningful size reduction that leaves
 * geological detail intact.
 */
const MAX_EDGE = 2048;
const QUALITY = 0.9;

async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 3_000_000) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', QUALITY);
  });
}

export function PhotoCapture({
  faceLogLocalId,
  observationLocalId,
  offsetLocalId,
  deviceId,
  userId,
  onCaptured,
}: {
  faceLogLocalId: string;
  observationLocalId?: string;
  offsetLocalId?: string;
  deviceId: string;
  userId: string;
  onCaptured?: (photo: Photo) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<{ localId: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      for (const p of photos) URL.revokeObjectURL(p.url);
    };
  }, [photos]);

  const capture = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const blob = await compress(file);
        const now = new Date().toISOString();
        const photo: Photo = {
          localId: newLocalId(),
          faceLogLocalId,
          observationLocalId: observationLocalId ?? null,
          offsetLocalId: offsetLocalId ?? null,
          mimeType: 'image/jpeg',
          bytes: blob.size,
          capturedAt: now,
          capturedById: userId,
          deviceId,
          version: 1,
          syncState: 'LOCAL_SAVED',
          createdAt: now,
          updatedAt: now,
          annotations: [],
        };
        // The record and the binary are written together: a photograph that
        // exists on disk without a row, or the reverse, is a lost photograph.
        await db.transaction('rw', db.photos, db.photoBlobs, async () => {
          await db.photos.put(photo);
          await db.photoBlobs.put({ localId: photo.localId, blob, uploaded: false });
        });
        setPhotos((p) => [...p, { localId: photo.localId, url: URL.createObjectURL(blob) }]);
        onCaptured?.(photo);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (localId: string) => {
    await db.transaction('rw', db.photos, db.photoBlobs, async () => {
      await db.photos.delete(localId);
      await db.photoBlobs.delete(localId);
    });
    setPhotos((p) => p.filter((x) => x.localId !== localId));
  };

  return (
    <div className="stack">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void capture(e.target.files)}
      />
      <button type="button" className="btn btn-block btn-lg" onClick={() => inputRef.current?.click()} disabled={busy}>
        <IconPhoto size={22} /> {busy ? 'Saving…' : photos.length > 0 ? 'Take another photograph' : 'Take photograph'}
      </button>

      {photos.length > 0 && (
        <div className="photo-strip">
          {photos.map((p) => (
            <div key={p.localId} style={{ position: 'relative' }}>
              <img className="photo-thumb" src={p.url} alt="Face photograph" />
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void remove(p.localId)}
                style={{ position: 'absolute', top: 4, right: 4, minHeight: 32, minWidth: 32, padding: 0, fontSize: 14 }}
                aria-label="Delete photograph"
              >
                <IconClose size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {photos.length > 0 && (
        <span className="small muted">
          {photos.length} photograph{photos.length === 1 ? '' : 's'} held on this device. They upload after the record syncs.
        </span>
      )}
    </div>
  );
}
