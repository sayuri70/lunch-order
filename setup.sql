-- ============================================================
-- 午餐點餐系統 - 資料庫建置腳本
-- 請在 Supabase SQL Editor 中執行此檔案
-- ============================================================

-- 餐廳
CREATE TABLE restaurants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  type TEXT NOT NULL CHECK (type IN ('meal', 'drink')),
  menu_image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 菜單分類
CREATE TABLE menu_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0
);

-- 菜單品項
CREATE TABLE menu_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  price INT,
  sizes JSONB DEFAULT '[]',
  has_sweetness BOOLEAN DEFAULT FALSE,
  has_ice BOOLEAN DEFAULT FALSE,
  notes TEXT,
  is_available BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0
);

-- 加料選項（飲料店用）
CREATE TABLE toppings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INT NOT NULL,
  sort_order INT DEFAULT 0
);

-- 錢包類型
CREATE TABLE wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 員工
CREATE TABLE employees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  balance INT DEFAULT 0,
  is_admin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 員工錢包餘額
CREATE TABLE employee_wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  balance INT DEFAULT 0,
  UNIQUE(employee_id, wallet_id)
);

-- 每日點餐場次
CREATE TABLE order_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  meal_restaurant_id UUID REFERENCES restaurants(id),
  drink_restaurant_id UUID REFERENCES restaurants(id),
  wallet_id UUID REFERENCES wallets(id),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'ordered')),
  deadline TIME,
  notes TEXT,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 訂單（每人每場次一筆）
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES order_sessions(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  total_amount INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, employee_id)
);

-- 訂單明細
CREATE TABLE order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id),
  item_name TEXT NOT NULL,
  size_name TEXT,
  base_price INT NOT NULL,
  quantity INT DEFAULT 1,
  sweetness TEXT,
  ice TEXT,
  toppings JSONB DEFAULT '[]',
  toppings_price INT DEFAULT 0,
  notes TEXT,
  item_type TEXT DEFAULT 'meal' CHECK (item_type IN ('meal', 'drink', 'extra')),
  total_price INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 索引
-- ============================================================
CREATE INDEX idx_menu_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX idx_menu_items_name ON menu_items USING gin(name gin_trgm_ops);
CREATE INDEX idx_order_sessions_date ON order_sessions(date);
CREATE INDEX idx_orders_session ON orders(session_id);
CREATE INDEX idx_orders_employee ON orders(employee_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- 啟用 trigram 擴充（用於模糊搜尋）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- RLS 政策（公司內部工具，允許所有操作）
-- ============================================================
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE toppings ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON restaurants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON menu_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON menu_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON toppings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON wallets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON employee_wallets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON order_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON order_items FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 函式：計算訂單總額
-- ============================================================
CREATE OR REPLACE FUNCTION update_order_total()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders SET
    total_amount = (SELECT COALESCE(SUM(total_price), 0) FROM order_items WHERE order_id = COALESCE(NEW.order_id, OLD.order_id)),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_order_total
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION update_order_total();

-- ============================================================
-- 函式：當日訂單彙整
-- ============================================================
CREATE OR REPLACE FUNCTION get_daily_summary(p_session_id UUID)
RETURNS TABLE (
  item_name TEXT,
  size_name TEXT,
  item_type TEXT,
  quantity BIGINT,
  unit_price INT,
  notes_list TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    oi.item_name,
    oi.size_name,
    oi.item_type,
    SUM(oi.quantity)::BIGINT AS quantity,
    oi.base_price AS unit_price,
    ARRAY_AGG(DISTINCT oi.notes) FILTER (WHERE oi.notes IS NOT NULL AND oi.notes != '') AS notes_list
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.session_id = p_session_id
  GROUP BY oi.item_name, oi.size_name, oi.item_type, oi.base_price
  ORDER BY oi.item_type, oi.item_name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 函式：個人月結算
-- ============================================================
CREATE OR REPLACE FUNCTION get_monthly_summary(p_employee_id UUID, p_year INT, p_month INT)
RETURNS TABLE (
  order_date DATE,
  restaurant_name TEXT,
  items_detail TEXT,
  day_total INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    os.date AS order_date,
    r.name AS restaurant_name,
    STRING_AGG(oi.item_name || COALESCE(' (' || oi.size_name || ')', ''), '、') AS items_detail,
    o.total_amount AS day_total
  FROM orders o
  JOIN order_sessions os ON os.id = o.session_id
  LEFT JOIN restaurants r ON r.id = os.meal_restaurant_id
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.employee_id = p_employee_id
    AND EXTRACT(YEAR FROM os.date) = p_year
    AND EXTRACT(MONTH FROM os.date) = p_month
  GROUP BY os.date, r.name, o.total_amount
  ORDER BY os.date;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 種子資料：3 間餐廳
-- ============================================================

-- === 惠香嘉義火雞肉飯（中央店）===
INSERT INTO restaurants (id, name, phone, address, type, sort_order)
VALUES ('a1000000-0000-0000-0000-000000000001', '惠香嘉義火雞肉飯（中央店）', '8261-2680', '新北市土城區中央路二段264號', 'meal', 1);

-- 分類
INSERT INTO menu_categories (id, restaurant_id, name, sort_order) VALUES
('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '飯類', 1),
('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '湯類', 2),
('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '麵類', 3),
('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '各式小菜', 4),
('c1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', '便當類', 5);

-- 飯類
INSERT INTO menu_items (restaurant_id, category_id, name, sizes, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '火雞肉飯', '[{"name":"大","price":60},{"name":"中","price":50},{"name":"小","price":40}]', 1),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '滷肉飯', '[{"name":"大","price":60},{"name":"中","price":50},{"name":"小","price":40}]', 2),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '焢肉飯', '[{"name":"大","price":60},{"name":"小","price":50}]', 3),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '赤肉羹飯', '[]', 4);
UPDATE menu_items SET price = 70 WHERE name = '赤肉羹飯' AND restaurant_id = 'a1000000-0000-0000-0000-000000000001';

INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '虱目魚肚粥（無刺）', 140, 5);

INSERT INTO menu_items (restaurant_id, category_id, name, sizes, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '雞腿飯', '[{"name":"大","price":80},{"name":"中","price":70}]', 6);

-- 湯類
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '虱目魚肚湯（無刺）', 130, 1),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '粉腸湯', 60, 2),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '肝連湯', 60, 3),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '苦瓜排骨湯', 60, 4),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '赤肉羹湯', 60, 5),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '味噌湯', 30, 6),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '貢丸湯', 30, 7),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '紫菜蛋花湯', 30, 8),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', '青菜蛋花湯', 30, 9);

