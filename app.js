// ============================================================
// 午餐點餐系統
// ============================================================

const SUPABASE_URL = 'https://psyronkxtovwybqwtotv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KbfVHbfTr5VgH2t7kuVMCQ_2C8639ev';

const SWEETNESS_OPTIONS = ['全糖', '七分糖', '五分糖', '三分糖', '一分糖', '無糖'];
const ICE_OPTIONS = ['正常冰', '少冰', '微冰', '去冰', '溫飲', '熱飲'];

function toDirectImageUrl(url) {
  if (!url) return url;
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (match) return `https://lh3.googleusercontent.com/d/${match[1]}`;
  const match2 = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (match2) return `https://lh3.googleusercontent.com/d/${match2[1]}`;
  return url;
}

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
    const view = btn.dataset.view;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    if (view === 'summary') loadSummary();
    if (view === 'history') loadHistory();
    if (view === 'wallet') loadWallet();
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
  document.getElementById('current-user').textContent = state.currentUser.name + (state.currentUser.is_admin ? ' 👑' : '');
  document.getElementById('identity-modal').style.display = 'none';
  applyAdminVisibility();
  loadTodaySession();
}

function applyAdminVisibility() {
  const isAdmin = state.currentUser && state.currentUser.is_admin;
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
  const topupCard = document.getElementById('topup-card');
  if (topupCard) topupCard.style.display = isAdmin ? '' : 'none';
}

document.getElementById('switch-user-btn').addEventListener('click', () => {
  document.getElementById('identity-modal').style.display = 'flex';
});
document.getElementById('current-user').addEventListener('click', () => {
  document.getElementById('identity-modal').style.display = 'flex';
});

// ---- Sessions ----
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatSessionDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const prefix = dateStr === today ? '今天' : dateStr === tomorrow ? '明天' : '';
  return `${prefix ? prefix + ' ' : ''}${dateStr.slice(5)}（${WEEKDAYS[d.getDay()]}）`;
}

async function loadAvailableSessions() {
  const today = new Date().toISOString().slice(0, 10);
  const sessions = await api('order_sessions', {
    params: {
      select: '*,employees!order_sessions_created_by_fkey(name)',
      date: `gte.${today}`,
      order: 'date,created_at',
    }
  });

  // Also load today's closed sessions
  const pastToday = await api('order_sessions', {
    params: {
      select: '*,employees!order_sessions_created_by_fkey(name)',
      date: `eq.${today}`,
      status: 'neq.open',
      order: 'created_at',
    }
  });

  // Merge without duplicates
  const allIds = new Set();
  const allSessions = [];
  [...(sessions || []), ...(pastToday || [])].forEach(s => {
    if (!allIds.has(s.id)) { allIds.add(s.id); allSessions.push(s); }
  });
  allSessions.sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));

  // Auto-close sessions past deadline
  const now = new Date();
  const nowTime = now.getHours() * 60 + now.getMinutes();
  for (const s of allSessions) {
    if (s.status === 'open' && s.deadline && s.date === today) {
      const [h, m] = s.deadline.split(':').map(Number);
      if (nowTime >= h * 60 + m) {
        await api(`order_sessions?id=eq.${s.id}`, {
          method: 'PATCH', body: { status: 'closed', was_closed: true }
        });
        s.status = 'closed';
        s.was_closed = true;
      }
    }
  }

  state.allSessions = allSessions;

  if (allSessions.length === 0) {
    document.getElementById('no-session-msg').style.display = 'block';
    document.getElementById('session-list-wrap').style.display = 'none';
    document.getElementById('session-info').style.display = 'none';
    document.getElementById('order-form').style.display = 'none';
    document.getElementById('already-ordered').style.display = 'none';
    state.currentSession = null;
    return;
  }

  document.getElementById('no-session-msg').style.display = 'none';

  // If exactly one open session, go directly to it
  const openSessions = allSessions.filter(s => s.status === 'open');
  if (openSessions.length === 1) {
    await selectSession(openSessions[0]);
    return;
  }

  // Show session cards
  showSessionList(allSessions);
}

