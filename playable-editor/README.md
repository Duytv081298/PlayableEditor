# Playable Editor

Tool web (React + Vite) để mở 1 file playable HTML, xem và thay hình ảnh và âm thanh, chơi thử ngay khi sửa, rồi build ra từng ad network. Quy tắc từng network lấy từ extension **super-html 5.2.3** trong `../super-html`.

## Chạy

```bash
npm install
npm run dev          # mở http://localhost:5173
```

Không muốn cài: mở thẳng `dist-single/index.html` bằng Chrome. **Toàn bộ tool nằm trong đúng 1 file HTML** (~750 KB): HTML + JS + CSS + font đều nhúng sẵn base64, không tải gì từ mạng — copy đi đâu cũng chạy, kể cả máy không có internet. Đổi tên file tuỳ ý.

Build lại:

```bash
npm run build          # dist/ (deploy lên web server)
npm run build:single   # dist-single/index.html (1 file duy nhất, chạy offline hoàn toàn)
npm run fonts          # sinh lại src/fonts.css (font Be Vietnam Pro nhúng base64) khi đổi font
npm test               # test parser + builder (dùng ../super-html/static/index.html làm mẫu)
npm run extract        # đọc lại adapter network từ ../super-html sau khi cập nhật super-html
```

## Cách dùng

1. **Mở file**: `.html` playable, hoặc `.zip` đã build (index.html + res.js…).
2. **Hình ảnh / Âm thanh / Mô hình 3D / Khác**: liệt kê mọi tài nguyên nhúng trong file.
   - Bấm *Thay* hoặc kéo thả file vào thẻ. Tài nguyên trùng nội dung (×N) được thay một lần cho tất cả.
   - Ảnh khác kích thước: mặc định co vừa vào đúng kích thước gốc (để sprite frame của Cocos không bị lệch). Có thể chọn phủ kín, kéo giãn, hoặc dùng nguyên file.
   - *Gốc*: mỗi thẻ có nút **Gốc** trả lại đúng tài nguyên gốc ban đầu trong file (mờ đi khi thẻ đó chưa thay gì). Muốn bỏ hết mọi thứ đã thay thì bấm **Reset tất cả về gốc (N)** ở thanh trên cùng.
   - *Thay hàng loạt theo tên*: chọn nhiều file, tool tự khớp theo tên với tài nguyên.
   - *Tải toàn bộ tài nguyên*: xuất zip tất cả ảnh và âm thanh (hiện tại).
   - **Mô hình 3D**: model `.glb` nhúng trong file (Three.js, Babylon.js, PlayCanvas, game 3D tự build…) hiện ra như 1 thẻ model. Nếu model có ảnh vật liệu (material/texture) nhúng sẵn bên trong, mỗi ảnh tách ra 1 thẻ riêng — gắn nhãn **VẬT LIỆU**, đặt tên theo material + vai trò (`Body · baseColor`, `Body · normal`…) khi đọc được. Thay ảnh vật liệu như thay ảnh bình thường; tool tự đóng gói lại file `.glb` (giữ nguyên phần hình học/mesh, chỉ đổi đúng vùng byte của ảnh đó) và áp vào đúng chỗ trong HTML khi tải về.
     - Model `.fbx` nhúng cũng hiện ra tương tự: mỗi **màu vật liệu** (Diffuse/Specular/Ambient/Emissive/Reflection Color của từng material) tách ra 1 thẻ riêng — gắn nhãn **MÀU**, đổi màu bằng cách bấm vào ô màu rồi chọn màu mới (không cần file). Nếu file `.fbx` có nhúng kèm texture thật trong material (property `Content` của node `Video` — không phải mọi file `.fbx` đều có, nhiều file chỉ ghi đường dẫn ảnh ngoài máy người làm model) thì texture đó cũng tách ra 1 thẻ **TEXTURE**, thay như ảnh bình thường. Tool chỉ ghi lại đúng phần byte đã đổi, mọi phần khác của file (hình học, animation, scene graph…) giữ nguyên tuyệt đối.
