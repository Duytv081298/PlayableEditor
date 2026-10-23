import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './fonts.css'; // font nhúng sẵn base64 — chạy được cả khi không có mạng
import './styles.css';

/** Lỗi trong lúc React commit không được làm trắng cả tool. */
class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error) {
    console.error('[playable-editor]', err);
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="empty">
        <div className="empty-card">
          <h1>Tool gặp lỗi</h1>
          <p>
            Giao diện vừa dừng vì một lỗi khi dựng lại màn hình. File đang mở và các thay đổi vẫn
            nằm trong bộ nhớ trình duyệt cho tới khi tải lại trang.
          </p>
          <p className="err">
            <code>{this.state.err.message}</code>
          </p>
          <button className="btn primary big" onClick={() => this.setState({ err: null })}>
            Thử dựng lại giao diện
          </button>
          <p className="hint">Nếu vẫn lỗi, tải lại trang rồi mở file lại.</p>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
