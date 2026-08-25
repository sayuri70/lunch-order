// ============================================================
// 午餐點餐系統
// ============================================================

const SUPABASE_URL = 'https://psyronkxtovwybqwtotv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KbfVHbfTr5VgH2t7kuVMCQ_2C8639ev';

const SWEETNESS_OPTIONS = ['全糖', '七分糖', '五分糖', '三分糖', '一分糖', '無糖'];
const ICE_OPTIONS = ['正常冰', '少冰', '微冰', '去冰', '溫飲', '熱飲'];

// ---- State ----
const state = {
  currentUser: null,
  employees: [],
  restaurants: [],
  currentSession: null,
  mealMenuItems: [],
  drinkMenuItems: [],
  drinkToppings: [],
  selectedMeals: [],
  selectedDrinks: [],
  selectedExtras: [],
  existingOrder: null,
  historyYear: new Date().getFullYear(),
  historyMonth: new Date().getMonth() + 1,
};

// ---- API helpers ----
async function api(path, options = {}) {
  const { method = 'GET', body, params } = options;
  let url = `${SUPABASE_URL}/rest/v1/${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'GET' ? '' : 'return=representation',
  };
  if (!headers['Prefer']) delete headers['Prefer'];
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function rpc(fn, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`RPC error: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---- Toast ----
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ---- Navigation ----
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    if (view === 'summary') loadSummary();
    if (view === 'history') loadHistory();
    if (view === 'admin') loadAdmin();
  });
});

// ---- Identity ----
async function loadEmployees() {
  state.employees = await api('employees', {
    params: { select: '*', is_active: 'eq.true', order: 'name' }
  });
  renderEmployeeModal();
}

function renderEmployeeModal() {
  const grid = document.getElementById('employee-list');
  grid.innerHTML = state.employees.map(e =>
    `<button class="employee-btn" data-id="${e.id}">${e.name}</button>`
  ).join('');
  grid.querySelectorAll('.employee-btn').forEach(btn => {
    btn.addEventListener('click', () => selectUser(btn.dataset.id));
  });
}

function selectUser(id) {
  state.currentUser = state.employees.find(e => e.id === id);
  if (!state.currentUser) return;
  localStorage.setItem('lunch_user_id', id);
  document.getElementById('current-user').textContent = state.currentUser.name;
  document.getElementById('identity-modal').style.display = 'none';
  loadTodaySession();
}

document.getElementById('switch-user-btn').addEventListener('click', () => {
  document.getElementById('identity-modal').style.display = 'flex';
});
document.getElementById('current-user').addEventListener('click', () => {
  document.getElementById('identity-modal').style.display = 'flex';
});

// ---- Today's Session ----
async function loadTodaySession() {
  const today = new Date().toISOString().slice(0, 10);
  const sessions = await api('order_sessions', {
    params: { select: '*', date: `eq.${today}`, order: 'created_at.desc', limit: '1' }
  });

  if (!sessions || sessions.length === 0) {
    document.getElementById('no-session-msg').style.display = 'block';
    document.getElementById('session-info').style.display = 'none';
    document.getElementById('order-form').style.display = 'none';
    document.getElementById('already-ordered').style.display = 'none';
    state.currentSession = null;
    return;
  }

  state.currentSession = sessions[0];
  document.getElementById('no-session-msg').style.display = 'none';
  document.getElementById('session-info').style.display = 'block';

  // Load restaurant names
  const mealRest = state.restaurants.find(r => r.id === state.currentSession.meal_restaurant_id);
  const drinkRest = state.restaurants.find(r => r.id === state.currentSession.drink_restaurant_id);

  document.getElementById('session-meal-name').textContent = mealRest ? mealRest.name : '—';
  document.getElementById('session-drink-name').textContent = drinkRest ? drinkRest.name : '—';

  if (state.currentSession.deadline) {
    document.getElementById('session-deadline').textContent = state.currentSession.deadline.slice(0, 5);
    document.getElementById('session-deadline-wrap').style.display = '';
  } else {
    document.getElementById('session-deadline-wrap').style.display = 'none';
  }

  if (state.currentSession.notes) {
    document.getElementById('session-notes').textContent = state.currentSession.notes;
    document.getElementById('session-notes').style.display = '';
  } else {
    document.getElementById('session-notes').style.display = 'none';
  }

  const isClosed = state.currentSession.status !== 'open';
  document.getElementById('session-status-bar').style.display = isClosed ? '' : 'none';

  // Load menu items
  if (mealRest) {
    state.mealMenuItems = await api('menu_items', {
      params: {
        select: '*,menu_categories(name)',
        restaurant_id: `eq.${mealRest.id}`,
        is_available: 'eq.true',
        order: 'sort_order'
      }
    });
  }
  if (drinkRest) {
    state.drinkMenuItems = await api('menu_items', {
      params: {
        select: '*,menu_categories(name)',
        restaurant_id: `eq.${drinkRest.id}`,
        is_available: 'eq.true',
        order: 'sort_order'
      }
    });
    state.drinkToppings = await api('toppings', {
      params: { restaurant_id: `eq.${drinkRest.id}`, order: 'sort_order' }
    });
    document.getElementById('drink-section').style.display = '';
  } else {
    state.drinkMenuItems = [];
    state.drinkToppings = [];
    document.getElementById('drink-section').style.display = 'none';
  }

  // Check existing order
  await checkExistingOrder();
}