3. **Chỉnh sửa Link Store (Google Play & App Store)**:
   - Nút **🔗 Sửa link Store** trên thanh công cụ và huy hiệu link store ở thanh thông tin file.
   - Tự động dò và hiển thị link gốc có sẵn trong file (cả định dạng chuẩn lẫn dạng đã escape).
   - Hỗ trợ nhập/sửa link Google Play (Android) và App Store (iOS), có nút **↗️** mở thử link trên tab mới để kiểm tra tính hợp lệ.
   - Tự động áp dụng link store mới vào:
     - Code HTML tải về qua nút **Tải HTML đã sửa** (thay thế triệt để link cũ và cập nhật `super_html`).
     - Khung chơi thử (**Preview**): khi click CTA, log hiển thị link đích thực tế.
     - Đồng bộ 2 chiều với tab **Build network**.
4. **Khung chơi thử** (bên phải): tự tải lại khi thay tài nguyên. Chọn thiết bị, xoay ngang/dọc, giả lập SDK của network.
   - Danh sách thiết bị chia 4 nhóm: **iPhone** (16 Pro Max, 16/15 Pro, 15/14 Pro, 14/13/12, 13 mini, SE/8), **Android** (Pixel 8 Pro, Pixel 7/8, Xiaomi/Redmi, Galaxy S24 Ultra, S24/S23, Galaxy A/Oppo/Vivo, Android phổ thông), **Máy tính bảng** (iPad mini, iPad 10.9", iPad Pro 11"/12.9", tablet Android) và **Tỉ lệ chuẩn** (9:20, 9:19.5 — phổ biến nhất hiện nay, 9:16, 3:4, 1:1, Google 320×480, banner 300×250). Số đi kèm là kích thước CSS px đúng như webview quảng cáo nhìn thấy.
   - Mục **Tự nhập kích thước / tỉ lệ…** ở cuối danh sách: gõ thẳng 2 số rộng × cao (120–2560px, gõ sai hay để trống thì tự lùi về số hợp lệ), nút **⇄** đổi chỗ 2 số. Dòng góc dưới khung luôn hiện kích thước kèm tỉ lệ đã rút gọn (vd. `360×800 (9:20)`). Thiết bị / kích thước tự nhập được nhớ cho lần mở sau.
   - Ô **mức phóng**: *Vừa khung* (mặc định — lấp đầy chỗ trống, phóng quá 100% được nên máy nhỏ không còn bị bé tí giữa màn hình trống) hoặc cố định 100/125/150/200% (kéo xem được khi tràn khung).
   - Nút **Thu gọn log**: giấu khung log đi, nhường toàn bộ chiều cao cho khung chơi thử (máy hiện to hơn ~30%). Mỗi lần game gọi CTA, khung nháy vàng và log ghi rõ API được gọi (`mraid.open`, `FbPlayableAd.onCTAClick`, `ExitApi.exit`…).
4. **Build network**: điền link store, chọn network, bấm Build. Mỗi kết quả có dung lượng so với giới hạn, cảnh báo, nút *Chơi thử* (chạy đúng bản build với SDK giả lập) và *Tải*.
   - Mở file mới, ô **Tiền tố tên file** tự đổi theo tên file vừa mở (bỏ đuôi `.html`/`.zip`; file tên `index` thì giữ tiền tố cũ vì không có ý nghĩa).
   - Mở file mới, tool tự dò link Google Play / App Store nếu file đã có sẵn (file build trước đó, hoặc link còn sót lại trong code) và điền sẵn vào 2 ô — có ghi chú nhỏ báo đã tự tìm thấy. Nếu không tìm thấy, ô giữ nguyên link của lần build trước (localStorage) để khỏi gõ lại.
   - Bấm **Build** mà cả 2 ô link đều trống: hiện popup bắt nhập link trước (ít nhất 1 trong 2), chặn build cho tới khi nhập hoặc bấm **"Bỏ qua, build không cần link"** nếu cố tình muốn build không có link (test nhanh).
   - Mỗi dòng kết quả có 1 huy hiệu mã thư mục (vd. `AL`, `FB`, `GG`…) nếu network đó có thư mục riêng. Bấm **Tải tất cả (.zip theo thư mục network)** để xuất 1 file zip có sẵn cấu trúc thư mục đúng mã — giải nén đè lên bộ thư mục network đã tạo sẵn trên máy là xong, không cần kéo thả thủ công từng file. Network không có mã thư mục (Chartboost, InMobi, Nefta, Snapchat, GDT, NewsBreak, Yandex…) nằm ở gốc zip.
   - Bảng mã thư mục ↔ network (`src/lib/channels.ts`, field `folder` của từng `Variant`): `AL`=AppLovin, `BG`=Bigo, `CM`=Common (không SDK), `CMM`=Common (nén tài nguyên), `FB`=Meta/Facebook, `GG`=Google Ads (cả dọc/ngang), `IR`=ironSource/LevelPlay, `KW`=Kwai, `LO`=Liftoff, `MG`=Mintegral, `MO`=Moloco, `PG`=Pangle (cả dọc/ngang), `TT`=TikTok, `UN`=Unity Ads, `VG`=Vungle. Thư mục `TD` (dj gọi là "Tec-Do") chưa có network tương ứng trong tool — cần cho biết SDK/CTA của mạng này thì mới thêm adapter build được.

## Tool nhận diện tài nguyên thế nào

| Dạng | Ví dụ |
|---|---|
| data URI base64 | `src="data:image/png;base64,…"`, `url(data:…)`, `"key":"data:audio/mp3;base64,…"` |
| base64 "trần" trong chuỗi | `"iVBORw0KGgo…"`, nhận diện bằng magic bytes (png, jpg, gif, webp, mp3, ogg, wav, m4a, mp4, font…) |
| zip base64 lồng nhau | `window.__zip = "UEsDB…"` của super-html, quét đệ quy cả file JSON bên trong |
| super-html `window.__res` | gồm cả kiểu làm rối `window.oasjidx` (chèn 1 ký tự vào data URI) |
| playable-ads-adapter `window.__adapter_zip__` | JSON `{đường dẫn: dataURI}` nén zlib (pako), có thể cắt thành nhiều thẻ script nối bằng `+=`. Tool giải nén, cho thay ảnh/âm thanh, rồi nén lại đúng định dạng và đúng số khúc. Network tách `res.js` sẽ chuyển các khúc này sang `res.js`. |
| Luna Labs (Unity) `data-src122` & `window.sounds` | Thẻ `<img data-src122="...">` mã hoá Base122 và âm thanh nén Brotli `decompressArrayBuffer`. Tool tự giải mã Base122 và Brotli để trích xuất ảnh/âm thanh, khi thay thế tự động mã hoá Base122 chuẩn và chèn override âm thanh. |
| model glTF nhị phân (`.glb`) | Nhận diện bằng magic bytes `glTF`, dù nằm trong data URI, chuỗi base64 trần hay trong `.zip`. Tool đọc JSON nội bộ của glb để tìm ảnh vật liệu nhúng qua `bufferView`, tách riêng ra để thay, rồi dựng lại đúng khối BIN (bù offset cho mọi phần hình học đứng sau khi ảnh đổi kích thước). |
| model FBX nhị phân (`.fbx`) | Nhận diện bằng magic bytes `Kaydara FBX Binary`. Tool đọc cây node nhị phân, tìm màu (`Material > Properties70 > P` có tên `DiffuseColor`/`SpecularColor`/`AmbientColor`/`EmissiveColor`/`ReflectionColor`) và texture nhúng kèm (`Video > Content`, nếu có) để tách riêng ra sửa. Khi ghi lại: node không đổi gì giữ nguyên y byte gốc, chỉ node có sửa mới được mã hoá lại — đảm bảo không làm hỏng mesh/animation/scene graph dù không hiểu hết cấu trúc của chúng. |

Tên tài nguyên được đoán từ key JSON (`assets/main/native/…png`), id của thẻ `<img>` hoặc selector CSS.

## Build network: 2 chế độ

**File build bằng super-html v5** (có `window.super_html_channel`): tool gỡ `meta.html`, `head.js` và `script.js` của network cũ, chèn adapter network mới đúng vị trí, đổi `super_html_channel`. Phần boot của game giữ nguyên.

**HTML bất kỳ**: tool chèn một khối "cầu nối" vào đầu `<head>` (giữa `<!--PLAYABLE-EDITOR:BEGIN-->` và `END`):
- SDK và meta của network (giống `meta.html` của super-html), kèm hàm common tối giản và `script.js` của network đó.
- `window.open(url)` → CTA của network (tắt được).
- API giả cho SDK của network khác: game viết cho `mraid.open` vẫn chạy khi build Facebook/Google/Mintegral… (tắt được).
- Tự gọi `super_html.game_ready()` khi load (Mintegral, Bigo cần).
- Game có thể gọi trực tiếp `window.playable_cta()` / `window.playable_game_end()`.

Build lại từ file đã build vẫn sạch: khối cầu nối cũ và meta network cũ luôn được gỡ trước khi chèn mới.

| Network | Đầu ra | CTA |
|---|---|---|
| AppLovin, ironSource 2025, Unity, Chartboost, Nefta, InMobi | html | `mraid.open` |
| Liftoff, Nefta (zip) | zip | `mraid.open` |
| Mintegral | zip | `window.install()` |
| Google (thường, dọc, ngang) | zip | `ExitApi.exit()` |
| Meta html (≤2MB), Meta zip (+res.js) | html / zip | `FbPlayableAd.onCTAClick()` |
| Pangle (thường, dọc, ngang), TikTok | zip (+config.json) | `openAppStore()` |
| Moloco, NewsBreak, Common | html | `window.open` |
| Vungle | zip | `parent.postMessage("download")` |
| Bigo, Kwai (+thumbnail), Snapchat, GDT ×3, Yandex (+res.js) | zip | API riêng |

Giới hạn dung lượng trong tool là số tham khảo, sửa ở `src/lib/channels.ts` nếu network đổi quy định.

## Cấu trúc

```
scripts/extract-super-html.mjs  đọc super-html/static/sp → src/data/superHtml.json
src/lib/project.ts              phân tích và ghi lại HTML (container text/zip đệ quy)
src/lib/builder.ts              build theo network, đóng gói zip, kiểm tra
src/lib/channels.ts             danh sách network và biến thể
src/lib/preview.ts              giả lập SDK và bắt log cho khung chơi thử
src/lib/media.ts                co ảnh về kích thước gốc, đo thời lượng audio
src/components/*                giao diện
```

## Giới hạn hiện tại

- Không tự nén lại tài nguyên thành `window.__zip` như super-html. Trạng thái nén của file gốc được giữ nguyên.
- Audio đổi định dạng (vd. mp3 → ogg) chỉ có cảnh báo, không tự chuyển mã.
- Asset bị chia nhỏ thành nhiều chuỗi nối (`"abc"+"def"`) hoặc nén riêng theo engine (Unity Luna, texture nén ASTC/KTX) không thay được trực tiếp.
- Model 3D: tách vật liệu được cho `.glb` tự chứa (1 buffer nhúng — trường hợp phổ biến nhất khi export từ Three.js/Blender/Babylon) và cho `.fbx` nhị phân (màu vật liệu luôn tách được; texture nhúng chỉ tách được nếu file `.fbx` có nhúng thật — nhiều file export (vd. từ Blender) chỉ ghi đường dẫn ảnh ngoài máy người làm, không có dữ liệu ảnh nào trong chính file để lấy ra). `.gltf` rời kèm `.bin`/ảnh riêng, hay model đóng gói trong Unity AssetBundle/Cocos Creator build (WebGL) thì chỉ thay được nguyên khối model (nếu tool tìm thấy nó như 1 file nhị phân) — các engine này luôn chuyển FBX gốc sang định dạng riêng khi build, không nhúng thẳng file `.fbx`/`.glb` gốc vào bản chạy thử.
