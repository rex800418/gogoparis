# 報修登記系統

純 HTML/CSS/JavaScript 的手機友善報修表單與最近 20 筆清單。首頁為根目錄的 `index.html`，不需建置；以 CDN 載入 supabase-js v2。

操作文件：[報修系統操作說明.docx](文件/報修系統操作說明.docx)

提案簡報：[報修登記系統提案.pptx](文件/報修登記系統提案.pptx)

## 使用與部署

- 本機預覽：`python3 -m http.server 8000`，開啟 `http://localhost:8000`。
- GitHub Pages：設定來源為 **Deploy from a branch → main → / (root)**。
- 預期網址：<https://rex800418.github.io/gogoparis/>（若有自訂網域，以 Pages 設定為準）。
- `config.js` 只放專案網址與可公開的 publishable key；不可放 secret 或 service role key。
- Supabase 專案管理者須先執行並確認 `supabase/schema.sql` 的欄位授權與 RLS 已啟用。此網頁不會建立或修改資料表。
- 示範只用虛構姓名及地點，所有訪客都能讀取清單。

表單送出 `reporter_name`、`location`、`category`、`description`、`urgency`；不送出 `status`、`id` 或 `created_at`，由資料庫產生。清單依 `created_at` 降冪取 20 筆，登記時間顯示為台北時間。新增成功後清空表單並刷新清單；失敗時保留表單，清單可手動重試。

## 緊急程度篩選

清單上方提供「全部／高／中／低」按鈕，預設選取「全部」，選取的按鈕以深綠底與白字顯示。點選後只篩選網頁已載入的最近 20 筆紀錄，不會額外查詢資料庫，也不代表所有歷史報修。若該程度沒有資料，畫面會顯示提示；按「全部」可恢復原清單順序。

緊急程度「高」的標籤使用紅字與淡紅底。重新整理清單或送出新報修後，仍維持目前篩選；重新載入整個網頁則回到「全部」。本次未變更資料庫、欄位、權限或 `supabase/` 內任何檔案。

手機確認：在電腦切換到 PR 分支 `feat/urgency-list-filter`，執行 `python3 -m http.server 8000`；手機與電腦連同一個 Wi-Fi，開啟 `http://電腦的區域網路IP:8000`（電腦須允許區域網路存取此連接埠）。依序點「高／中／低／全部」，檢查選取樣式、顯示內容與空清單提示，並確認「高」標籤為紅色。PR 尚未合併時，正式 GitHub Pages 網站不會包含這次變更。

## PWA 安裝與離線使用

網站已加入 Web App Manifest、192/512px 圖示、maskable 圖示、Apple touch icon 與 service worker，支援 GitHub Pages 的 `/gogoparis/` 子路徑。資料表、權限與既有五個報修欄位均未變更。

- **Android Chrome**：線上開啟網站後，可按頁面出現的「安裝報修 App」，或使用瀏覽器選單的「安裝應用程式／加到主畫面」。安裝按鈕只在瀏覽器提供安裝提示時出現。
- **iPhone／iPad**：用 Safari 開啟網站，選分享 →「加入主畫面」；若系統提供選項，啟用「作為網頁 App 開啟」。
- 安裝後可從主畫面以獨立視窗開啟。是否顯示安裝選項依裝置與瀏覽器而定；首次使用須連線，並等待 service worker 完成下載。瀏覽器清除或回收網站儲存空間後，需要重新連線建立快取。
- **離線範圍**：快取首頁、樣式、程式、公開設定、manifest、圖示及可成功下載的 CDN SDK。離線可重新開啟已快取網頁、填寫表單；SDK 若未成功快取，表單會顯示元件載入失敗，需恢復連線再開啟。
- **報修仍需網路**：離線按送出會明確提示尚未送出，保留本頁輸入；不會儲存離線佇列或在恢復連線時自動補送。關閉、重新載入或更新頁面會遺失未送出內容，請連線後再手動送出。
- **清單不做離線持久保存**：本次頁面已載入的紀錄在離線時可繼續篩選；重新開啟離線頁面不會顯示之前的紀錄。恢復連線會重新讀取清單。service worker 不快取 Supabase API、報修寫入或文件下載。
- **版本更新**：有新版時顯示「套用更新並重新載入」，先處理未送出的表單再按。更新等待使用者操作，不會自動重新載入目前表單；首次安裝也不會觸發強制重載。

本機可用 `python3 -m http.server 8000`，以 `http://localhost:8000` 驗證。正式安裝與 service worker 需要 HTTPS（GitHub Pages 已提供）或 localhost；手機使用電腦的普通區網 HTTP 位址只能驗證一般網頁，不能據此驗證 PWA。

維護：修改任何快取檔案或 SDK URL 時，必須同步提高 `sw.js` 的 `VERSION`，讓瀏覽器取得完整的新快取。快取名稱含本站 scope，只清理此 App 的舊版本，不影響同網域其他網站。

PWA 驗證：`npm test` 包含實際 service worker 測試，使用 `/gogoparis/` 子路徑、真實 SDK 的本機代理與模擬 API，檢查 manifest/圖示、離線重載、離線不送出、不快取報修資料、恢復連線、更新下載失敗保留舊版、使用者套用更新及 scope 隔離。這不代表已在每款手機實測安裝，也不代表正式 Supabase 權限已驗證。

## 開發與檢查

Node.js 18 以上，先執行 `npm ci`。正式網站不依賴 Node.js。

- `npm run format`：以固定版本 Prettier 格式化。
- `npm run check`：JavaScript 語法及格式檢查。
- `npm test`：Playwright 瀏覽器測試；預設使用 `/usr/bin/chromium`，可用 `CHROMIUM_PATH` 指定其他 Chromium。

測試需要 curl 與 CDN 連線，使用真正的 supabase-js SDK 並模擬 REST API，驗證欄位、五欄新增內容、資料庫預設欄位未送出、成功/失敗/重試、前 20 筆清單、安全文字渲染及 320/390/1280px 版面。截圖輸出至 `docs/mobile.png`、`docs/desktop.png`。

本次雲端環境的網路政策拒絕 Supabase 與 GitHub Pages 網域，因此未實測遠端資料表的讀寫、預設值或 RLS，也未從此環境開啟正式站。模擬測試不代表正式資料庫權限已驗證。正式站驗證時，請確認公開用戶端能新增/讀取、不能修改/刪除，且新增後狀態為「待處理」、登記時間由資料庫產生。

## 畫面預覽（模擬資料）

![手機版](docs/mobile.png)
![桌面版](docs/desktop.png)