async function checkExistingOrder() {
  if (!state.currentSession || !state.currentUser) return;

  const orders = await api('orders', {
    params: {
      select: '*,order_items(*)',
      session_id: `eq.${state.currentSession.id}`,
      employee_id: `eq.${state.currentUser.id}`,
    }
  });

  if (orders && orders.length > 0) {
    state.existingOrder = orders[0];
    showExistingOrder();
  } else {
    state.existingOrder = null;
    showOrderForm();
  }
}

function showExistingOrder() {
  document.getElementById('already-ordered').style.display = '';
  document.getElementById('order-form').style.display = 'none';

  const items = state.existingOrder.order_items || [];
  const preview = document.getElementById('my-order-preview');
  preview.innerHTML = items.map(item => {
    let desc = item.item_name;
    if (item.size_name) desc += ` (${item.size_name})`;
    if (item.sweetness) desc += ` ${item.sweetness}`;
    if (item.ice) desc += ` ${item.ice}`;
    const toppings = item.toppings || [];
    if (toppings.length) desc += ` +${toppings.map(t => t.name).join('+')}`;
    if (item.notes) desc += ` 【${item.notes}】`;
    return `<div class="preview-item">・${desc}　$${item.total_price}</div>`;
  }).join('');
  preview.innerHTML += `<div style="text-align:right;font-weight:700;margin-top:4px">合計 $${state.existingOrder.total_amount}</div>`;

  const isClosed = state.currentSession.status !== 'open';
  document.getElementById('edit-order-btn').style.display = isClosed ? 'none' : '';
}

function showOrderForm() {
  document.getElementById('already-ordered').style.display = 'none';
  const isClosed = state.currentSession && state.currentSession.status !== 'open';
  document.getElementById('order-form').style.display = isClosed ? 'none' : '';
  state.selectedMeals = [];
  state.selectedDrinks = [];
  state.selectedExtras = [];
  renderSelectedItems();
}

document.getElementById('edit-order-btn').addEventListener('click', async () => {
  if (state.existingOrder) {
    // Delete existing order to re-order
    await api(`order_items?order_id=eq.${state.existingOrder.id}`, { method: 'DELETE' });
    await api(`orders?id=eq.${state.existingOrder.id}`, { method: 'DELETE' });
    state.existingOrder = null;
  }
  showOrderForm();
});

// ---- Menu Search ----
function setupSearch(inputId, resultsId, getItems, onSelect) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.classList.remove('show'); return; }

    const items = getItems();
    const matches = items.filter(item =>
      item.name.toLowerCase().includes(q)
    ).slice(0, 15);

    if (matches.length === 0) {
      results.innerHTML = '<div class="search-result-item"><span class="item-name" style="color:var(--text-secondary)">找不到「' + escapeHtml(input.value) + '」</span></div>';
      results.classList.add('show');
      return;
    }

    results.innerHTML = matches.map(item => {
      const cat = item.menu_categories ? item.menu_categories.name : '';
      const sizes = parseSizes(item.sizes);
      let priceStr;
      if (sizes.length > 0) {
        priceStr = sizes.map(s => `${s.name}$${s.price}`).join('/');
      } else {
        priceStr = item.price != null ? `$${item.price}` : '';
      }
      const noteStr = item.notes ? `<span class="item-note">${item.notes}</span>` : '';
      return `<div class="search-result-item" data-id="${item.id}">
        <span class="item-cat">${cat}</span>
        <span class="item-name">${highlightMatch(item.name, input.value)}</span>
        ${noteStr}
        <span class="item-price">${priceStr}</span>
      </div>`;
    }).join('');

    results.classList.add('show');

    results.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const item = items.find(i => i.id === el.dataset.id);
        if (item) onSelect(item);
        input.value = '';
        results.classList.remove('show');
      });
    });
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest(`#${inputId}`) && !e.target.closest(`#${resultsId}`)) {
      results.classList.remove('show');
    }
  });
}

function parseSizes(sizes) {
  if (!sizes) return [];
  if (typeof sizes === 'string') {
    try { return JSON.parse(sizes); } catch { return []; }
  }
  return Array.isArray(sizes) ? sizes : [];
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) +
    '<strong>' + escapeHtml(text.slice(idx, idx + query.length)) + '</strong>' +
    escapeHtml(text.slice(idx + query.length));
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Setup searches
setupSearch('meal-search', 'meal-results', () => state.mealMenuItems, onSelectMeal);
setupSearch('drink-search', 'drink-results', () => state.drinkMenuItems, onSelectDrink);
setupSearch('extra-search', 'extra-results', () => [...state.mealMenuItems, ...state.drinkMenuItems], onSelectExtra);

// ---- Meal Selection ----
function onSelectMeal(item) {
  const sizes = parseSizes(item.sizes);
  if (sizes.length > 0) {
    showSizeModal(item, sizes, (selectedSize, notes) => {
      state.selectedMeals.push({
        menuItem: item,
        sizeName: selectedSize.name,
        price: selectedSize.price,
        notes: notes,
        type: 'meal',
      });
      renderSelectedItems();
    });
  } else {
    showSizeModal(item, [], (_, notes) => {
      state.selectedMeals.push({
        menuItem: item,
        sizeName: null,
        price: item.price,
        notes: notes,
        type: 'meal',
      });
      renderSelectedItems();
    });
  }
}

