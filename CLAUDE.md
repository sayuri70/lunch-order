# 吃飽喝足點餐系統 — Claude Code 工作手冊

## 專案簡介

公司內部午餐點餐系統，供員工每日點正餐與飲料。後端使用 Supabase，前端為純 HTML/CSS/JS 單頁應用，無任何框架或建置工具。

## 技術架構

| 層次 | 技術 |
|------|------|
| 前端 | 純 Vanilla JS（ES2020+）、HTML5、CSS3 |
| 後端 | Supabase（PostgreSQL + REST API + RLS） |
| 狀態管理 | 單一全域 `state` 物件（app.js L21） |
| 部署 | 靜態檔案，可直接用瀏覽器開啟或部署至任何靜態 hosting |

**絕對不能引入 CDN 或外部字體**：此系統在 LINE 瀏覽器中使用，LINE 的安全政策會封鎖外部資源，導致畫面空白。所有資源必須內嵌或自行提供。

## 檔案結構

```
lunch-order/
├── index.html    # 整個 SPA 的 HTML 結構，含所有 view/modal 的 DOM
├── app.js                  # 全部業務邏輯，無 import/export
├── style.css               # 全站樣式
├── setup.sql               # Supabase 資料庫建置腳本（初次部署時執行一次）
└── migration-wallets.sql   # 多錢包系統遷移腳本（既有資料庫執行一次）
```

## 資料庫 Schema（Supabase）

| 資料表 | 用途 |
|--------|------|
| `restaurants` | 餐廳/飲料店，`type` 欄位區分 `meal`/`drink` |
| `menu_categories` | 菜單分類，屬於某間餐廳 |
| `menu_items` | 菜單品項，含 `sizes`（JSON，存多種規格與價格） |
| `toppings` | 飲料加料選項 |
| `wallets` | 錢包類型（如技術部錢包、總務錢包） |
| `employees` | 員工清單，含 `is_admin`；`balance` 已棄用，改用 `employee_wallets` |
| `employee_wallets` | 員工錢包餘額，每人每個錢包一筆（`employee_id` + `wallet_id` 唯一） |
| `order_sessions` | 點餐團，含 `wallet_id` 指定扣款錢包 |
| `orders` | 個人訂單，屬於某個 session 與某位員工 |
| `order_items` | 訂單明細，一筆訂單可有多個品項，`quantity` 支援多數量 |
| `wallet_transactions` | 錢包交易紀錄，含 `wallet_id`、`type`、`amount`、`notes` |

RLS 政策全部設為 `allow_all`（內部系統，無需細緻權限控管）。

資料庫 functions：
- `update_order_total()` — trigger，更新訂單總金額
- `get_daily_summary(p_session_id)` — 彙整某場團的所有訂單
- `get_monthly_summary(p_employee_id, p_year, p_month)` — 個人月結紀錄

## app.js 架構分區

| 行數範圍 | 功能區塊 |
|----------|---------|
| L1–35 | 常數定義（Supabase 連線、甜度/冰塊選項）、state 物件 |
| L36–86 | API 層：`api()` 函式（REST）、`rpc()` 函式（PostgreSQL function） |
| L87–145 | Navigation、Toast 提示 |
| L102–145 | Identity（選擇/切換使用者） |
| L146–431 | Session 管理（載入、選擇、顯示點餐表單） |
| L432–716 | 搜尋邏輯、尺寸 Modal、飲料客製化 Modal |
| L717–823 | 渲染已選品項、提交訂單 |
| L824–963 | 彙整頁（Summary） |
| L964–1053 | 歷史紀錄頁（History） |
| L1054–1691 | 管理頁：餐廳管理、員工管理、菜單管理、Session 管理 |
| L1692–1812 | 轉轉樂（隨機飲料）、菜單照片縮放 |
| L1814–1918 | 錢包頁（Wallet） |
| L1919–end | 初始化（`init()`） |

## 核心慣例

### State 管理
所有動態資料集中在 `state` 物件（L21）。異步載入後直接更新 state，再呼叫對應的 render 函式。不使用任何響應式框架。

### API 呼叫
```js
// REST 查詢
await api('table_name', { params: { column: 'eq.value', select: '*' } });

// REST 寫入
await api('table_name', { method: 'POST', body: { ... } });

// 呼叫 PostgreSQL function
await rpc('function_name', { param1: value1 });
```

### UI 更新
全部用 `innerHTML` 字串插入，沒有 virtual DOM。修改 UI 時找到對應的 `render*` 函式直接改 HTML 樣板字串。

### 管理員判斷
```js
const isAdmin = state.currentUser?.is_admin === true;
```
`applyAdminVisibility()`（L130）統一控制管理員專屬 UI 的顯示/隱藏。

### 錯誤處理
使用 `toast(msg)` 顯示操作回饋，`try/catch` 包 API 呼叫並 `toast` 錯誤訊息。

## 常見開發場景

**新增菜單欄位**：修改 `setup.sql` 加欄位 → 到 Supabase SQL Editor 執行 ALTER TABLE → 更新 `app.js` 中對應的讀取/渲染邏輯。

**新增頁面**：在 `index.html` 加 `<section id="view-xxx" class="view">` → 在 nav 加按鈕 → 在 app.js 的 navigation 事件監聽器加 `if (view === 'xxx') loadXxx()` → 實作 `loadXxx()`。

**修改飲料客製化選項**：`SWEETNESS_OPTIONS`（L8）和 `ICE_OPTIONS`（L9）是常數陣列，直接修改。

## 注意事項

- **不能用 `Date.now()` 或 `new Date()` 儲存到資料庫時間**：時間欄位交由 Supabase `DEFAULT NOW()` 產生，前端只傳必要的業務日期（如 `YYYY-MM-DD` 字串）。
- **金額單位一律為整數（元）**，不處理小數。
- **`menu_items.sizes`** 儲存為 JSON 字串，解析用 `parseSizes()`（L493）。
- **Google Drive 圖片 URL** 需經 `toDirectImageUrl()`（L11）轉換才能在 `<img>` 正常顯示。
