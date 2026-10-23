import { useState, useEffect } from 'react';
import type { StoreUrls } from '../lib/storeUrls';

interface Props {
  open: boolean;
  storeUrls: StoreUrls;
  originalUrls: StoreUrls;
  onSave: (urls: StoreUrls) => void;
  onClose: () => void;
}

export default function StoreModal({ open, storeUrls, originalUrls, onSave, onClose }: Props) {
  const [gp, setGp] = useState(storeUrls.googlePlayUrl);
  const [as, setAs] = useState(storeUrls.appStoreUrl);

  useEffect(() => {
    if (open) {
      setGp(storeUrls.googlePlayUrl);
      setAs(storeUrls.appStoreUrl);
    }
  }, [open, storeUrls]);

  if (!open) return null;

  const hasOriginal = !!(originalUrls.googlePlayUrl || originalUrls.appStoreUrl);
  const isModifiedFromOriginal =
    gp !== originalUrls.googlePlayUrl || as !== originalUrls.appStoreUrl;

  const handleSave = () => {
    onSave({
      googlePlayUrl: gp.trim(),
      appStoreUrl: as.trim(),
    });
    onClose();
  };

  const handleResetToOriginal = () => {
    setGp(originalUrls.googlePlayUrl);
    setAs(originalUrls.appStoreUrl);
  };

  const openUrl = (url: string) => {
    const trimmed = url.trim();
    if (trimmed) {
      window.open(trimmed, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal store-modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>🔗 Chỉnh sửa Link Store</h3>
          <button className="btn ghost small" onClick={onClose} style={{ padding: '2px 8px' }}>✕</button>
        </div>

        <p className="muted" style={{ margin: 0 }}>
          Cấu hình link tải game cho Android (Google Play) và iOS (App Store). Link này tự động áp dụng khi chơi thử (preview), khi tải HTML đã sửa và khi build ra các ad network.
        </p>

        {hasOriginal && (
          <div className="store-detected-box">
            <strong style={{ fontSize: 12, color: 'var(--ink-2)' }}>Link gốc phát hiện trong file:</strong>
            {originalUrls.googlePlayUrl ? (
              <div className="store-detected-item">
                <span className="store-tag">Google Play</span>
                <span className="store-url-text" title={originalUrls.googlePlayUrl}>{originalUrls.googlePlayUrl}</span>
              </div>
            ) : null}
            {originalUrls.appStoreUrl ? (
              <div className="store-detected-item">
                <span className="store-tag">App Store</span>
                <span className="store-url-text" title={originalUrls.appStoreUrl}>{originalUrls.appStoreUrl}</span>
              </div>
            ) : null}
          </div>
        )}

        <label>
          <span>Link Google Play (Android)</span>
          <div className="store-input-row">
            <input
              type="text"
              value={gp}
              onChange={(e) => setGp(e.target.value)}
              placeholder="https://play.google.com/store/apps/details?id=..."
            />
            {gp.trim() && (
              <>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => openUrl(gp)}
                  title="Mở thử link trong tab mới"
                >
                  ↗️
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => setGp('')}
                  title="Xóa link"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </label>

        <label>
          <span>Link App Store (iOS)</span>
          <div className="store-input-row">
            <input
              type="text"
              value={as}
              onChange={(e) => setAs(e.target.value)}
              placeholder="https://apps.apple.com/app/id..."
            />
            {as.trim() && (
              <>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => openUrl(as)}
                  title="Mở thử link trong tab mới"
                >
                  ↗️
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => setAs('')}
                  title="Xóa link"
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </label>

        <div className="modal-actions" style={{ marginTop: 8 }}>
          {hasOriginal && isModifiedFromOriginal ? (
            <button
              type="button"
              className="btn small ghost"
              onClick={handleResetToOriginal}
              title="Khôi phục lại link gốc tìm thấy trong file"
            >
              Về link gốc
            </button>
          ) : (
            <button
              type="button"
              className="btn small ghost"
              onClick={() => { setGp(''); setAs(''); }}
            >
              Xóa hết
            </button>
          )}

          <span className="spacer" />

          <button type="button" className="btn small" onClick={onClose}>
            Đóng
          </button>
          <button type="button" className="btn small primary" onClick={handleSave}>
            Lưu & Áp dụng
          </button>
        </div>
      </div>
    </div>
  );
}