function showSizeModal(item, sizes, callback) {
  const modal = document.getElementById('size-modal');
  document.getElementById('size-modal-name').textContent = item.name;
  document.getElementById('size-modal-notes').value = '';

  const optionsEl = document.getElementById('size-options');
  let selectedSize = sizes.length > 0 ? sizes[0] : null;

  if (sizes.length > 0) {
    optionsEl.innerHTML = sizes.map((s, i) =>
      `<button class="option-btn ${i === 0 ? 'selected' : ''}" data-idx="${i}">${s.name} $${s.price}</button>`
    ).join('');
    optionsEl.style.display = '';
    optionsEl.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        optionsEl.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSize = sizes[parseInt(btn.dataset.idx)];
      });
    });
  } else {
    optionsEl.innerHTML = `<div style="font-size:14px;color:var(--primary);font-weight:600">$${item.price}</div>`;
    optionsEl.style.display = '';
  }

  modal.style.display = 'flex';

  const confirmHandler = () => {
    const notes = document.getElementById('size-modal-notes').value.trim();
    modal.style.display = 'none';
    callback(selectedSize || { name: null, price: item.price }, notes);
    document.getElementById('size-confirm').removeEventListener('click', confirmHandler);
  };
  const cancelHandler = () => {
    modal.style.display = 'none';
    document.getElementById('size-cancel').removeEventListener('click', cancelHandler);
    document.getElementById('size-confirm').removeEventListener('click', confirmHandler);
  };

  document.getElementById('size-confirm').addEventListener('click', confirmHandler);
  document.getElementById('size-cancel').addEventListener('click', cancelHandler);
}

// ---- Drink Selection ----
function onSelectDrink(item) {
  showDrinkCustomizeModal(item, (result) => {
    state.selectedDrinks.push(result);
    renderSelectedItems();
  });
}

function showDrinkCustomizeModal(item, callback) {
  const modal = document.getElementById('drink-customize-modal');
  document.getElementById('customize-drink-name').textContent = item.name;
  document.getElementById('customize-notes').value = '';

  const sizes = parseSizes(item.sizes);
  let selectedSize = sizes.length > 0 ? sizes[0] : null;
  let selectedSweetness = item.has_sweetness ? '全糖' : null;
  let selectedIce = item.has_ice ? '正常冰' : null;
  let selectedToppings = [];

  // Sizes
  const sizeSection = document.getElementById('customize-size-section');
  if (sizes.length > 0) {
    sizeSection.style.display = '';
    document.getElementById('customize-sizes').innerHTML = sizes.map((s, i) =>
      `<button class="option-btn ${i === 0 ? 'selected' : ''}" data-idx="${i}">${s.name} $${s.price}</button>`
    ).join('');
    document.getElementById('customize-sizes').querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('customize-sizes').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSize = sizes[parseInt(btn.dataset.idx)];
        updateCustomizeTotal();
      });
    });
  } else {
    sizeSection.style.display = 'none';
  }

  // Sweetness
  const sweetSection = document.getElementById('customize-sweetness-section');
  if (item.has_sweetness) {
    sweetSection.style.display = '';
    document.getElementById('customize-sweetness').innerHTML = SWEETNESS_OPTIONS.map((s, i) =>
      `<button class="option-btn ${i === 0 ? 'selected' : ''}">${s}</button>`
    ).join('');
    document.getElementById('customize-sweetness').querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('customize-sweetness').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSweetness = btn.textContent;
      });
    });
  } else {
    sweetSection.style.display = 'none';
  }

  // Ice
  const iceSection = document.getElementById('customize-ice-section');
  if (item.has_ice) {
    iceSection.style.display = '';
    document.getElementById('customize-ice').innerHTML = ICE_OPTIONS.map((s, i) =>
      `<button class="option-btn ${i === 0 ? 'selected' : ''}">${s}</button>`
    ).join('');
    document.getElementById('customize-ice').querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('customize-ice').querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedIce = btn.textContent;
      });
    });
  } else {
    iceSection.style.display = 'none';
  }

  // Toppings
  const toppingSection = document.getElementById('customize-toppings-section');
  if (state.drinkToppings.length > 0) {
    toppingSection.style.display = '';
    document.getElementById('customize-toppings').innerHTML = state.drinkToppings.map(t =>
      `<button class="option-btn" data-name="${t.name}" data-price="${t.price}">${t.name} +$${t.price}</button>`
    ).join('');
    document.getElementById('customize-toppings').querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('topping-selected');
        const name = btn.dataset.name;
        const price = parseInt(btn.dataset.price);
        const idx = selectedToppings.findIndex(t => t.name === name);
        if (idx >= 0) selectedToppings.splice(idx, 1);
        else selectedToppings.push({ name, price });
        updateCustomizeTotal();
      });
    });
  } else {
    toppingSection.style.display = 'none';
  }

  function updateCustomizeTotal() {
    const base = selectedSize ? selectedSize.price : (item.price || 0);
    const toppingTotal = selectedToppings.reduce((sum, t) => sum + t.price, 0);
    document.getElementById('customize-total').textContent = `$${base + toppingTotal}`;
  }
  updateCustomizeTotal();

  modal.style.display = 'flex';

  const confirmHandler = () => {
    const base = selectedSize ? selectedSize.price : (item.price || 0);
    const toppingTotal = selectedToppings.reduce((sum, t) => sum + t.price, 0);
    const notes = document.getElementById('customize-notes').value.trim();
    modal.style.display = 'none';
    callback({
      menuItem: item,
      sizeName: selectedSize ? selectedSize.name : null,
      price: base + toppingTotal,
      basePrice: base,
      sweetness: selectedSweetness,
      ice: selectedIce,
      toppings: [...selectedToppings],
      toppingsPrice: toppingTotal,
      notes: notes,
      type: 'drink',
    });
    cleanup();
  };
  const cancelHandler = () => {
    modal.style.display = 'none';
    cleanup();
  };
  function cleanup() {
    document.getElementById('customize-confirm').removeEventListener('click', confirmHandler);
    document.getElementById('customize-cancel').removeEventListener('click', cancelHandler);
  }
  document.getElementById('customize-confirm').addEventListener('click', confirmHandler);
  document.getElementById('customize-cancel').addEventListener('click', cancelHandler);
}

