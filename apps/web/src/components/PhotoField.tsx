// src/components/PhotoField.tsx
import React, { useRef } from 'react';

export type PhotoValue = {
  url?: string | null;      // исходный URL (если пришёл с сервера)
  dataUrl?: string | null;  // локально выбранное изображение (base64)
};

type Props = {
  label?: string;
  value?: PhotoValue | null;
  onChange?: (next: PhotoValue | null) => void;
};

export default function PhotoField({ label = 'Фотография', value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const choose = () => inputRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      onChange?.({ url: undefined, dataUrl }); // сохраняем исходник как есть (без удаления фона)
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // сбросить input, чтобы повторно выбирать тот же файл
  };

  const clear = () => onChange?.(null);

  const src = value?.dataUrl || value?.url || '';

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 14, color: '#fff' }}>{label}</div>

      <div
        style={{
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 10,
          padding: 10,
          display: 'grid',
          gap: 10,
          background: 'rgba(255,255,255,0.04)',
          color: '#fff'
        }}
      >
        {src ? (
          <img
            src={src}
            alt="Фото"
            style={{ width: '100%', maxHeight: 240, objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <div style={{ opacity: 0.8, fontSize: 13 }}>(фото не прикреплено)</div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={choose} style={btn()}>
            {src ? 'Заменить фото' : 'Прикрепить фото'}
          </button>
          {src && (
            <button type="button" onClick={clear} style={btn()}>
              Удалить фото
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}

function btn() {
  return {
    padding: '8px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.28)',
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.08) 100%), rgba(255,255,255,0.06)',
    color: '#fff',
    cursor: 'pointer'
  } as React.CSSProperties;
}