function showSessionList(sessions) {
  document.getElementById('session-list-wrap').style.display = '';
  document.getElementById('session-info').style.display = 'none';
  document.getElementById('order-form').style.display = 'none';
  document.getElementById('already-ordered').style.display = 'none';

  const el = document.getElementById('session-cards');
  el.innerHTML = sessions.map(s => {
    const mealRest = state.restaurants.find(r => r.id === s.meal_restaurant_id);
    const drinkRest = state.restaurants.find(r => r.id === s.drink_restaurant_id);
    const creator = s.employees ? s.employees.name : '';
    const isOpen = s.status === 'open';
    const title = [mealRest ? mealRest.name : null, drinkRest ? '🧋' + drinkRest.name : null].filter(Boolean).join(' + ') || '—';
    return `<div class="session-card ${isOpen ? '' : 'closed'}" data-id="${s.id}">
      <div class="session-card-header">
        <span class="session-card-title">${title}</span>
        <span class="session-card-badge ${isOpen ? 'open' : 'closed'}">${isOpen ? '點餐中' : '已截止'}</span>
      </div>
      <div class="session-card-meta">
        ${formatSessionDate(s.date)}${s.deadline ? '　截止 ' + s.deadline.slice(0, 5) : ''}
      </div>
      <div class="session-card-meta">開團人：${creator || '—'}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('.session-card').forEach(card => {
    card.addEventListener('click', async () => {
      const session = sessions.find(s => s.id === card.dataset.id);
      if (session) await selectSession(session);
    });
  });
}

async function selectSession(session) {
  state.currentSession = session;
  document.getElementById('session-list-wrap').style.display = 'none';
  document.getElementById('session-info').style.display = 'block';

  const mealRest = state.restaurants.find(r => r.id === session.meal_restaurant_id);
  const drinkRest = state.restaurants.find(r => r.id === session.drink_restaurant_id);
  const creator = session.employees ? session.employees.name : '';

  const mealWrap = document.getElementById('session-meal-name').parentElement;
  const drinkWrap = document.getElementById('session-drink-name').parentElement;
  document.getElementById('session-meal-name').textContent = mealRest ? mealRest.name : '—';
  document.getElementById('session-drink-name').textContent = drinkRest ? drinkRest.name : '—';
  mealWrap.style.display = mealRest ? '' : 'none';
  drinkWrap.style.display = drinkRest ? '' : 'none';
  document.getElementById('session-meta').textContent =
    `${formatSessionDate(session.date)}　開團人：${creator || '—'}`;

  if (session.deadline) {
    document.getElementById('session-deadline').textContent = session.deadline.slice(0, 5);
    document.getElementById('session-deadline-wrap').style.display = '';
  } else {
    document.getElementById('session-deadline-wrap').style.display = 'none';
  }

  if (session.notes) {
    document.getElementById('session-notes').textContent = session.notes;
    document.getElementById('session-notes').style.display = '';
  } else {
    document.getElementById('session-notes').style.display = 'none';
  }

  const isClosed = session.status !== 'open';
  document.getElementById('session-status-bar').style.display = isClosed ? '' : 'none';

  // Show/hide back button if there are multiple sessions
  document.getElementById('back-to-sessions').style.display =
    (state.allSessions && state.allSessions.length > 1) ? '' : 'none';

  // Click restaurant name to view menu photo
  const mealNameEl = document.getElementById('session-meal-name');
  const drinkNameEl = document.getElementById('session-drink-name');
  if (mealRest && mealRest.menu_image_url) {
    mealNameEl.classList.add('has-photo');
    mealNameEl.onclick = () => showMenuPhoto(mealRest.name, mealRest.menu_image_url);
  } else {
    mealNameEl.classList.remove('has-photo');
    mealNameEl.onclick = null;
  }
  if (drinkRest && drinkRest.menu_image_url) {
    drinkNameEl.classList.add('has-photo');
    drinkNameEl.onclick = () => showMenuPhoto(drinkRest.name, drinkRest.menu_image_url);
  } else {
    drinkNameEl.classList.remove('has-photo');
    drinkNameEl.onclick = null;
  }

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
    document.getElementById('meal-section').style.display = '';
  } else {
    state.mealMenuItems = [];
    document.getElementById('meal-section').style.display = 'none';
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
    const drinkHint = document.getElementById('drink-no-menu-hint');
    if (drinkHint) drinkHint.style.display = state.drinkMenuItems.length === 0 ? '' : 'none';
  } else {
    state.drinkMenuItems = [];
    state.drinkToppings = [];
    document.getElementById('drink-section').style.display = 'none';
  }

  await checkExistingOrder();
}

document.getElementById('back-to-sessions').addEventListener('click', () => {
  if (state.allSessions) showSessionList(state.allSessions);
});

// Keep old name as alias
function loadTodaySession() { return loadAvailableSessions(); }

async function checkExistingOrder() {
  if (!state.currentSession || !state.currentUser) {
    showOrderForm();
    return;
  }

  try {
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
  } catch (err) {
    console.error('checkExistingOrder error:', err);
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
  let selectedSweetness = '全糖';
  let selectedIce = '正常冰';
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

  // Sweetness — always show for drinks
  const sweetSection = document.getElementById('customize-sweetness-section');
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

  // Ice — always show for drinks
  const iceSection = document.getElementById('customize-ice-section');
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
// ---- Render Selected Items ----
function renderSelectedItems() {
  renderGroup('selected-meals', state.selectedMeals);
  renderGroup('selected-drinks', state.selectedDrinks);
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
      renderSelectedItems();
    });
  });
}

function updateOrderSummary() {
  const all = [...state.selectedMeals, ...state.selectedDrinks];
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

  const all = [...state.selectedMeals, ...state.selectedDrinks];
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
        is_additional: !!state.currentSession.was_closed,
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
  const aggAdditional = {};
  let grandTotal = 0;
  orders.forEach(order => {
    grandTotal += order.total_amount;
    const target = order.is_additional ? aggAdditional : agg;
    (order.order_items || []).forEach(item => {
      const key = `${item.item_name}|${item.size_name || ''}|${item.item_type}`;
      if (!target[key]) {
        target[key] = {
          name: item.item_name,
          size: item.size_name,
          type: item.item_type,
          count: 0,
          price: item.base_price,
          notesList: [],
        };
      }
      target[key].count += item.quantity;
      if (item.notes) target[key].notesList.push(item.notes);
    });
  });

  // Group by type
  const groups = { meal: '正餐', drink: '飲料' };

  function renderAggGroup(aggData, prefix) {
    const byType = {};
    Object.values(aggData).forEach(item => {
      const type = item.type || 'meal';
      if (!byType[type]) byType[type] = [];
      byType[type].push(item);
    });

    let html = '';
    if (prefix) html += `<div class="summary-group-title" style="color:var(--danger);margin-top:8px">── 追加 ──</div>`;
    for (const [type, label] of Object.entries(groups)) {
      const items = byType[type];
      if (!items || items.length === 0) continue;
      html += `<div class="summary-group"><div class="summary-group-title"${prefix ? ' style="color:var(--danger)"' : ''}>【${prefix ? '追加 ' : ''}${label}】</div>`;
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
        html += `<div class="summary-item"${prefix ? ' style="color:var(--danger)"' : ''}>${line}${notesStr ? `<span class="notes">（${notesStr}）</span>` : ''}</div>`;
      });
      html += '</div>';
    }
    return html;
  }

  let html = renderAggGroup(agg, false);
  if (Object.keys(aggAdditional).length > 0) {
    html += renderAggGroup(aggAdditional, true);
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
    const addLabel = order.is_additional ? '<span style="color:var(--danger);font-weight:700;font-size:12px">追加 </span>' : '';
    detailHtml += `<div class="summary-detail-person">
      <div class="person-name">${addLabel}${name}</div>
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
      <div class="stat-label">次</div>
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
  try {
    await loadRestaurants();
    renderAdminRestaurants();
    renderAdminEmployees();
    await loadAdminSession();
  } catch (err) {
    console.error('loadAdmin error:', err);
    toast('管理頁載入失敗：' + err.message);
  }
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
    const hasPhoto = r.menu_image_url ? '📷' : '';
    return `<div class="admin-list-item">
      <span>${typeLabel} ${r.name} ${hasPhoto}</span>
      <div class="item-actions">
        <button class="btn btn-small" data-action="edit-rest" data-id="${r.id}">編輯</button>
        <button class="btn btn-small" data-action="edit-menu" data-id="${r.id}">菜單</button>
        <button class="btn btn-small btn-danger" data-action="delete-rest" data-id="${r.id}" style="font-size:12px">刪除</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-action="edit-rest"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = state.restaurants.find(x => String(x.id) === String(btn.dataset.id));
      if (!r) return;
      document.getElementById('rest-name').value = r.name;
      document.getElementById('rest-type').value = r.type;
      document.getElementById('rest-phone').value = r.phone || '';
      document.getElementById('rest-address').value = r.address || '';
      document.getElementById('rest-menu-image').value = r.menu_image_url || '';
      document.getElementById('restaurant-modal').dataset.editId = r.id;
      document.getElementById('restaurant-modal').style.display = 'flex';
    });
  });
  el.querySelectorAll('[data-action="edit-menu"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await openMenuManagement(btn.dataset.id);
      } catch (err) {
        console.error('openMenuManagement error:', err);
        toast('開啟菜單失敗：' + err.message);
      }
    });
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

  mealSelect.innerHTML = '<option value="">— 不訂正餐 —</option>' +
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
        <button class="btn btn-small" data-action="rename-employee" data-id="${e.id}">改名</button>
        <button class="btn btn-small btn-danger" data-action="delete-employee" data-id="${e.id}">刪除</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-action="rename-employee"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emp = state.employees.find(e => e.id === btn.dataset.id);
      const newName = prompt(`修改「${emp.name}」的名稱：`, emp.name);
      if (!newName || newName.trim() === '' || newName.trim() === emp.name) return;
      try {
        await api(`employees?id=eq.${emp.id}`, { method: 'PATCH', body: { name: newName.trim() } });
        emp.name = newName.trim();
        renderAdminEmployees();
        toast('名稱已更新');
      } catch (err) {
        toast('修改失敗（名字可能重複）');
      }
    });
  });

  el.querySelectorAll('[data-action="delete-employee"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emp = state.employees.find(e => e.id === btn.dataset.id);
      if (!confirm(`確定要刪除「${emp.name}」嗎？`)) return;
      try {
        await api(`employees?id=eq.${emp.id}`, { method: 'DELETE' });
        state.employees = state.employees.filter(e => e.id !== emp.id);
        renderAdminEmployees();
        toast('員工已刪除');
      } catch (err) {
        toast('刪除失敗（該員工可能有相關訂單）');
      }
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
  document.getElementById('rest-menu-image').value = '';
  document.getElementById('restaurant-modal').dataset.editId = '';
});
document.getElementById('rest-cancel').addEventListener('click', () => {
  document.getElementById('restaurant-modal').style.display = 'none';
});
document.getElementById('rest-save').addEventListener('click', async () => {
  const name = document.getElementById('rest-name').value.trim();
  if (!name) return toast('請輸入名稱');
  const editId = document.getElementById('restaurant-modal').dataset.editId;
  const data = {
    name,
    type: document.getElementById('rest-type').value,
    phone: document.getElementById('rest-phone').value.trim() || null,
    address: document.getElementById('rest-address').value.trim() || null,
    menu_image_url: document.getElementById('rest-menu-image').value.trim() || null,
  };
  if (editId) {
    await api(`restaurants?id=eq.${editId}`, { method: 'PATCH', body: data });
    toast('餐廳已更新');
  } else {
    await api('restaurants', { method: 'POST', body: data });
    toast('餐廳已新增');
  }
  document.getElementById('restaurant-modal').style.display = 'none';
  loadAdmin();
});

// ---- Menu Management ----
let mgmtRestaurantId = null;

async function openMenuManagement(restaurantId) {
  mgmtRestaurantId = restaurantId;
  const rest = state.restaurants.find(r => String(r.id) === String(restaurantId));
  if (!rest) {
    toast('找不到餐廳資料，請重新整理頁面');
    return;
  }
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
  if (items.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:12px">此分類暫無品項</p>';
    return;
  }
  el.innerHTML = items.map(item => {
    const sizes = parseSizes(item.sizes);
    let priceStr;
    if (sizes.length > 0) {
      priceStr = sizes.map(s => `${s.name}$${s.price}`).join(' / ');
    } else {
      priceStr = `$${item.price || 0}`;
    }
    const cat = item.menu_categories ? item.menu_categories.name : '';
    return `<div class="admin-list-item" style="flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div>${escapeHtml(item.name)} <span style="color:var(--primary)">${priceStr}</span></div>
        <div style="font-size:11px;color:var(--text-secondary)">${escapeHtml(cat)}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-small" data-action="edit-item" data-id="${item.id}">編輯</button>
        <button class="btn btn-small btn-danger" data-action="delete-item" data-id="${item.id}" style="font-size:12px">刪除</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-action="edit-item"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => String(i.id) === String(btn.dataset.id));
      if (!item) return;
      editMenuItem(item);
    });
  });
  el.querySelectorAll('[data-action="delete-item"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`確定刪除「${items.find(i => i.id === btn.dataset.id)?.name || ''}」？`)) return;
      await api(`menu_items?id=eq.${btn.dataset.id}`, { method: 'DELETE' });
      loadMenuItems();
      toast('已刪除');
    });
  });
}