// ---- Extra Selection ----
function onSelectExtra(item) {
  if (state.selectedExtras.length >= 3) {
    toast('加點最多 3 項');
    return;
  }

  const isDrink = state.drinkMenuItems.some(d => d.id === item.id);
  if (isDrink && (item.has_sweetness || item.has_ice)) {
    showDrinkCustomizeModal(item, (result) => {
      result.type = 'extra';
      state.selectedExtras.push(result);
      renderSelectedItems();
    });
  } else {
    const sizes = parseSizes(item.sizes);
    if (sizes.length > 0) {
      showSizeModal(item, sizes, (selectedSize, notes) => {
        state.selectedExtras.push({
          menuItem: item,
          sizeName: selectedSize.name,
          price: selectedSize.price,
          notes: notes,
          type: 'extra',
        });
        renderSelectedItems();
      });
    } else {
      state.selectedExtras.push({
        menuItem: item,
        sizeName: null,
        price: item.price,
        notes: '',
        type: 'extra',
      });
      renderSelectedItems();
    }
  }
}

// ---- Render Selected Items ----
function renderSelectedItems() {
  renderGroup('selected-meals', state.selectedMeals);
  renderGroup('selected-drinks', state.selectedDrinks);
  renderGroup('selected-extras', state.selectedExtras);
  updateOrderSummary();
}

function renderGroup(containerId, items) {
  const el = document.getElementById(containerId);
  el.innerHTML = items.map((item, idx) => {
    let desc = item.menuItem.name;
    if (item.sizeName) desc += ` (${item.sizeName})`;
    let detail = '';
    if (item.sweetness) detail += item.sweetness + ' ';
    if (item.ice) detail += item.ice + ' ';
    if (item.toppings && item.toppings.length) detail += '+' + item.toppings.map(t => t.name).join('+') + ' ';
    if (item.notes) detail += `【${item.notes}】`;
    return `<div class="selected-item">
      <span class="si-name">${desc}</span>
      ${detail ? `<span class="si-detail">${detail}</span>` : ''}
      <span class="si-price">$${item.price}</span>
      <button class="si-remove" data-idx="${idx}" data-group="${containerId}">✕</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.si-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const group = btn.dataset.group;
      if (group === 'selected-meals') state.selectedMeals.splice(idx, 1);
      else if (group === 'selected-drinks') state.selectedDrinks.splice(idx, 1);
      else state.selectedExtras.splice(idx, 1);
      renderSelectedItems();
    });
  });
}

function updateOrderSummary() {
  const all = [...state.selectedMeals, ...state.selectedDrinks, ...state.selectedExtras];
  const total = all.reduce((sum, item) => sum + item.price, 0);
  document.getElementById('order-total-amount').textContent = `$${total}`;

  const list = document.getElementById('order-summary-list');
  if (all.length === 0) {
    list.innerHTML = '<p style="color:var(--text-secondary);font-size:13px">還沒選任何品項</p>';
  } else {
    list.innerHTML = all.map(item => {
      let name = item.menuItem.name;
      if (item.sizeName) name += ` (${item.sizeName})`;
      return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:14px">
        <span>${name}</span><span>$${item.price}</span>
      </div>`;
    }).join('');
  }

  document.getElementById('submit-order-btn').disabled = all.length === 0;
}

// ---- Submit Order ----
document.getElementById('submit-order-btn').addEventListener('click', submitOrder);