-- 麵類
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '豬腳麵/米粉/板條', 110, 1),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '排骨麵/米粉/冬粉', 100, 2),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '赤肉羹麵/冬粉', 70, 3),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '赤肉羹米粉/板條', 70, 4),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '切仔麵（湯/乾）', 40, 5),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '切仔米粉（湯/乾）', 40, 6),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '客家板條（湯/乾）', 40, 7);

-- 各式小菜
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '鹹蒸虱目魚（無刺）', 130, 1),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '鹹蒸吳郭魚', 100, 2),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '火雞翅膀', 110, 3),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '白切火雞肉', 90, 4),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '火雞尾椎', 90, 5),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '白切粉腸', 60, 6),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '白切肝連', 60, 7),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '紅燒肉（瘦/三層）', 70, 8),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '炸雞腿', 60, 9),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '滷豬腳', 60, 10),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '炸排骨', 55, 11),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '豬耳朵', 40, 12),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '滷豬皮', 40, 13),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '海蜇皮', 40, 14),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '焢肉', 60, 15),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '燙青菜', 40, 16),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '鳳爪', 40, 17),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '鴨賞', 40, 18),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '蝦捲', 35, 19),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '燙青菜', 40, 20),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '皮蛋豆腐', 35, 21),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '滷豆腐', 15, 22),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '滷蛋', 15, 23);

INSERT INTO menu_items (restaurant_id, category_id, name, sizes, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '醃蘿蔔', '[{"name":"內用","price":30},{"name":"外帶","price":50}]', 24),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '滷白菜', '[{"name":"大","price":60},{"name":"小","price":40}]', 25),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000004', '滷桂竹筍', '[{"name":"大","price":60},{"name":"小","price":40}]', 26);

-- 便當類
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '虱目魚便當（無刺）', 180, 1),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '火雞肉片便當', 150, 2),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '吳郭魚便當', 150, 3),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '豬腳便當', 120, 4),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '雞腿飯便當', 120, 5),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '焢肉飯便當', 110, 6),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '排骨飯便當', 110, 7),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '燒肉飯便當', 100, 8),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '蝦捲飯便當', 100, 9),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '火雞肉飯便當', 100, 10),
('a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000005', '滷肉飯便當', 100, 11);

-- === 相家。雞 ===
INSERT INTO restaurants (id, name, phone, address, type, sort_order)
VALUES ('a1000000-0000-0000-0000-000000000002', '相家。雞', '(02) 8275-2600', '新北市板橋區大觀路2段142號', 'meal', 2);

INSERT INTO menu_categories (id, restaurant_id, name, sort_order) VALUES
('c2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', '白飯', 1),
('c2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', '油飯', 2),
('c2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', '白飯便當', 3),
('c2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', '油飯便當', 4),
('c2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', '小菜', 5),
('c2000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000002', '炸物', 6),
('c2000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000002', '湯品', 7),
('c2000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000002', '單點', 8),
('c2000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000002', '飲品', 9);