function editMenuItem(item) {
  const sizes = parseSizes(item.sizes);
  const hasSizes = sizes.length > 0;
  const newName = prompt('品名：', item.name);
  if (newName === null) return;
  if (!newName.trim()) return toast('品名不可為空');

  if (hasSizes) {
    const sizesStr = sizes.map(s => `${s.name}:${s.price}`).join(', ');
    const newSizesStr = prompt('尺寸與價格（格式：大:60, 中:50, 小:40）：', sizesStr);
    if (newSizesStr === null) return;
    const newSizes = newSizesStr.split(',').map(s => {
      const [name, price] = s.trim().split(':');
      return name && price ? { name: name.trim(), price: parseInt(price) } : null;
    }).filter(s => s && !isNaN(s.price));
    if (newSizes.length === 0) return toast('至少要有一個尺寸');
    api(`menu_items?id=eq.${item.id}`, {
      method: 'PATCH',
      body: { name: newName.trim(), sizes: newSizes }
    }).then(() => { toast('已更新'); loadMenuItems(); });
  } else {
    const newPrice = prompt('價格：', item.price || 0);
    if (newPrice === null) return;
    if (isNaN(parseInt(newPrice))) return toast('請輸入數字');
    api(`menu_items?id=eq.${item.id}`, {
      method: 'PATCH',
      body: { name: newName.trim(), price: parseInt(newPrice) }
    }).then(() => { toast('已更新'); loadMenuItems(); });
  }
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
  // Populate date selector (today + 7 days)
  const dateSelect = document.getElementById('admin-session-date');
  dateSelect.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const val = d.toISOString().slice(0, 10);
    const label = formatSessionDate(val);
    dateSelect.innerHTML += `<option value="${val}">${label}</option>`;
  }

  // Load all upcoming sessions
  const today = new Date().toISOString().slice(0, 10);
  const sessions = await api('order_sessions', {
    params: {
      select: '*,employees!order_sessions_created_by_fkey(name)',
      date: `gte.${today}`,
      order: 'date,created_at',
    }
  });

  const el = document.getElementById('admin-sessions-list');
  if (!sessions || sessions.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:12px">目前沒有進行中的團</p>';
    return;
  }

  el.innerHTML = sessions.map(s => {
    const mealRest = state.restaurants.find(r => r.id === s.meal_restaurant_id);
    const drinkRest = state.restaurants.find(r => r.id === s.drink_restaurant_id);
    const creator = s.employees ? s.employees.name : '—';
    const isOpen = s.status === 'open';
    const isAdmin = state.currentUser && state.currentUser.is_admin;
    let actions = '';
    if (isOpen) {
      actions = `<button class="btn btn-small btn-danger" data-action="close-session" data-id="${s.id}">截止</button>`;
    } else if (s.is_settled) {
      actions = `<span style="font-size:12px;color:var(--success)">✅ 已結帳</span>`;
    } else {
      actions = `<button class="btn btn-small" data-action="reopen-session" data-id="${s.id}">重新開團</button>`;
      if (isAdmin) {
        actions += ` <button class="btn btn-small btn-primary" data-action="settle-session" data-id="${s.id}">💰 結帳</button>`;
      }
    }
    return `<div class="admin-session-item">
      <div class="admin-session-info">
        <div class="as-title">${[mealRest ? mealRest.name : null, drinkRest ? drinkRest.name : null].filter(Boolean).join(' + ') || '—'}</div>
        <div class="as-meta">${formatSessionDate(s.date)}${s.deadline ? '　截止 ' + s.deadline.slice(0, 5) : ''}　開團人：${creator}</div>
      </div>
      <div class="item-actions">
        <span class="session-card-badge ${isOpen ? 'open' : s.is_settled ? 'settled' : 'closed'}">${isOpen ? '進行中' : s.is_settled ? '已結帳' : '已截止'}</span>
        ${actions}
        ${isAdmin ? `<button class="btn btn-small btn-danger" data-action="delete-session" data-id="${s.id}" style="font-size:11px">刪除</button>` : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-action="close-session"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`order_sessions?id=eq.${btn.dataset.id}`, {
        method: 'PATCH',
        body: { status: 'closed', was_closed: true }
      });
      toast('已截止');
      loadAdminSession();
      loadAvailableSessions();
    });
  });

  el.querySelectorAll('[data-action="reopen-session"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`order_sessions?id=eq.${btn.dataset.id}`, {
        method: 'PATCH',
        body: { status: 'open', is_settled: false }
      });
      toast('已重新開團');
      loadAdminSession();
      loadAvailableSessions();
    });
  });

  el.querySelectorAll('[data-action="settle-session"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sessionId = btn.dataset.id;
      if (!confirm('確定要結帳嗎？將從每位員工的錢包扣除訂單金額。')) return;

      try {
        const orders = await api('orders', {
          params: { session_id: `eq.${sessionId}`, select: 'id,employee_id,total_amount' }
        });

        if (!orders || orders.length === 0) {
          toast('此團沒有訂單');
          return;
        }

        for (const order of orders) {
          const emp = state.employees.find(e => e.id === order.employee_id);
          if (!emp) continue;

          const newBalance = emp.balance - order.total_amount;
          await api(`employees?id=eq.${emp.id}`, {
            method: 'PATCH',
            body: { balance: newBalance },
          });

          await api('wallet_transactions', {
            method: 'POST',
            body: {
              employee_id: emp.id,
              amount: -order.total_amount,
              type: 'deduct',
              date: new Date().toISOString().slice(0, 10),
              notes: `訂單扣款`,
              created_by: state.currentUser.id,
            }
          });

          emp.balance = newBalance;
        }

        await api(`order_sessions?id=eq.${sessionId}`, {
          method: 'PATCH',
          body: { is_settled: true }
        });

        toast(`結帳完成！共 ${orders.length} 筆訂單`);
        loadAdminSession();
      } catch (err) {
        toast('結帳失敗：' + err.message);
      }
    });
  });

  el.querySelectorAll('[data-action="delete-session"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定要刪除這個團嗎？相關訂單也會一起刪除。')) return;
      const sessionId = btn.dataset.id;
      try {
        const orders = await api('orders', { params: { session_id: `eq.${sessionId}`, select: 'id' } });
        if (orders && orders.length > 0) {
          const orderIds = orders.map(o => o.id).join(',');
          await api(`order_items?order_id=in.(${orderIds})`, { method: 'DELETE' });
          await api(`orders?session_id=eq.${sessionId}`, { method: 'DELETE' });
        }
        await api(`order_sessions?id=eq.${sessionId}`, { method: 'DELETE' });
        toast('已刪除');
        loadAdminSession();
        loadAvailableSessions();
      } catch (err) {
        toast('刪除失敗：' + err.message);
      }
    });
  });
}

document.getElementById('open-session-btn').addEventListener('click', async () => {
  const mealId = document.getElementById('admin-meal-restaurant').value || null;
  const drinkId = document.getElementById('admin-drink-restaurant').value || null;
  if (!mealId && !drinkId) return toast('請至少選擇一間正餐或飲料店');

  const date = document.getElementById('admin-session-date').value;
  const deadline = document.getElementById('admin-deadline').value || null;
  const notes = document.getElementById('admin-notes').value.trim() || null;

  try {
    await api('order_sessions', {
      method: 'POST',
      body: {
        date: date,
        meal_restaurant_id: mealId,
        drink_restaurant_id: drinkId,
        deadline,
        notes,
        created_by: state.currentUser ? state.currentUser.id : null,
      }
    });
    const mealRest = state.restaurants.find(r => r.id === mealId);
    toast(`已開團！${mealRest ? mealRest.name : ''} (${formatSessionDate(date)})`);
    document.getElementById('admin-notes').value = '';
    loadAdminSession();
    loadAvailableSessions();
  } catch (err) {
    toast('開團失敗：' + err.message);
  }
});

// ---- Spinner / 轉轉樂 ----
function spinWheel(type) {
  const list = state.restaurants.filter(r => r.type === type && r.is_active);
  const label = type === 'meal' ? '正餐餐廳' : '飲料店';
  if (list.length < 2) return toast(`至少要有 2 間${label}才能轉`);

  const display = document.getElementById('spin-display');
  const textEl = document.getElementById('spin-text');
  display.style.display = '';
  textEl.classList.remove('winner');

  const target = Math.floor(Math.random() * list.length);
  const totalSteps = list.length * 4 + target;
  let step = 0;
  let speed = 60;

  function tick() {
    const idx = step % list.length;
    textEl.textContent = list[idx].name;
    step++;

    if (step >= totalSteps) {
      textEl.classList.add('winner');
      const selectId = type === 'meal' ? 'admin-meal-restaurant' : 'admin-drink-restaurant';
      document.getElementById(selectId).value = list[target].id;
      return;
    }

    if (step > totalSteps - list.length) speed += 40;
    else if (step > totalSteps - list.length * 2) speed += 15;

    setTimeout(tick, speed);
  }
  tick();
}

document.getElementById('spin-meal-btn').addEventListener('click', () => spinWheel('meal'));
document.getElementById('spin-drink-btn').addEventListener('click', () => spinWheel('drink'));

// ---- Menu Photo ----
function showMenuPhoto(name, url) {
  document.getElementById('menu-photo-title').textContent = name + ' 菜單';
  document.getElementById('menu-photo-img').src = toDirectImageUrl(url);
  document.getElementById('menu-photo-modal').style.display = 'flex';
}
document.getElementById('close-menu-photo').addEventListener('click', () => {
  document.getElementById('menu-photo-modal').style.display = 'none';
});
document.getElementById('menu-photo-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

// ---- Wallet ----
async function loadWallet() {
  // Populate employee dropdown
  const select = document.getElementById('topup-employee');
  select.innerHTML = state.employees.map(e =>
    `<option value="${e.id}">${e.name}（餘額 $${e.balance}）</option>`
  ).join('');

  // Set default date to today
  document.getElementById('topup-date').value = new Date().toISOString().slice(0, 10);

  // Render all employees with balances
  const el = document.getElementById('wallet-employee-list');
  const sorted = [...state.employees].sort((a, b) => a.balance - b.balance);
  el.innerHTML = sorted.map(e => {
    const cls = e.balance >= 0 ? 'positive' : 'negative';
    return `<div class="wallet-row" data-id="${e.id}">
      <span class="wallet-name">${e.name}</span>
      <span class="wallet-balance ${cls}">$${e.balance}</span>
    </div>`;
  }).join('');

  el.querySelectorAll('.wallet-row').forEach(row => {
    row.addEventListener('click', () => loadWalletHistory(row.dataset.id));
  });
}

async function loadWalletHistory(employeeId) {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp) return;

  document.getElementById('wallet-history-card').style.display = '';
  document.getElementById('wallet-history-name').textContent = emp.name;

  const txs = await api('wallet_transactions', {
    params: {
      select: '*,employees!wallet_transactions_created_by_fkey(name)',
      employee_id: `eq.${employeeId}`,
      order: 'created_at.desc',
      limit: '50',
    }
  });

  const el = document.getElementById('wallet-history-list');
  if (!txs || txs.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:12px">尚無交易紀錄</p>';
    return;
  }

  el.innerHTML = txs.map(tx => {
    const isPlus = tx.amount > 0;
    const label = tx.type === 'topup' ? '儲值' : tx.type === 'adjustment' ? '調整' : '扣款';
    const by = tx.employees ? tx.employees.name : '';
    return `<div class="wallet-tx">
      <div>
        <div>${tx.date}　${label}</div>
        <div class="wallet-tx-info">${tx.notes || ''}${by ? '　操作人：' + by : ''}</div>
      </div>
      <span class="wallet-tx-amount ${isPlus ? 'plus' : 'minus'}">${isPlus ? '+' : ''}$${tx.amount}</span>
    </div>`;
  }).join('');
}

document.getElementById('topup-btn').addEventListener('click', async () => {
  const employeeId = document.getElementById('topup-employee').value;
  const amount = parseInt(document.getElementById('topup-amount').value);
  const date = document.getElementById('topup-date').value;
  const notes = document.getElementById('topup-notes').value.trim();

  if (!employeeId) return toast('請選擇員工');
  if (!amount || amount === 0) return toast('請輸入金額');
  if (!date) return toast('請選擇日期');

  const emp = state.employees.find(e => e.id === employeeId);

  try {
    await api('wallet_transactions', {
      method: 'POST',
      body: {
        employee_id: employeeId,
        amount: amount,
        type: amount > 0 ? 'topup' : 'adjustment',
        date: date,
        notes: notes || null,
        created_by: state.currentUser ? state.currentUser.id : null,
      }
    });

    const newBalance = emp.balance + amount;
    await api(`employees?id=eq.${employeeId}`, {
      method: 'PATCH',
      body: { balance: newBalance },
    });
    emp.balance = newBalance;

    document.getElementById('topup-amount').value = '';
    document.getElementById('topup-notes').value = '';
    toast(`已為 ${emp.name} ${amount > 0 ? '儲值' : '調整'} $${amount}`);
    loadWallet();
  } catch (err) {
    toast('操作失敗：' + err.message);
  }
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