async function submitOrder() {
  if (!state.currentUser || !state.currentSession) return;

  const all = [...state.selectedMeals, ...state.selectedDrinks, ...state.selectedExtras];
  if (all.length === 0) return;

  const total = all.reduce((sum, item) => sum + item.price, 0);

  try {
    // Create order
    const [order] = await api('orders', {
      method: 'POST',
      body: {
        session_id: state.currentSession.id,
        employee_id: state.currentUser.id,
        total_amount: total,
      },
    });

    // Create order items
    const items = all.map(item => ({
      order_id: order.id,
      menu_item_id: item.menuItem.id,
      item_name: item.menuItem.name,
      size_name: item.sizeName || null,
      base_price: item.basePrice || item.price,
      quantity: 1,
      sweetness: item.sweetness || null,
      ice: item.ice || null,
      toppings: item.toppings || [],
      toppings_price: item.toppingsPrice || 0,
      notes: item.notes || null,
      item_type: item.type,
      total_price: item.price,
    }));

    await api('order_items', { method: 'POST', body: items });

    // Deduct from balance
    if (state.currentUser.balance > 0) {
      const newBalance = Math.max(0, state.currentUser.balance - total);
      await api(`employees?id=eq.${state.currentUser.id}`, {
        method: 'PATCH',
        body: { balance: newBalance },
      });
      state.currentUser.balance = newBalance;
    }

    toast('訂單送出成功！');
    await checkExistingOrder();
  } catch (err) {
    toast('送出失敗：' + err.message);
    console.error(err);
  }
}

// ---- Summary View ----
async function loadSummary() {
  if (!state.currentSession) {
    document.getElementById('summary-content').innerHTML = '<p class="empty-state">今天還沒有開團</p>';
    document.getElementById('summary-stats').innerHTML = '';
    document.getElementById('summary-detail').innerHTML = '';
    return;
  }

  const mealRest = state.restaurants.find(r => r.id === state.currentSession.meal_restaurant_id);
  const today = state.currentSession.date;
  document.getElementById('summary-date').textContent = `${today}　${mealRest ? mealRest.name : ''}`;

  // Load all orders for this session
  const orders = await api('orders', {
    params: {
      select: '*,employees(name),order_items(*)',
      session_id: `eq.${state.currentSession.id}`,
    }
  });

  if (!orders || orders.length === 0) {
    document.getElementById('summary-content').innerHTML = '<p class="empty-state">還沒有人點餐</p>';
    document.getElementById('summary-stats').innerHTML = '';
    document.getElementById('summary-detail').innerHTML = '';
    return;
  }

  // Aggregate items
  const agg = {};
  let grandTotal = 0;
  orders.forEach(order => {
    grandTotal += order.total_amount;
    (order.order_items || []).forEach(item => {
      const key = `${item.item_name}|${item.size_name || ''}|${item.item_type}`;
      if (!agg[key]) {
        agg[key] = {
          name: item.item_name,
          size: item.size_name,
          type: item.item_type,
          count: 0,
          price: item.base_price,
          notesList: [],
        };
      }
      agg[key].count += item.quantity;
      if (item.notes) agg[key].notesList.push(item.notes);
    });
  });

  // Group by type
  const groups = { meal: '正餐', drink: '飲料', extra: '加點' };
  const byType = {};
  Object.values(agg).forEach(item => {
    const type = item.type || 'meal';
    if (!byType[type]) byType[type] = [];
    byType[type].push(item);
  });

  let html = '';
  for (const [type, label] of Object.entries(groups)) {
    const items = byType[type];
    if (!items || items.length === 0) continue;
    html += `<div class="summary-group"><div class="summary-group-title">【${label}】</div>`;
    items.forEach(item => {
      let line = `・${item.name}`;
      if (item.size) line += `（${item.size}）`;
      line += ` ×${item.count}`;
      const uniqueNotes = [...new Set(item.notesList)].filter(Boolean);
      let notesStr = '';
      if (uniqueNotes.length > 0) {
        const notesCounted = {};
        item.notesList.forEach(n => { if (n) notesCounted[n] = (notesCounted[n] || 0) + 1; });
        notesStr = Object.entries(notesCounted).map(([note, cnt]) =>
          cnt > 1 ? `${cnt}份${note}` : note
        ).join('、');
      }
      html += `<div class="summary-item">${line}${notesStr ? `<span class="notes">（${notesStr}）</span>` : ''}</div>`;
    });
    html += '</div>';
  }

  document.getElementById('summary-content').innerHTML = html;
  document.getElementById('summary-stats').innerHTML = `
    <span>共 ${orders.length} 人</span>
    <span>總金額 $${grandTotal}</span>
  `;

  // Detail by person
  let detailHtml = '';
  orders.forEach(order => {
    const name = order.employees ? order.employees.name : '未知';
    const items = (order.order_items || []).map(item => {
      let desc = item.item_name;
      if (item.size_name) desc += `(${item.size_name})`;
      if (item.sweetness) desc += ` ${item.sweetness}`;
      if (item.ice) desc += ` ${item.ice}`;
      const tops = item.toppings || [];
      if (tops.length) desc += ` +${tops.map(t => t.name).join('+')}`;
      if (item.notes) desc += ` 【${item.notes}】`;
      return desc;
    });
    detailHtml += `<div class="summary-detail-person">
      <div class="person-name">${name}</div>
      <div class="person-items">${items.map(i => `・${i}`).join('<br>')}</div>
      <div class="person-total">$${order.total_amount}</div>
    </div>`;
  });
  document.getElementById('summary-detail').innerHTML = detailHtml;
}

// Copy summary to clipboard
document.getElementById('copy-summary-btn').addEventListener('click', () => {
  const content = document.getElementById('summary-content');
  const stats = document.getElementById('summary-stats');
  const date = document.getElementById('summary-date');
  const text = `📋 ${date.textContent}\n\n${content.innerText}\n\n${stats.innerText}`;
  navigator.clipboard.writeText(text).then(() => toast('已複製到剪貼簿'));
});