-- 白飯
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', '打拋豬滷飯（含蛋微辣）', 60, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', '埔里香菇油飯（素）', 55, 2),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', '相家雞肉飯', 60, 3);

-- 白飯便當
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000003', '腿肉雞飯', 110, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000003', '招牌九兩雞腿飯', 140, 2),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000003', '蒜炸醬汁雞排飯', 140, 3),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000003', '雞豬雙拼飯（微辣）', 155, 4),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000003', '七兩去骨椒麻雞腿飯', 160, 5),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000003', '霸王炸雞腿飯（每日限量）', 170, 6);

-- 油飯便當
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000004', '腿肉雞油飯', 120, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000004', '九兩雞腿油飯', 150, 2),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000004', '蒜炸醬汁雞排油飯', 150, 3),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000004', '霸王炸雞腿油飯（每日限量）', 180, 4);

-- 小菜
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000005', '秘製滷豆皮', 50, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000005', '開胃小黃瓜', 50, 2),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000005', '牛奶燉高麗菜', 50, 3),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000005', '紫蘇梅山苦瓜', 55, 4),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000005', '胡麻堅果青花菜', 60, 5);

-- 炸物
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000006', '醬汁炸豆腐', 50, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000006', '椒鹽蒜香四季豆', 60, 2),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000006', '金沙醬炸玉米筍', 60, 3),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000006', '香酥雞柳（蜂蜜芥末醬）', 60, 4);

-- 湯品
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000007', '清燉蘿蔔湯', 35, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000007', '爆汁魚丸蘿蔔湯', 65, 2),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000007', '手工古早貢丸蘿蔔湯', 65, 3);

-- 單點
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '半熟荷包蛋', 20, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '白米飯', 15, 2),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '雞油醬汁白米飯', 20, 3),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '埔里香菇油飯（素）1斤', 140, 4),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '相家蔥薑醬1罐（200g）', 160, 5),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '相家九兩雞腿', 115, 6),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '相家十八兩雞腿', 220, 7),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '蒜炸醬汁大雞排', 115, 8),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '七兩去骨椒麻雞腿', 135, 9),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000008', '霸王炸雞腿（每日限量）', 145, 10);

-- 飲品
INSERT INTO menu_items (restaurant_id, category_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000009', '冬瓜烏檸檬', 50, 1),
('a1000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000009', '梨山高冷茶', 50, 2);

-- === 有飲（飲料店）===
INSERT INTO restaurants (id, name, phone, address, type, sort_order)
VALUES ('a1000000-0000-0000-0000-000000000003', '有飲', '2266-1919', '', 'drink', 3);

INSERT INTO menu_categories (id, restaurant_id, name, sort_order) VALUES
('c3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', '來找茶啦', 1),
('c3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003', '找涼飲果茶', 2),
('c3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', '金勾意奶茶', 3),
('c3000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000003', '有影真功夫優格飲', 4),
('c3000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000003', '懷舊椪糖', 5),
('c3000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000003', '渾厚鮮奶小鎮', 6),
('c3000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000003', '厚道乳香奶霜', 7);

-- 加料
INSERT INTO toppings (restaurant_id, name, price, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', '珍珠', 10, 1),
('a1000000-0000-0000-0000-000000000003', '寒天纖果', 15, 2),
('a1000000-0000-0000-0000-000000000003', '蜜燕麥', 15, 3),
('a1000000-0000-0000-0000-000000000003', '椪糖Q粿', 15, 4),
('a1000000-0000-0000-0000-000000000003', '椪糖凍', 15, 5);

-- 來找茶啦
INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', '古早味憨厚紅茶', 35, TRUE, TRUE, 1),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', '斯里蘭卡醇紅茶', 40, TRUE, TRUE, 2),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', '尚青四季春茶', 40, TRUE, TRUE, 3),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', '醇焙烏龍茶', 40, TRUE, TRUE, 4),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', '焙香黃金穀物茶', 40, TRUE, TRUE, 5);

-- 找涼飲果茶
INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000002', '蜜香檸檬四季春', 65, TRUE, TRUE, 1),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000002', '多肉鳳梨焙烏龍', 65, TRUE, TRUE, 2),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000002', '蜜釀蘋果四季', 65, TRUE, TRUE, 3),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000002', '台灣柳丁四季', 70, TRUE, TRUE, 4),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000002', '炎炎夏日水果茶', 75, TRUE, TRUE, 5);

