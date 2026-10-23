# Playable Editor

Công cụ chỉnh sửa file **Playable Ads HTML / ZIP** (Cocos Creator, Unity Luna Labs, `super-html`, `playable-ads-adapter`, Three.js/Babylon.js...) trực tiếp trên trình duyệt:
- Xem & thay thế **Hình ảnh**, **Âm thanh**, **Mô hình 3D** (`.glb`, `.fbx` material/texture/màu sắc).
- Tự động dò và chỉnh sửa **Link Store** (Google Play & App Store).
- Khung **Preview** giả lập thiết bị & SDK quảng cáo trực tiếp.
- Chuyển đổi và đóng gói chuẩn yêu cầu kỹ thuật cho **22 biến thể Ad Network** (AppLovin, Mintegral, Google Ads, Meta/Facebook, Unity Ads, ironSource, Pangle, TikTok, Liftoff, Vungle, Moloco, Bigo, Kwai, Snapchat, GDT, Yandex, Chartboost, InMobi, Nefta, NewsBreak...).

---

## 🚀 Cách sử dụng ngay (Không cần cài đặt)

### Cách 1: Tải file đơn `PlayableEditor.html` (Chạy Offline 100%)
1. Tải file **[`PlayableEditor.html`](./PlayableEditor.html)** ở ngay thư mục gốc của repo này.
2. Mở trực tiếp bằng trình duyệt (Chrome / Edge / Safari). Toàn bộ giao diện, mã nguồn, font chữ đã được đóng gói trong duy nhất 1 file HTML (~775 KB).

### Cách 2: Dùng trực tiếp trên Web (GitHub Pages)
- Truy cập: **`https://duytv081298.github.io/PlayableEditor/`**

---

## 🔄 Tự động Build khi chỉnh sửa (CI/CD)

Repository đã được cấu hình sẵn **GitHub Actions** (`.github/workflows/build.yml`):
- Mỗi khi có bất kỳ chỉnh sửa nào được push lên nhánh `main` (hoặc sửa trực tiếp trên giao diện web GitHub), hệ thống sẽ **tự động**:
  1. Chạy toàn bộ Unit Tests (`npm test`) để kiểm tra parser & các quy chuẩn Ad Network.
  2. Tự động build lại bản 1-file (`npm run build:single`) và cập nhật thẳng vào file **[`PlayableEditor.html`](./PlayableEditor.html)** cũng như `playable-editor/dist-single/index.html` trên nhánh `main`.
  3. Tự động cập nhật trang web **GitHub Pages**.

---

## 🛠️ Phát triển tại máy (Local Development)

```bash
# 1. Cài đặt dependencies
cd playable-editor
npm install

# 2. Chạy môi trường dev (http://localhost:5173)
npm run dev

# 3. Chạy unit tests
npm test

# 4. Build lại file đơn PlayableEditor.html (tự động đồng bộ ra thư mục gốc)
npm run build:single
```

*(Hoặc đứng ở thư mục gốc của repo và chạy `npm run dev`, `npm test`, `npm run build`)*.

Xem thêm chi tiết kỹ thuật tại [`playable-editor/README.md`](./playable-editor/README.md).