// ---- History View ----
async function loadHistory() {
  if (!state.currentUser) return;

  document.getElementById('history-month').textContent = `${state.historyYear}/${String(state.historyMonth).padStart(2, '0')}`;

  // Get month range
  const startDate = `${state.historyYear}-${String(state.historyMonth).padStart(2, '0')}-01`;
  const endMonth = state.historyMonth === 12 ? 1 : state.historyMonth + 1;
  const endYear = state.historyMonth === 12 ? state.historyYear + 1 : state.historyYear;
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  const orders = await api('orders', {
    params: {
      select: '*,order_sessions(date,meal_restaurant_id),order_items(*)',
      employee_id: `eq.${state.currentUser.id}`,
      'order_sessions.date': `gte.${startDate}`,
      order: 'created_at.desc',
    }
  });

  // Filter by date range (PostgREST filtering on joined tables is limited)
  const filtered = (orders || []).filter(o => {
    if (!o.order_sessions) return false;
    return o.order_sessions.date >= startDate && o.order_sessions.date < endDate;
  });

  const totalAmount = filtered.reduce((sum, o) => sum + o.total_amount, 0);
  const totalDays = filtered.length;

  document.getElementById('history-summary').innerHTML = `
    <div class="history-stat">
      <div class="stat-value">${totalDays}</div>
      <div class="stat-label">天</div>
    </div>
    <div class="history-stat">
      <div class="stat-value">$${totalAmount}</div>
      <div class="stat-label">本月消費</div>
    </div>
    <div class="history-stat">
      <div class="stat-value">$${totalDays > 0 ? Math.round(totalAmount / totalDays) : 0}</div>
      <div class="stat-label">日均消費</div>
    </div>
  `;

  if (filtered.length === 0) {
    document.getElementById('history-list').innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px">這個月沒有紀錄</p>';
  } else {
    document.getElementById('history-list').innerHTML = filtered.map(order => {
      const date = order.order_sessions.date;
      const restId = order.order_sessions.meal_restaurant_id;
      const rest = state.restaurants.find(r => r.id === restId);
      const items = (order.order_items || []).map(i => {
        let name = i.item_name;
        if (i.size_name) name += `(${i.size_name})`;
        return name;
      }).join('、');
      return `<div class="history-day">
        <div>
          <div class="history-day-date">${date.slice(5)}</div>
          <div class="history-day-restaurant">${rest ? rest.name : ''}</div>
        </div>
        <div class="history-day-items">${items}</div>
        <div class="history-day-amount">$${order.total_amount}</div>
      </div>`;
    }).join('');
  }

  // Balance
  const emp = await api('employees', {
    params: { select: 'balance', id: `eq.${state.currentUser.id}` }
  });
  const balance = emp && emp[0] ? emp[0].balance : 0;
  document.getElementById('balance-info').innerHTML = `
    <span>目前餘額</span>
    <span class="balance-amount">$${balance}</span>
  `;
}

document.getElementById('prev-month').addEventListener('click', () => {
  state.historyMonth--;
  if (state.historyMonth < 1) { state.historyMonth = 12; state.historyYear--; }
  loadHistory();
});
document.getElementById('next-month').addEventListener('click', () => {
  state.historyMonth++;
  if (state.historyMonth > 12) { state.historyMonth = 1; state.historyYear++; }
  loadHistory();
});

// ---- Admin View ----
async function loadAdmin() {
  await loadRestaurants();
  renderAdminRestaurants();
  renderAdminEmployees();
  await loadAdminSession();
}

async function loadRestaurants() {
  state.restaurants = await api('restaurants', {
    params: { select: '*', order: 'sort_order,name' }
  });
}

function renderAdminRestaurants() {
  const el = document.getElementById('restaurant-list');
  el.innerHTML = state.restaurants.map(r => {
    const typeLabel = r.type === 'meal' ? '🍱' : '🧋';
    return `<div class="admin-list-item">
      <span>${typeLabel} ${r.name}</span>
      <div class="item-actions">
        <button class="btn btn-small" data-action="edit-menu" data-id="${r.id}">菜單</button>
        <button class="btn btn-small btn-danger" data-action="delete-rest" data-id="${r.id}" style="font-size:12px">刪除</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-action="edit-menu"]').forEach(btn => {
    btn.addEventListener('click', () => openMenuManagement(btn.dataset.id));
  });
  el.querySelectorAll('[data-action="delete-rest"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定刪除這間餐廳？相關菜單也會一起刪除。')) return;
      await api(`restaurants?id=eq.${btn.dataset.id}`, { method: 'DELETE' });
      toast('已刪除');
      loadAdmin();
    });
  });

  // Populate session dropdowns
  const mealSelect = document.getElementById('admin-meal-restaurant');
  const drinkSelect = document.getElementById('admin-drink-restaurant');
  const meals = state.restaurants.filter(r => r.type === 'meal' && r.is_active);
  const drinks = state.restaurants.filter(r => r.type === 'drink' && r.is_active);

  mealSelect.innerHTML = '<option value="">— 選擇餐廳 —</option>' +
    meals.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  drinkSelect.innerHTML = '<option value="">— 不訂飲料 —</option>' +
    drinks.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
}

function renderAdminEmployees() {
  const el = document.getElementById('admin-employee-list');
  el.innerHTML = state.employees.map(e => `
    <div class="admin-list-item">
      <span>${e.name} ${e.is_admin ? '👑' : ''}</span>
      <div class="item-actions">
        <span style="font-size:13px;color:var(--text-secondary)">餘額 $${e.balance}</span>
        <button class="btn btn-small" data-action="edit-balance" data-id="${e.id}">調整</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-action="edit-balance"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emp = state.employees.find(e => e.id === btn.dataset.id);
      const newBalance = prompt(`${emp.name} 目前餘額 $${emp.balance}\n輸入新餘額：`, emp.balance);
      if (newBalance === null) return;
      const val = parseInt(newBalance);
      if (isNaN(val)) return toast('請輸入數字');
      await api(`employees?id=eq.${emp.id}`, { method: 'PATCH', body: { balance: val } });
      emp.balance = val;
      renderAdminEmployees();
      toast('餘額已更新');
    });
  });
}