-- 金勾意奶茶
INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '古早味憨厚奶茶', 45, TRUE, TRUE, 1),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '斯里蘭卡厚奶茶', 50, TRUE, TRUE, 2),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '尚青四季奶茶', 50, TRUE, TRUE, 3),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '醇焙烏龍奶茶', 50, TRUE, TRUE, 4),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '焙香穀物奶茶', 50, TRUE, TRUE, 5),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '珍珠奶茶爆擊', 50, TRUE, TRUE, 6),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '小時候ㄟ麵茶奶茶', 60, TRUE, TRUE, 7),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000003', '濃萃可可奶茶', 65, TRUE, TRUE, 8);

-- 有影真功夫優格飲
INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000004', '粉紅泡泡草莓優優', 80, FALSE, FALSE, 1),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000004', '臉紅紅蘋果優優', 75, FALSE, FALSE, 2),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000004', '台灣囝仔鳳梨優優', 75, FALSE, FALSE, 3),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000004', '酸甘甜百香果優優', 75, FALSE, FALSE, 4),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000004', '咔滋咔滋椪糖優優', 70, FALSE, FALSE, 5);

-- 懷舊椪糖
INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '焦香椪糖紅茶', 45, TRUE, TRUE, 1),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '焦香椪糖四季春', 50, TRUE, TRUE, 2),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '焦香椪糖奶茶', 60, TRUE, TRUE, 3);

INSERT INTO menu_items (restaurant_id, category_id, name, has_sweetness, has_ice, sort_order, sizes) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '焦香椪糖鮮奶茶', TRUE, FALSE, 4, '[{"name":"M","price":65},{"name":"L","price":80}]'),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '椪糖粿鮮奶茶', TRUE, FALSE, 5, '[{"name":"M","price":65},{"name":"L","price":80}]'),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '椪糖凍鮮奶茶', TRUE, FALSE, 6, '[{"name":"M","price":65},{"name":"L","price":80}]');

INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '椪糖冰淇淋紅茶', 70, TRUE, TRUE, 7),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '椪糖奶霜紅茶', 75, TRUE, TRUE, 8),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000005', '椪糖風味奶霜紅茶', 75, TRUE, TRUE, 9);

-- 渾厚鮮奶小鎮
INSERT INTO menu_items (restaurant_id, category_id, name, has_sweetness, has_ice, sort_order, sizes) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '憨厚紅茶鮮奶茶', TRUE, FALSE, 1, '[{"name":"M","price":55},{"name":"L","price":65}]'),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '斯里蘭卡鮮奶茶', TRUE, FALSE, 2, '[{"name":"M","price":60},{"name":"L","price":70}]'),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '尚青四季鮮奶茶', TRUE, FALSE, 3, '[{"name":"M","price":60},{"name":"L","price":70}]'),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '醇焙烏龍鮮奶茶', TRUE, FALSE, 4, '[{"name":"M","price":60},{"name":"L","price":70}]'),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '焙香穀物鮮奶茶', TRUE, FALSE, 5, '[{"name":"M","price":60},{"name":"L","price":70}]');

INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '黑糖珍珠鮮奶茶', 70, TRUE, FALSE, 6),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '醇濃可可鮮奶', 65, FALSE, FALSE, 7);

INSERT INTO menu_items (restaurant_id, category_id, name, has_sweetness, has_ice, sort_order, sizes) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '醇濃可可鮮奶', TRUE, FALSE, 7, '[{"name":"M","price":65},{"name":"L","price":75}]');

INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '草莓可可鮮奶', 65, FALSE, FALSE, 8),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '燕麥可可鮮奶', 65, FALSE, FALSE, 9),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000006', '珍珠鮮奶', 70, TRUE, FALSE, 10);

-- 厚道乳香奶霜
INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order) VALUES
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000007', '玫瑰鹽奶霜紅茶', 70, TRUE, TRUE, 1),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000007', '椪糖奶霜紅茶', 75, TRUE, TRUE, 2),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000007', '椪糖風味奶霜紅茶', 75, TRUE, TRUE, 3),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000007', '醇濃可可奶霜', 80, FALSE, FALSE, 4),
('a1000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000007', '草莓可可奶霜', 80, FALSE, FALSE, 5);

-- 單點區
INSERT INTO menu_items (restaurant_id, category_id, name, price, has_sweetness, has_ice, sort_order, notes) VALUES
('a1000000-0000-0000-0000-000000000003', NULL, '椪糖脆脆', 20, FALSE, FALSE, 100, '單點小食');

-- === 種子資料：錢包 ===
INSERT INTO wallets (name, sort_order) VALUES
('技術部錢包', 1),
('總務錢包', 2);

-- === 測試員工 ===
INSERT INTO employees (name, balance, is_admin) VALUES
('管理員', 0, TRUE);
