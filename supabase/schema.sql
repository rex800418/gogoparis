-- 報修登記系統：供 Supabase 專案管理者審閱後手動執行的初始建表腳本。
-- 本檔不會自動執行；目標為尚未存在的 public.repair_requests。
-- 使用交易確保建表、權限與資料列安全設定一併完成；重複執行會報錯。
BEGIN;

-- 建立資料表：識別碼及建立時間由資料庫產生，時間以具時區型態儲存。
-- 本版將所有業務欄位設為必填；文字長度為本次設計值，正式上線前需確認。
CREATE TABLE public.repair_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    reporter_name text NOT NULL,
    location text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    urgency text NOT NULL DEFAULT '中',
    status text NOT NULL DEFAULT '待處理',

    -- 文字檢查：禁止空字串及只有常見空白的內容，並限制字元數。
    -- 姓名最多 100 字、地點最多 200 字、問題說明最多 5000 字。
    CONSTRAINT repair_requests_reporter_name_check
        CHECK (char_length(reporter_name) BETWEEN 1 AND 100
               AND reporter_name ~ '[^[:space:]]'),
    CONSTRAINT repair_requests_location_check
        CHECK (char_length(location) BETWEEN 1 AND 200
               AND location ~ '[^[:space:]]'),
    CONSTRAINT repair_requests_description_check
        CHECK (char_length(description) BETWEEN 1 AND 5000
               AND description ~ '[^[:space:]]'),

    -- 選項檢查：只接受指定的繁體中文值，不接受其他值或空值。
    CONSTRAINT repair_requests_category_check
        CHECK (category IN ('設備', '網路', '環境', '其他')),
    CONSTRAINT repair_requests_urgency_check
        CHECK (urgency IN ('低', '中', '高')),
    CONSTRAINT repair_requests_status_check
        CHECK (status IN ('待處理', '處理中', '已完成'))
);

-- 第一層：明確清除一般用戶端角色的資料表權限，避免依賴專案預設授權。
-- 本表僅開放未登入的 anon；authenticated 不在本次授權範圍。
-- PUBLIC 是所有資料庫角色的共同角色，必須一併撤銷。
REVOKE ALL PRIVILEGES ON TABLE public.repair_requests
    FROM PUBLIC, anon, authenticated;

-- anon 需有結構描述使用權，才能依下列授權存取本表。
-- 只授予查詢，以及表單需要的五個新增欄位；未授予整表 INSERT。
-- id、created_at、status 不可由 anon 指定，分別使用資料庫預設值。
-- 未授予 UPDATE、DELETE、TRUNCATE 或其他資料表操作權限。
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON TABLE public.repair_requests TO anon;
GRANT INSERT (reporter_name, location, category, description, urgency)
    ON TABLE public.repair_requests TO anon;

-- 第二層：啟用資料列安全；未設更新或刪除政策，預設拒絕這些操作。
ALTER TABLE public.repair_requests ENABLE ROW LEVEL SECURITY;

-- 所有使用 anon 的未登入訪客都可查看清單；資料沒有個人隔離。
CREATE POLICY repair_requests_anon_select
    ON public.repair_requests
    FOR SELECT
    TO anon
    USING (true);

-- 新增資料的狀態必須為「待處理」，與欄位權限及預設值共同限制初始狀態。
CREATE POLICY repair_requests_anon_insert
    ON public.repair_requests
    FOR INSERT
    TO anon
    WITH CHECK (status = '待處理');

-- 第三層：上方具名 CHECK 與 NOT NULL 約束限制所有寫入的值及文字長度。
-- 資料表擁有者、具 BYPASSRLS 的角色及 Supabase 高權限服務金鑰
-- 不受一般 anon 的授權與 RLS 限制；服務金鑰不可放入前端。
COMMIT;