// Add employee
document.getElementById('add-employee-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-employee-name').value.trim();
  if (!name) return toast('請輸入姓名');
  const balance = parseInt(document.getElementById('new-employee-balance').value) || 0;
  try {
    await api('employees', { method: 'POST', body: { name, balance } });
    document.getElementById('new-employee-name').value = '';
    document.getElementById('new-employee-balance').value = '';
    await loadEmployees();
    renderAdminEmployees();
    toast('員工已新增');
  } catch (err) {
    toast('新增失敗（名字可能重複）');
  }
});

// Add restaurant
document.getElementById('add-restaurant-btn').addEventListener('click', () => {
  document.getElementById('restaurant-modal').style.display = 'flex';
  document.getElementById('rest-name').value = '';
  document.getElementById('rest-phone').value = '';
  document.getElementById('rest-address').value = '';
});
document.getElementById('rest-cancel').addEventListener('click', () => {
  document.getElementById('restaurant-modal').style.display = 'none';
});
document.getElementById('rest-save').addEventListener('click', async () => {
  const name = document.getElementById('rest-name').value.trim();
  if (!name) return toast('請輸入名稱');
  await api('restaurants', {
    method: 'POST',
    body: {
      name,
      type: document.getElementById('rest-type').value,
      phone: document.getElementById('rest-phone').value.trim() || null,
      address: document.getElementById('rest-address').value.trim() || null,
    }
  });
  document.getElementById('restaurant-modal').style.display = 'none';
  toast('餐廳已新增');
  loadAdmin();
});

// ---- Menu Management ----
let mgmtRestaurantId = null;

async function openMenuManagement(restaurantId) {
  mgmtRestaurantId = restaurantId;
  const rest = state.restaurants.find(r => r.id === restaurantId);
  document.getElementById('mgmt-restaurant-name').textContent = rest.name;
  document.getElementById('menu-management').style.display = '';

  // Load categories
  const cats = await api('menu_categories', {
    params: { restaurant_id: `eq.${restaurantId}`, order: 'sort_order' }
  });
  const catSelect = document.getElementById('mgmt-category');
  catSelect.innerHTML = '<option value="">全部分類</option>' +
    cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  // Setup defaults for drink shops
  const isDrink = rest.type === 'drink';
  document.getElementById('new-item-sweetness').checked = isDrink;
  document.getElementById('new-item-ice').checked = isDrink;

  await loadMenuItems();
}

