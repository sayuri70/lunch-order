-- 新增一沐日加料選項
-- 在 Supabase SQL Editor 執行此檔案

INSERT INTO toppings (restaurant_id, name, price, sort_order)
SELECT id, '招牌粉粿', 15, 1 FROM restaurants WHERE name = '一沐日'
UNION ALL
SELECT id, '草仔粿', 15, 2 FROM restaurants WHERE name = '一沐日'
UNION ALL
SELECT id, '雙粉（粉粿＋粉圓）', 15, 3 FROM restaurants WHERE name = '一沐日'
UNION ALL
SELECT id, '琥珀粉圓', 10, 4 FROM restaurants WHERE name = '一沐日'
UNION ALL
SELECT id, '蘆薈', 15, 5 FROM restaurants WHERE name = '一沐日'
UNION ALL
SELECT id, '嫩仙草', 10, 6 FROM restaurants WHERE name = '一沐日';
