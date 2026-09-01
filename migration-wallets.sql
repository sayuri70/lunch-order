-- ============================================================
-- Migration: 多錢包系統
-- 在 Supabase SQL Editor 中執行此檔案
-- ============================================================

-- 1. 錢包類型
CREATE TABLE IF NOT EXISTS wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON wallets FOR ALL USING (true) WITH CHECK (true);

-- 2. 員工錢包餘額（每人每個錢包一筆）
CREATE TABLE IF NOT EXISTS employee_wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  balance INT DEFAULT 0,
  UNIQUE(employee_id, wallet_id)
);

ALTER TABLE employee_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON employee_wallets FOR ALL USING (true) WITH CHECK (true);

-- 3. order_sessions 加 wallet_id（開團時選擇扣款錢包）
ALTER TABLE order_sessions ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES wallets(id);

-- 4. wallet_transactions 加 wallet_id
ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS wallet_id UUID REFERENCES wallets(id);

-- 5. 建立兩個錢包
INSERT INTO wallets (name, sort_order) VALUES
  ('技術部錢包', 1),
  ('總務錢包', 2);

-- 6. 將現有員工餘額遷移到第一個錢包（技術部）
INSERT INTO employee_wallets (employee_id, wallet_id, balance)
SELECT e.id, w.id, e.balance
FROM employees e
CROSS JOIN wallets w
WHERE w.sort_order = 1
ON CONFLICT (employee_id, wallet_id) DO NOTHING;

-- 7. 為所有員工在第二個錢包建立 0 餘額記錄
INSERT INTO employee_wallets (employee_id, wallet_id, balance)
SELECT e.id, w.id, 0
FROM employees e
CROSS JOIN wallets w
WHERE w.sort_order = 2
ON CONFLICT (employee_id, wallet_id) DO NOTHING;