async function loadMenuItems() {
  const catId = document.getElementById('mgmt-category').value;
  let params = {
    select: '*,menu_categories(name)',
    restaurant_id: `eq.${mgmtRestaurantId}`,
    order: 'sort_order',
  };
  if (catId) params.category_id = `eq.${catId}`;

  const items = await api('menu_items', { params });
  const el = document.getElementById('menu-item-list');
  el.innerHTML = items.map(item => {
    const sizes = parseSizes(item.sizes);
    let priceStr;
    if (sizes.length > 0) {
      priceStr = sizes.map(s => `${s.name}$${s.price}`).join(' / ');
    } else {
      priceStr = `$${item.price || 0}`;
    }
    const cat = item.menu_categories ? item.menu_categories.name : '';
    const flags = [];
    if (item.has_sweetness) flags.push('甜');
    if (item.has_ice) flags.push('冰');
    return `<div class="admin-list-item">
      <div>
        <div>${item.name} <span style="color:var(--primary)">${priceStr}</span></div>
        <div style="font-size:11px;color:var(--text-secondary)">${cat}${flags.length ? ' | ' + flags.join('/') + '可調' : ''}</div>
      </div>
      <button class="btn btn-small btn-danger" data-action="delete-item" data-id="${item.id}" style="font-size:12px">刪除</button>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-action="delete-item"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`menu_items?id=eq.${btn.dataset.id}`, { method: 'DELETE' });
      loadMenuItems();
      toast('已刪除');
    });
  });
}

document.getElementById('mgmt-category').addEventListener('change', loadMenuItems);

document.getElementById('close-menu-mgmt').addEventListener('click', () => {
  document.getElementById('menu-management').style.display = 'none';
  mgmtRestaurantId = null;
});

// Add category
document.getElementById('add-category-btn').addEventListener('click', async () => {
  const name = prompt('輸入分類名稱：');
  if (!name) return;
  await api('menu_categories', {
    method: 'POST',
    body: { restaurant_id: mgmtRestaurantId, name },
  });
  toast('分類已新增');
  openMenuManagement(mgmtRestaurantId);
});

// Sizes toggle
document.getElementById('new-item-has-sizes').addEventListener('change', (e) => {
  document.getElementById('sizes-input').style.display = e.target.checked ? '' : 'none';
  if (e.target.checked && document.getElementById('sizes-list').children.length === 0) {
    addSizeRow();
  }
});

document.getElementById('add-size-btn').addEventListener('click', addSizeRow);

function addSizeRow() {
  const row = document.createElement('div');
  row.className = 'form-row';
  row.innerHTML = `
    <input type="text" placeholder="尺寸名（如：大）" class="size-name" style="width:80px">
    <input type="number" placeholder="價格" class="size-price" style="width:80px">
    <button class="btn btn-small" onclick="this.parentElement.remove()">✕</button>
  `;
  document.getElementById('sizes-list').appendChild(row);
}

// Add menu item
document.getElementById('add-item-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-item-name').value.trim();
  if (!name) return toast('請輸入品名');

  const hasSizes = document.getElementById('new-item-has-sizes').checked;
  const price = hasSizes ? null : parseInt(document.getElementById('new-item-price').value);
  if (!hasSizes && isNaN(price)) return toast('請輸入價格');

  let sizes = [];
  if (hasSizes) {
    const rows = document.getElementById('sizes-list').querySelectorAll('.form-row');
    rows.forEach(row => {
      const sName = row.querySelector('.size-name').value.trim();
      const sPrice = parseInt(row.querySelector('.size-price').value);
      if (sName && !isNaN(sPrice)) sizes.push({ name: sName, price: sPrice });
    });
    if (sizes.length === 0) return toast('請至少填一個尺寸');
  }

  const catId = document.getElementById('mgmt-category').value || null;

  await api('menu_items', {
    method: 'POST',
    body: {
      restaurant_id: mgmtRestaurantId,
      category_id: catId,
      name,
      price: hasSizes ? null : price,
      sizes: hasSizes ? sizes : [],
      has_sweetness: document.getElementById('new-item-sweetness').checked,
      has_ice: document.getElementById('new-item-ice').checked,
    }
  });

  document.getElementById('new-item-name').value = '';
  document.getElementById('new-item-price').value = '';
  toast('品項已新增');
  loadMenuItems();
});

// ---- Session Management ----
async function loadAdminSession() {
  const today = new Date().toISOString().slice(0, 10);
  const sessions = await api('order_sessions', {
    params: { select: '*', date: `eq.${today}`, order: 'created_at.desc', limit: '1' }
  });

  if (sessions && sessions.length > 0) {
    state.currentSession = sessions[0];
    document.getElementById('open-session-btn').style.display = 'none';
    document.getElementById('close-session-btn').style.display = '';
    document.getElementById('close-session-btn').textContent =
      state.currentSession.status === 'open' ? '截止點餐' : '已截止';
    document.getElementById('close-session-btn').disabled = state.currentSession.status !== 'open';

    if (state.currentSession.meal_restaurant_id) {
      document.getElementById('admin-meal-restaurant').value = state.currentSession.meal_restaurant_id;
    }
    if (state.currentSession.drink_restaurant_id) {
      document.getElementById('admin-drink-restaurant').value = state.currentSession.drink_restaurant_id;
    }
  } else {
    document.getElementById('open-session-btn').style.display = '';
    document.getElementById('close-session-btn').style.display = 'none';
  }
}

document.getElementById('open-session-btn').addEventListener('click', async () => {
  const mealId = document.getElementById('admin-meal-restaurant').value;
  if (!mealId) return toast('請選擇正餐餐廳');

  const drinkId = document.getElementById('admin-drink-restaurant').value || null;
  const deadline = document.getElementById('admin-deadline').value || null;
  const notes = document.getElementById('admin-notes').value.trim() || null;

  try {
    await api('order_sessions', {
      method: 'POST',
      body: {
        meal_restaurant_id: mealId,
        drink_restaurant_id: drinkId,
        deadline,
        notes,
        created_by: state.currentUser ? state.currentUser.id : null,
      }
    });
    toast('已開團！大家可以開始點餐了');
    loadAdmin();
    loadTodaySession();
  } catch (err) {
    toast('開團失敗：' + err.message);
  }
});

document.getElementById('close-session-btn').addEventListener('click', async () => {
  if (!state.currentSession) return;
  await api(`order_sessions?id=eq.${state.currentSession.id}`, {
    method: 'PATCH',
    body: { status: 'closed' }
  });
  toast('已截止點餐');
  loadAdmin();
  loadTodaySession();
});

// ---- Init ----
async function init() {
  try {
    await loadRestaurants();
    await loadEmployees();

    const savedUserId = localStorage.getItem('lunch_user_id');
    if (savedUserId) {
      const user = state.employees.find(e => e.id === savedUserId);
      if (user) {
        selectUser(savedUserId);
        return;
      }
    }
    document.getElementById('identity-modal').style.display = 'flex';
  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('no-session-msg').innerHTML = `
      <p>無法連線到資料庫</p>
      <p class="hint">請確認 Supabase 設定是否正確</p>
      <p class="hint" style="font-size:12px;margin-top:8px">${escapeHtml(err.message)}</p>
    `;
  }
}

init();
