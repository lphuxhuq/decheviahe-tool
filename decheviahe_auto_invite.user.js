// ==UserScript==
// @name         Đế Chế Vỉa Hè - Siêu Tool Auto & Tiện Ích PRO
// @namespace    https://decheviahe.com/
// @version      3.1.0
// @description  Tự động Mời Nước (tùy chọn số lượng), Auto Click Event trên màn hình, Mời Ghé, Hỏi Nhà, Quản lý Mặt Bằng, Bảo vệ vốn, Nhận Giftcode, Sao lưu Save game và Điều tốc mượt mà
// @author       Antigravity
// @match        https://decheviahe.com/*
// @updateURL    https://raw.githubusercontent.com/lphuxhuq/decheviahe-tool/main/decheviahe_auto_invite.user.js
// @downloadURL  https://raw.githubusercontent.com/lphuxhuq/decheviahe-tool/main/decheviahe_auto_invite.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // CONFIG & STATE MANAGEMENT
  // ==========================================
  const STORAGE_KEY_CONFIG = 'dcvh_tool_config_v3';
  const SAVE_STORAGE_KEY = 'de-che-via-he/save/v3';

  const defaultConfig = {
    scope: 'all',          // 'all' | 'deals'
    doTreat: true,         // Mời nước
    doFamily: true,        // Hỏi nhà
    doInvite: true,        // Mời ghé
    autoLeads: true,       // Chăm sóc người dẫn mối
    skipMaxTier: true,     // Bỏ qua người đã đạt max tier / đủ sao
    maxTreatCount: 0,      // Giới hạn số người mời nước (0 = không giới hạn)
    autoClickEvents: true, // Tự động click sự kiện & bong bóng trên màn hình
    autoClickChoices: true,// Tự động chọn phương án trong hộp thoại sự kiện
    autoClickBubbles: true,// Tự động click bong bóng/quà nổi trên màn hình
    minCashReserve: 20,    // Giữ lại tối thiểu bao nhiêu k tiền mặt
    actionDelay: 200,      // Độ trễ giữa các hành động (ms)
    timeMultiplier: 1,     // Tốc độ game (1x - 20x)
    btnPosition: { right: 16, bottom: 24 }
  };

  let userConfig = { ...defaultConfig };
  try {
    const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (saved) userConfig = { ...defaultConfig, ...JSON.parse(saved) };
  } catch (e) {}

  function saveUserConfig() {
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(userConfig));
    } catch (e) {}
  }

  let cachedSim = null;
  window.__timeMultiplier = userConfig.timeMultiplier || 1;
  let isRunning = false;
  let shouldStop = false;

  // ==========================================
  // DEEP SIM EXTRACTOR (ZERO-CLICK REACT FIBER BFS)
  // ==========================================
  function scanFiberForSim(rootFiber, maxDepth = 25) {
    if (!rootFiber) return null;
    const queue = [{ fiber: rootFiber, depth: 0 }];
    let visited = 0;

    while (queue.length > 0 && visited < 1500) {
      const { fiber, depth } = queue.shift();
      visited++;

      if (!fiber) continue;

      // 1. Kiểm tra props
      const props = fiber.memoizedProps;
      if (props) {
        if (props.sim && typeof props.sim.dealTargets === 'function') return props.sim;
        for (const key of Object.keys(props)) {
          const val = props[key];
          if (val && typeof val === 'object' && typeof val.dealTargets === 'function') {
            return val;
          }
        }
      }

      // 2. Kiểm tra state / stateNode
      const state = fiber.memoizedState;
      if (state && state.sim && typeof state.sim.dealTargets === 'function') {
        return state.sim;
      }
      if (fiber.stateNode && typeof fiber.stateNode.dealTargets === 'function') {
        return fiber.stateNode;
      }

      if (depth < maxDepth) {
        if (fiber.child) queue.push({ fiber: fiber.child, depth: depth + 1 });
        if (fiber.sibling) queue.push({ fiber: fiber.sibling, depth: depth });
      }
    }
    return null;
  }

  function extractSimFromDom() {
    if (cachedSim && typeof cachedSim.dealTargets === 'function') return cachedSim;
    if (window.__dcvh_sim && typeof window.__dcvh_sim.dealTargets === 'function') {
      cachedSim = window.__dcvh_sim;
      return cachedSim;
    }
    if (window.sim && typeof window.sim.dealTargets === 'function') {
      cachedSim = window.sim;
      window.__dcvh_sim = cachedSim;
      return cachedSim;
    }

    // 1. Quét từ #root hoặc #app (Không cần người chơi mở sổ tay)
    const domRoots = [
      document.getElementById('root'),
      document.getElementById('app'),
      document.getElementById('journal-root'),
      document.getElementById('books-root'),
      document.querySelector('main'),
      document.body
    ];

    for (const el of domRoots) {
      if (!el) continue;
      for (const k of Object.keys(el)) {
        if (k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$')) {
          const rootFiber = el[k]?.current || el[k];
          const found = scanFiberForSim(rootFiber);
          if (found) {
            cachedSim = found;
            window.__dcvh_sim = cachedSim;
            applyTimeMultiplier(cachedSim, window.__timeMultiplier);
            return cachedSim;
          }
        }
      }
    }

    return null;
  }

  // Hook sim.update để tua nhanh tốc độ game mượt mà
  function applyTimeMultiplier(sim, mult) {
    window.__timeMultiplier = mult;
    userConfig.timeMultiplier = mult;
    saveUserConfig();

    if (sim && !sim.__updateHooked && typeof sim.update === 'function') {
      const origUpdate = sim.update;
      sim.update = function (dt) {
        const m = window.__timeMultiplier || 1;
        return origUpdate.call(this, dt * m);
      };
      sim.__updateHooked = true;
    }
  }

  // Đọc số dư tiền người chơi
  function getPlayerCoins(sim) {
    if (sim) {
      if (typeof sim.coins === 'number') return sim.coins;
      if (typeof sim.st?.coins === 'number') return sim.st.coins;
      if (typeof sim.cash === 'number') return sim.cash;
      if (typeof sim.st?.cash === 'number') return sim.st.cash;
    }
    try {
      const raw = localStorage.getItem(SAVE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.coins === 'number') return parsed.coins;
      }
    } catch (e) {}
    return 0;
  }

  // Danh sách toàn bộ cư dân
  function getAllResidents(sim) {
    const allIds = new Set();
    if (typeof sim.knownIds === 'function') {
      for (const id of sim.knownIds()) allIds.add(id);
    }
    if (sim.soc && typeof sim.soc.acquaintances === 'function') {
      for (const id of sim.soc.acquaintances()) allIds.add(id);
    }
    if (sim.social?.rel) {
      for (const id of Object.keys(sim.social.rel)) allIds.add(id);
    }
    if (typeof sim.dealTargets === 'function') {
      for (const deal of sim.dealTargets()) {
        const gate = sim.dealGate ? sim.dealGate(deal) : null;
        if (gate?.people) {
          for (const p of gate.people) allIds.add(p.rid);
        }
        if (typeof sim.dealLeads === 'function') {
          const leadsMap = sim.dealLeads(deal);
          if (leadsMap?.values) {
            for (const leads of leadsMap.values()) {
              if (Array.isArray(leads)) {
                for (const l of leads) allIds.add(l.rid);
              }
            }
          }
        }
      }
    }

    const list = [];
    for (const id of allIds) {
      const numId = Number(id);
      if (!isNaN(numId) && numId > 9000) continue; // Bỏ qua id hệ thống

      const res = sim.resident ? sim.resident(id) : null;
      const name = res ? (res.name || id) : id;
      const tier = sim.soc ? sim.soc.tier(id) : 0;
      list.push({
        rid: id,
        name: name,
        tier: tier,
        resident: res
      });
    }

    return list;
  }

  // ==========================================
  // STYLES (MODERN RETRO COZY UI)
  // ==========================================
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    #dcvh-auto-btn {
      position: fixed;
      z-index: 999999;
      background: linear-gradient(135deg, #a8422b 0%, #7d2a19 100%);
      color: #fffdf8;
      border: 2px solid #f8e7cb;
      border-radius: 50px;
      padding: 9px 16px;
      font: 700 13px/1 "Mali", "Segoe UI", sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.3);
      cursor: grab;
      display: flex;
      align-items: center;
      gap: 7px;
      user-select: none;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    #dcvh-auto-btn:hover {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 6px 20px rgba(0,0,0,0.5);
    }
    #dcvh-auto-btn:active { cursor: grabbing; }

    #dcvh-modal {
      position: fixed;
      right: 16px;
      bottom: 74px;
      width: 400px;
      max-height: 640px;
      z-index: 999999;
      background: #faf5ed;
      border: 2.5px solid #5c442c;
      border-radius: 16px;
      box-shadow: 0 12px 35px rgba(0,0,0,0.55);
      font: 600 12.5px/1.45 "Mali", "Segoe UI", sans-serif;
      color: #383229;
      display: none;
      flex-direction: column;
      overflow: hidden;
      animation: dcvhFadeIn 0.2s ease-out;
    }
    @keyframes dcvhFadeIn {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .dcvh-header {
      background: linear-gradient(to right, #5c442c, #785a3c);
      color: #fff;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 700;
      font-size: 14.5px;
      user-select: none;
    }
    .dcvh-header-title { display: flex; align-items: center; gap: 7px; }
    .dcvh-header-tools { display: flex; align-items: center; gap: 6px; }
    .dcvh-icon-btn {
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      padding: 4px 7px;
      border-radius: 6px;
      background: rgba(255,255,255,0.18);
      color: #fff;
      border: none;
      transition: background 0.15s;
    }
    .dcvh-icon-btn:hover { background: rgba(255,255,255,0.35); }

    /* Tabs */
    .dcvh-tabs {
      display: flex;
      background: #ebdcc8;
      border-bottom: 2px solid #d4be9f;
      user-select: none;
    }
    .dcvh-tab-item {
      flex: 1;
      padding: 8px 4px;
      text-align: center;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      color: #63523f;
      transition: all 0.15s;
      border-bottom: 3px solid transparent;
    }
    .dcvh-tab-item:hover { background: #dfcdb5; }
    .dcvh-tab-item.active {
      background: #faf5ed;
      color: #8c321e;
      border-bottom-color: #8c321e;
    }

    .dcvh-body {
      padding: 12px 14px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .dcvh-tab-content { display: none; flex-direction: column; gap: 9px; }
    .dcvh-tab-content.active { display: flex; }

    .dcvh-status-card {
      background: #ede1cb;
      border: 1px solid #d9c7aa;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 12px;
    }
    .dcvh-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .dcvh-section-title {
      font-size: 11.5px;
      font-weight: 700;
      color: #5c442c;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .dcvh-card {
      background: #fdfaf5;
      border: 1px solid #e5d5be;
      border-radius: 9px;
      padding: 9px 11px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .dcvh-checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 12px;
    }
    .dcvh-checkbox-group label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    /* Speed Controls */
    .dcvh-speed-group {
      display: flex;
      gap: 4px;
    }
    .dcvh-speed-btn {
      flex: 1;
      background: #ebdcc8;
      border: 1px solid #baa486;
      border-radius: 7px;
      padding: 5px 0;
      font: 700 11.5px "Mali", sans-serif;
      color: #40362c;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .dcvh-speed-btn:hover { background: #dfcdb5; }
    .dcvh-speed-btn.active {
      background: #9a3b28;
      color: #fff;
      border-color: #9a3b28;
      box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
    }

    /* Grid Tools */
    .dcvh-quick-tools {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .dcvh-tool-btn {
      background: #ebdcc8;
      border: 1.5px solid #baa486;
      border-radius: 8px;
      padding: 7px 5px;
      font: 700 11.5px "Mali", sans-serif;
      color: #40362c;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .dcvh-tool-btn:hover { background: #dfcdb5; border-color: #5c442c; }
    .dcvh-tool-btn.highlight {
      background: #fae7cc;
      border-color: #d88126;
      color: #94321c;
    }

    /* Action Buttons */
    .dcvh-btn-row {
      display: flex;
      gap: 8px;
      margin-top: 2px;
    }
    .dcvh-start-btn {
      flex: 2;
      background: #46863d;
      color: #fff;
      border: 0;
      border-radius: 10px;
      padding: 9px;
      font: 700 13px "Mali", sans-serif;
      cursor: pointer;
      box-shadow: 0 3px 0 #2e5927;
      transition: all 0.15s;
      text-align: center;
    }
    .dcvh-start-btn:hover { background: #529c47; }
    .dcvh-start-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 #2e5927; }
    .dcvh-start-btn:disabled { background: #9c9c9c; box-shadow: none; cursor: not-allowed; }

    .dcvh-stop-btn {
      flex: 1;
      background: #cb463e;
      color: #fff;
      border: 0;
      border-radius: 10px;
      padding: 9px;
      font: 700 13px "Mali", sans-serif;
      cursor: pointer;
      box-shadow: 0 3px 0 #8f2f29;
      transition: all 0.15s;
      text-align: center;
    }
    .dcvh-stop-btn:hover { background: #db534b; }
    .dcvh-stop-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 #8f2f29; }
    .dcvh-stop-btn:disabled { background: #c2b6a6; box-shadow: none; cursor: not-allowed; opacity: 0.6; }

    .dcvh-log {
      max-height: 140px;
      overflow-y: auto;
      background: #231c17;
      color: #e5ded2;
      border-radius: 8px;
      padding: 8px;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Deal List Styling */
    .dcvh-deal-item {
      background: #fff;
      border: 1px solid #ddcca8;
      border-radius: 8px;
      padding: 7px 10px;
      margin-bottom: 6px;
    }
    .dcvh-deal-title {
      font-weight: 700;
      color: #6d4b29;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .dcvh-deal-badge {
      font-size: 10.5px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 700;
    }
    .dcvh-badge-ready { background: #d7f1d5; color: #286e24; }
    .dcvh-badge-pending { background: #fae7cc; color: #9e5b12; }

    .dcvh-input {
      background: #fff;
      border: 1px solid #b8a68b;
      border-radius: 6px;
      padding: 4px 7px;
      font: 600 12px "Mali", sans-serif;
      color: #383229;
      width: 75px;
      text-align: right;
    }
  `;
  document.head.appendChild(styleEl);

  // ==========================================
  // FLOATING BUTTON & DRAGGABLE LOGIC
  // ==========================================
  const btnEl = document.createElement('div');
  btnEl.id = 'dcvh-auto-btn';
  btnEl.innerHTML = `<span>☕</span><span>Auto Đế Chế</span>`;
  btnEl.style.right = `${userConfig.btnPosition.right}px`;
  btnEl.style.bottom = `${userConfig.btnPosition.bottom}px`;
  document.body.appendChild(btnEl);

  let isDragging = false;
  let dragStartX, dragStartY, initialRight, initialBottom;

  btnEl.addEventListener('mousedown', e => {
    isDragging = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = btnEl.getBoundingClientRect();
    initialRight = window.innerWidth - rect.right;
    initialBottom = window.innerHeight - rect.bottom;

    function onMouseMove(moveEvent) {
      const dx = moveEvent.clientX - dragStartX;
      const dy = moveEvent.clientY - dragStartY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        isDragging = true;
        const newRight = Math.max(10, Math.min(window.innerWidth - 120, initialRight - dx));
        const newBottom = Math.max(10, Math.min(window.innerHeight - 50, initialBottom - dy));
        btnEl.style.right = `${newRight}px`;
        btnEl.style.bottom = `${newBottom}px`;
      }
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (isDragging) {
        const rect = btnEl.getBoundingClientRect();
        userConfig.btnPosition = {
          right: Math.round(window.innerWidth - rect.right),
          bottom: Math.round(window.innerHeight - rect.bottom)
        };
        saveUserConfig();
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  // ==========================================
  // MODAL DIALOG
  // ==========================================
  const modalEl = document.createElement('div');
  modalEl.id = 'dcvh-modal';
  modalEl.innerHTML = `
    <div class="dcvh-header">
      <div class="dcvh-header-title">
        <span>☕</span>
        <span>Đế Chế Vỉa Hè PRO</span>
        <span style="font-size: 10px; background: rgba(255,255,255,0.25); padding: 1px 5px; border-radius: 4px;">v3.1</span>
      </div>
      <div class="dcvh-header-tools">
        <button class="dcvh-icon-btn" id="dcvh-btn-clearlog" title="Xóa nhật ký">🧹</button>
        <button class="dcvh-icon-btn dcvh-close" title="Đóng">✕</button>
      </div>
    </div>

    <!-- Tab Bar -->
    <div class="dcvh-tabs">
      <div class="dcvh-tab-item active" data-tab="tab-auto">🤖 Auto Bot</div>
      <div class="dcvh-tab-item" data-tab="tab-deals">🏢 Mặt Bằng</div>
      <div class="dcvh-tab-item" data-tab="tab-tools">⚡ Tiện Ích</div>
      <div class="dcvh-tab-item" data-tab="tab-cheat">👑 Trợ Năng</div>
    </div>

    <div class="dcvh-body">
      <!-- Status Box -->
      <div class="dcvh-status-card">
        <div class="dcvh-row">
          <span>Kết nối Game:</span>
          <b id="dcvh-status-text" style="color: #46863d">Đang kết nối...</b>
        </div>
        <div class="dcvh-row" style="margin-top: 3px;">
          <span>Tiền mặt hiện có:</span>
          <b id="dcvh-cash-text" style="color: #9a3b28">0k</b>
        </div>
      </div>

      <!-- TAB 1: AUTO BOT -->
      <div id="dcvh-tab-auto" class="dcvh-tab-content active">
        <div>
          <div class="dcvh-section-title">🎯 Phạm vi đối tượng:</div>
          <div style="display: flex; gap: 14px; font-size: 12px; margin-top: 2px;">
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="dcvh-scope" id="dcvh-scope-deals" value="deals" ${userConfig.scope === 'deals' ? 'checked' : ''} />
              <span>Chỉ Mặt Bằng</span>
            </label>
            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <input type="radio" name="dcvh-scope" id="dcvh-scope-all" value="all" ${userConfig.scope === 'all' ? 'checked' : ''} />
              <b>Toàn bộ cư dân</b>
            </label>
          </div>
        </div>

        <div>
          <div class="dcvh-section-title">📋 Hành động thực hiện:</div>
          <div class="dcvh-card dcvh-checkbox-group">
            <label>
              <input type="checkbox" id="dcvh-act-treat" ${userConfig.doTreat ? 'checked' : ''} />
              <b>☕ Mời nước (15k/người - Tăng sao)</b>
            </label>
            <label>
              <input type="checkbox" id="dcvh-act-family" ${userConfig.doFamily ? 'checked' : ''} />
              <span>🏡 Hỏi nhà (0k - Mở rộng gia phả)</span>
            </label>
            <label>
              <input type="checkbox" id="dcvh-act-invite" ${userConfig.doInvite ? 'checked' : ''} />
              <span>👋 Mời ghé (0k - Rủ ghé quầy mua hàng)</span>
            </label>
            <label>
              <input type="checkbox" id="dcvh-act-leads" ${userConfig.autoLeads ? 'checked' : ''} />
              <span>🔗 Tự động chăm sóc Người Dẫn Mối</span>
            </label>
            <label>
              <input type="checkbox" id="dcvh-act-skipmax" ${userConfig.skipMaxTier ? 'checked' : ''} />
              <span title="Không tốn 15k nếu người đó đã đạt max sao">⭐ Bỏ qua người đã đủ sao (Tiết kiệm tiền)</span>
            </label>
            <label style="border-top: 1px dashed #d9c7aa; padding-top: 5px; margin-top: 2px;">
              <input type="checkbox" id="dcvh-act-events" ${userConfig.autoClickEvents ? 'checked' : ''} />
              <b style="color: #94321c;">🎯 Tự động click Sự Kiện / Bong bóng trên màn hình</b>
            </label>
          </div>
        </div>

        <div class="dcvh-row" style="background: #fdfaf5; border: 1px solid #e5d5be; border-radius: 8px; padding: 6px 10px;">
          <span title="Nhập số người muốn mời nước tối đa mỗi lần bấm chạy (0 = Không giới hạn)">🎯 Giới hạn người mời nước:</span>
          <div>
            <input type="number" id="dcvh-max-treat" class="dcvh-input" value="${userConfig.maxTreatCount || 0}" min="0" step="1" />
            <span style="font-size: 11.5px; font-weight: 700;"> người</span>
          </div>
        </div>

        <div class="dcvh-row" style="background: #fdfaf5; border: 1px solid #e5d5be; border-radius: 8px; padding: 6px 10px;">
          <span>🛡️ Giữ lại vốn tối thiểu:</span>
          <div>
            <input type="number" id="dcvh-min-cash" class="dcvh-input" value="${userConfig.minCashReserve}" min="0" step="5" />
            <span style="font-size: 11.5px; font-weight: 700;"> k</span>
          </div>
        </div>

        <div class="dcvh-btn-row">
          <button id="dcvh-run-btn" class="dcvh-start-btn">🚀 Bắt Đầu Tự Động</button>
          <button id="dcvh-stop-btn" class="dcvh-stop-btn" disabled>🛑 Dừng</button>
        </div>
      </div>

      <!-- TAB 2: MẶT BẰNG & CƯ DÂN -->
      <div id="dcvh-tab-deals" class="dcvh-tab-content">
        <div class="dcvh-row">
          <div class="dcvh-section-title">📊 Tiến độ các căn:</div>
          <button id="dcvh-btn-refresh-deals" class="dcvh-tool-btn" style="padding: 2px 8px; font-size: 11px;">🔄 Làm mới</button>
        </div>
        <div id="dcvh-deals-list" style="max-height: 250px; overflow-y: auto; padding-right: 2px;">
          <div style="text-align: center; color: #887; padding: 15px 0;">Đang tải danh sách mặt bằng...</div>
        </div>
      </div>

      <!-- TAB 3: TIỆN ÍCH & TỐC ĐỘ -->
      <div id="dcvh-tab-tools" class="dcvh-tab-content">
        <div>
          <div class="dcvh-section-title">⚡ Tốc độ Game (Tua nhanh thời gian):</div>
          <div class="dcvh-speed-group">
            <button class="dcvh-speed-btn ${userConfig.timeMultiplier === 1 ? 'active' : ''}" data-speed="1">1x</button>
            <button class="dcvh-speed-btn ${userConfig.timeMultiplier === 2 ? 'active' : ''}" data-speed="2">2x</button>
            <button class="dcvh-speed-btn ${userConfig.timeMultiplier === 3 ? 'active' : ''}" data-speed="3">3x</button>
            <button class="dcvh-speed-btn ${userConfig.timeMultiplier === 5 ? 'active' : ''}" data-speed="5">5x</button>
            <button class="dcvh-speed-btn ${userConfig.timeMultiplier === 10 ? 'active' : ''}" data-speed="10">10x</button>
          </div>
        </div>

        <div>
          <div class="dcvh-section-title">🎁 Quà tặng & Save Game:</div>
          <div class="dcvh-quick-tools">
            <button id="dcvh-btn-gift" class="dcvh-tool-btn highlight" title="Nhận 5 mã giftcode: 21 triệu vốn">🎁 Nhận 21M Giftcode</button>
            <button id="dcvh-btn-quick-inspect" class="dcvh-tool-btn" title="Xuất báo cáo mặt bằng vào log">📊 Xuất Báo Cáo</button>
            <button id="dcvh-btn-export" class="dcvh-tool-btn" title="Lưu bản sao save game về máy">💾 Xuất File Save</button>
            <button id="dcvh-btn-import" class="dcvh-tool-btn" title="Nạp lại file save game">📥 Nạp File Save</button>
          </div>
          <input type="file" id="dcvh-file-input" style="display: none;" accept=".json" />
        </div>

        <div class="dcvh-row" style="background: #fdfaf5; border: 1px solid #e5d5be; border-radius: 8px; padding: 6px 10px;">
          <span>⏱️ Độ trễ mỗi thao tác:</span>
          <div>
            <input type="number" id="dcvh-action-delay" class="dcvh-input" value="${userConfig.actionDelay}" min="50" max="1000" step="50" />
            <span style="font-size: 11.5px; font-weight: 700;"> ms</span>
          </div>
        </div>
      </div>

      <!-- TAB 4: TRỢ NĂNG / CHEAT TEST -->
      <div id="dcvh-tab-cheat" class="dcvh-tab-content">
        <div class="dcvh-section-title">👑 Trợ Năng Thử Nghiệm:</div>
        <div style="font-size: 11.5px; color: #735a42; margin-bottom: 4px;">
          Dành cho bạn muốn khám phá hoặc kiểm thử tính năng nhanh chóng:
        </div>
        <div class="dcvh-quick-tools">
          <button id="dcvh-cheat-add100" class="dcvh-tool-btn">+100k Vốn</button>
          <button id="dcvh-cheat-add1m" class="dcvh-tool-btn highlight">+1.000k Vốn</button>
          <button id="dcvh-cheat-add10m" class="dcvh-tool-btn highlight">+10.000k Vốn</button>
          <button id="dcvh-cheat-reset-day" class="dcvh-tool-btn" title="Xóa lịch sử tiếp xúc hôm nay để mời lại">🔄 Reset Lượt Ngày</button>
        </div>
      </div>

      <!-- Live Activity Log -->
      <div>
        <div class="dcvh-section-title">📝 Nhật ký hoạt động:</div>
        <div id="dcvh-log-box" class="dcvh-log">Sẵn sàng! Siêu Tool v3.0 đã kích hoạt.</div>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // ==========================================
  // TAB SWITCHING
  // ==========================================
  modalEl.querySelectorAll('.dcvh-tab-item').forEach(tab => {
    tab.onclick = () => {
      modalEl.querySelectorAll('.dcvh-tab-item').forEach(t => t.classList.remove('active'));
      modalEl.querySelectorAll('.dcvh-tab-content').forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.dataset.tab;
      const targetContent = modalEl.querySelector(`#dcvh-${targetId}`);
      if (targetContent) targetContent.classList.add('active');

      if (targetId === 'tab-deals') {
        renderDealsTab();
      }
    };
  });

  // Toggle Modal
  btnEl.onclick = e => {
    if (isDragging) return;
    const isShowing = modalEl.style.display === 'flex';
    modalEl.style.display = isShowing ? 'none' : 'flex';
    if (!isShowing) updateWidgetStatus();
  };

  modalEl.querySelector('.dcvh-close').onclick = () => {
    modalEl.style.display = 'none';
  };

  modalEl.querySelector('#dcvh-btn-clearlog').onclick = () => {
    clearLog();
  };

  // Speed selection
  modalEl.querySelectorAll('.dcvh-speed-btn').forEach(btn => {
    btn.onclick = () => {
      modalEl.querySelectorAll('.dcvh-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const speed = Number(btn.dataset.speed) || 1;
      const sim = extractSimFromDom();
      applyTimeMultiplier(sim, speed);
      appendLog(`⚡ Đã chỉnh tốc độ game thành: ${speed}x!`);
    };
  });

  // Change input handlers
  document.getElementById('dcvh-min-cash').onchange = e => {
    userConfig.minCashReserve = Math.max(0, Number(e.target.value) || 0);
    saveUserConfig();
  };

  document.getElementById('dcvh-action-delay').onchange = e => {
    userConfig.actionDelay = Math.max(50, Number(e.target.value) || 200);
    saveUserConfig();
  };

  const maxTreatInput = document.getElementById('dcvh-max-treat');
  if (maxTreatInput) {
    maxTreatInput.onchange = e => {
      userConfig.maxTreatCount = Math.max(0, parseInt(e.target.value, 10) || 0);
      saveUserConfig();
    };
  }

  const actEventsEl = document.getElementById('dcvh-act-events');
  if (actEventsEl) {
    actEventsEl.onchange = () => {
      userConfig.autoClickEvents = actEventsEl.checked;
      saveUserConfig();
    };
  }

  ['treat', 'family', 'invite', 'leads', 'skipmax'].forEach(k => {
    const el = document.getElementById(`dcvh-act-${k}`);
    if (el) {
      el.onchange = () => {
        if (k === 'treat') userConfig.doTreat = el.checked;
        if (k === 'family') userConfig.doFamily = el.checked;
        if (k === 'invite') userConfig.doInvite = el.checked;
        if (k === 'leads') userConfig.autoLeads = el.checked;
        if (k === 'skipmax') userConfig.skipMaxTier = el.checked;
        saveUserConfig();
      };
    }
  });

  document.querySelectorAll('input[name="dcvh-scope"]').forEach(r => {
    r.onchange = () => {
      userConfig.scope = r.value;
      saveUserConfig();
    };
  });

  // Log helpers
  function appendLog(msg) {
    const logBox = document.getElementById('dcvh-log-box');
    if (logBox) {
      logBox.textContent += '\n' + msg;
      logBox.scrollTop = logBox.scrollHeight;
    }
  }

  function clearLog() {
    const logBox = document.getElementById('dcvh-log-box');
    if (logBox) logBox.textContent = '✨ Đã làm sạch nhật ký.';
  }

  // ==========================================
  // AUTO EVENT & BUBBLE CATCHER (CORE LISTENER)
  // ==========================================
  let lastEventClickTime = 0;
  function processAutoEvents() {
    if (!userConfig.autoClickEvents) return;
    const now = Date.now();
    if (now - lastEventClickTime < 700) return; // Debounce 700ms

    // 1. Quét Dialog / Modal Sự Kiện & Thông Báo Nổi
    const modals = document.querySelectorAll('div[class*="modal"], div[class*="dialog"], div[role="dialog"], div[class*="popup"], div[class*="event"], div[class*="card"]');
    for (const modal of modals) {
      if (modal.closest('#dcvh-modal') || modal.closest('#dcvh-auto-btn')) continue;
      if (modal.offsetParent === null && window.getComputedStyle(modal).display === 'none') continue;

      const buttons = modal.querySelectorAll('button, [role="button"], .btn');
      for (const btn of buttons) {
        if (btn.offsetParent === null || btn.disabled) continue;
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text.includes('xóa') || text.includes('reset') || text.includes('hủy') || text.includes('thoát')) continue;

        if (
          text.includes('nhận') ||
          text.includes('tiếp tục') ||
          text.includes('xác nhận') ||
          text.includes('đồng ý') ||
          text.includes('xong') ||
          text.includes('ok') ||
          text.includes('đóng') ||
          text.includes('thu hoạch') ||
          text.includes('lấy quà') ||
          text.includes('chấp nhận') ||
          text.includes('thu tiền')
        ) {
          btn.click();
          lastEventClickTime = now;
          appendLog(`🎯 [Auto Event] Đã bấm: "${btn.textContent.trim()}"`);
          return;
        }
      }

      // Tự động chọn phương án đầu tiên trong hộp thoại sự kiện nếu có
      if (userConfig.autoClickChoices && buttons.length > 0) {
        for (const btn of buttons) {
          if (btn.offsetParent === null || btn.disabled) continue;
          btn.click();
          lastEventClickTime = now;
          appendLog(`🎯 [Auto Event] Đã chọn phương án: "${btn.textContent.trim()}"`);
          return;
        }
      }
    }

    // 2. Quét Bong Bóng Nổi / Floating Bubbles / Biểu tượng sự kiện trên màn hình
    if (userConfig.autoClickBubbles) {
      const bubbleSelectors = [
        '[class*="bubble"]',
        '[class*="floating"]',
        '[class*="event-icon"]',
        '[class*="event-badge"]',
        '[data-event]',
        '[class*="speech-bubble"]'
      ];
      const elements = document.querySelectorAll(bubbleSelectors.join(','));
      for (const el of elements) {
        if (el.closest('#dcvh-modal') || el.closest('#dcvh-auto-btn')) continue;
        if (el.offsetParent === null) continue;

        el.click();
        lastEventClickTime = now;
        appendLog(`🎈 [Auto Event] Đã click bong bóng/sự kiện nổi trên màn hình!`);
        return;
      }

      // Quét các nút hoặc icon có biểu tượng sự kiện 🎁, ❗, ❓, 💬, 💰
      const clickables = document.querySelectorAll('button, div[role="button"], span[role="button"]');
      for (const el of clickables) {
        if (el.closest('#dcvh-modal') || el.closest('#dcvh-auto-btn')) continue;
        if (el.offsetParent === null) continue;
        const text = (el.textContent || '').trim();
        if (text.includes('🎁') || text.includes('❗') || text.includes('💬') || text.includes('💰')) {
          el.click();
          lastEventClickTime = now;
          appendLog(`🎁 [Auto Event] Đã bấm icon sự kiện: "${text.substring(0, 20)}"`);
          return;
        }
      }
    }
  }

  // Periodic Status Update & Event Loop
  function updateWidgetStatus() {
    const sim = extractSimFromDom();
    const statusText = document.getElementById('dcvh-status-text');
    const cashText = document.getElementById('dcvh-cash-text');

    const coins = getPlayerCoins(sim);
    if (cashText) {
      cashText.textContent = `${Math.floor(coins).toLocaleString('vi-VN')}k`;
    }

    if (sim) {
      if (statusText) {
        statusText.textContent = `✅ Đã kết nối (Ngày ${sim.day || 1})`;
        statusText.style.color = '#46863d';
      }
    } else {
      if (statusText) {
        statusText.textContent = '⚠️ Mở Sổ tay hoặc bấm bất kỳ đâu';
        statusText.style.color = '#d9822b';
      }
    }
  }

  setInterval(() => {
    updateWidgetStatus();
    processAutoEvents();
  }, 500);

  // ==========================================
  // TAB 2: RENDER DEALS TAB
  // ==========================================
  function renderDealsTab() {
    const sim = extractSimFromDom();
    const listEl = document.getElementById('dcvh-deals-list');
    if (!listEl) return;

    if (!sim) {
      listEl.innerHTML = `<div style="text-align: center; color: #d9544d; padding: 15px 0;">⚠️ Chưa kết nối được game. Vui lòng mở Sổ tay 1 lần!</div>`;
      return;
    }

    const deals = sim.dealTargets ? sim.dealTargets() : [];
    if (!deals.length) {
      listEl.innerHTML = `<div style="text-align: center; color: #887; padding: 15px 0;">ℹ️ Chưa có dữ liệu mặt bằng nào mở khóa.</div>`;
      return;
    }

    let html = '';
    for (const deal of deals) {
      const gate = sim.dealGate ? sim.dealGate(deal) : null;
      if (!gate || !gate.need) continue;

      const houseNo = sim.houseNoOfSlot ? sim.houseNoOfSlot(deal.slot) : deal.slot;
      const isReady = gate.ready;

      html += `
        <div class="dcvh-deal-item">
          <div class="dcvh-deal-title">
            <span>🏠 Căn số ${houseNo}</span>
            <span class="dcvh-deal-badge ${isReady ? 'dcvh-badge-ready' : 'dcvh-badge-pending'}">
              ${isReady ? '✅ SẴN SÀNG KÝ' : '⏳ CHƯA ĐỦ'}
            </span>
          </div>
          <div style="font-size: 11.5px; color: #5a4b3c; display: flex; flex-direction: column; gap: 2px;">
      `;

      if (Array.isArray(gate.people)) {
        for (const p of gate.people) {
          const res = sim.resident ? sim.resident(p.rid) : null;
          const name = res ? (res.name || p.rid) : p.rid;
          const role = p.role === 'owner' ? 'Chủ nhà' : 'Cổ đông';
          const ok = p.tier >= p.need;
          const statusIcon = ok ? '✓' : `✗ Thiếu ${p.need - p.tier}⭐`;
          const statusColor = ok ? '#286e24' : '#ba4329';

          html += `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span>• <b>${name}</b> (${role})</span>
              <span style="font-weight: 700; color: ${statusColor}">${p.tier}/${p.need} ⭐ (${statusIcon})</span>
            </div>
          `;
        }
      }

      html += `
          </div>
        </div>
      `;
    }

    listEl.innerHTML = html || `<div style="text-align: center; color: #887; padding: 10px 0;">Không có thông tin mặt bằng.</div>`;
  }

  document.getElementById('dcvh-btn-refresh-deals').onclick = renderDealsTab;

  // ==========================================
  // TAB 3: TIỆN ÍCH ACTIONS
  // ==========================================
  // 1. Nhận Giftcode
  document.getElementById('dcvh-btn-gift').onclick = () => {
    const sim = extractSimFromDom();
    if (!sim) {
      appendLog('⚠️ Hãy mở Sổ tay 1 lần để nhận diện game trước!');
      return;
    }
    const codes = [
      { code: 'KHOINGHIEP', name: '+1.000k Vốn khởi nghiệp' },
      { code: 'VIAHE500', name: '+2.000k Tiếp sức vỉa hè' },
      { code: 'LAMNAYLAMKIA', name: '+3.000k Quà Làm Này Làm Kia' },
      { code: 'DECHE2026', name: '+5.000k Mở rộng đế chế' },
      { code: 'CUONGROTVON', name: '+10.000k Cường rót vốn lớn' }
    ];
    clearLog();
    appendLog('🎁 Đang kích hoạt 5 mã Giftcode chính thức...');
    let totalClaimed = 0;
    for (const item of codes) {
      try {
        const res = sim.redeemCode ? sim.redeemCode(item.code) : null;
        if (res && res.ok) {
          appendLog(`✅ Nhận thành công: ${item.code} (${item.name})`);
          totalClaimed++;
        } else {
          appendLog(`ℹ️ ${item.code}: ${res?.error || 'Đã dùng rồi'}`);
        }
      } catch (e) {
        appendLog(`⚠️ Lỗi mã ${item.code}: ${e.message}`);
      }
    }
    updateWidgetStatus();
    appendLog(`\n🎉 Xong! Tổng quà nhận: ${totalClaimed} mã.`);
  };

  // 2. Xuất báo cáo mặt bằng
  document.getElementById('dcvh-btn-quick-inspect').onclick = () => {
    const sim = extractSimFromDom();
    if (!sim) {
      appendLog('⚠️ Hãy mở Sổ tay 1 lần để nhận diện game trước!');
      return;
    }
    clearLog();
    appendLog('📊 BÁO CÁO TIẾN ĐỘ MẶT BẰNG KHU PHỐ:\n');
    const deals = sim.dealTargets ? sim.dealTargets() : [];
    if (!deals.length) {
      appendLog('ℹ️ Chưa có dữ liệu mặt bằng.');
      return;
    }
    for (const deal of deals) {
      const gate = sim.dealGate ? sim.dealGate(deal) : null;
      if (!gate || !gate.need) continue;
      const houseNo = sim.houseNoOfSlot ? sim.houseNoOfSlot(deal.slot) : deal.slot;
      const statusLabel = gate.ready ? '✅ ĐÃ SẴN SÀNG KÝ HỢP ĐỒNG!' : '⏳ CHƯA ĐỦ ĐIỀU KIỆN';
      appendLog(`🏠 Căn số ${houseNo} [${statusLabel}]`);
      if (Array.isArray(gate.people)) {
        for (const p of gate.people) {
          const res = sim.resident ? sim.resident(p.rid) : null;
          const name = res ? (res.name || p.rid) : p.rid;
          const role = p.role === 'owner' ? 'Chủ căn' : 'Cổ đông';
          const ok = p.tier >= p.need;
          const mark = ok ? '✓ Đủ' : `✗ Cần thêm ${p.need - p.tier} ⭐`;
          appendLog(`   • ${role}: ${name} (${p.tier}/${p.need} ⭐) → ${mark}`);
        }
      }
      appendLog('');
    }
  };

  // 3. Sao lưu Save
  document.getElementById('dcvh-btn-export').onclick = () => {
    const sim = extractSimFromDom();
    const data = localStorage.getItem(SAVE_STORAGE_KEY);
    if (!data) {
      appendLog('⚠️ Không tìm thấy file lưu trên trình duyệt!');
      return;
    }
    const day = sim?.day || 'backup';
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DeCheViaHe_Save_Ngay_${day}.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog(`💾 Đã xuất file sao lưu Ngày ${day} thành công!`);
  };

  // 4. Nạp lại Save
  const fileInput = document.getElementById('dcvh-file-input');
  document.getElementById('dcvh-btn-import').onclick = () => {
    fileInput.value = '';
    fileInput.click();
  };
  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text = ev.target.result;
        JSON.parse(text); // validate JSON
        localStorage.setItem(SAVE_STORAGE_KEY, text);
        appendLog('📥 Đã khôi phục file save thành công! Đang tải lại game...');
        setTimeout(() => window.location.reload(), 1000);
      } catch (err) {
        appendLog(`❌ File save không đúng định dạng: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // ==========================================
  // TAB 4: CHEATS & EXPERIMENTAL
  // ==========================================
  function addPlayerCash(amount) {
    const sim = extractSimFromDom();
    if (!sim) {
      appendLog('⚠️ Hãy tương tác với game trước khi thêm vốn!');
      return;
    }
    try {
      if (typeof sim.coins === 'number') sim.coins += amount;
      if (sim.st && typeof sim.st.coins === 'number') sim.st.coins += amount;
      if (typeof sim.cash === 'number') sim.cash += amount;
      if (sim.st && typeof sim.st.cash === 'number') sim.st.cash += amount;

      // Cập nhật cả LocalStorage để không bị mất khi F5
      const raw = localStorage.getItem(SAVE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.coins === 'number') parsed.coins += amount;
        if (typeof parsed.cash === 'number') parsed.cash += amount;
        localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(parsed));
      }

      appendLog(`💰 Đã bơm thêm +${amount.toLocaleString('vi-VN')}k vào tài khoản!`);
      updateWidgetStatus();
    } catch (e) {
      appendLog(`⚠️ Không thể bơm vốn trực tiếp: ${e.message}`);
    }
  }

  document.getElementById('dcvh-cheat-add100').onclick = () => addPlayerCash(100);
  document.getElementById('dcvh-cheat-add1m').onclick = () => addPlayerCash(1000);
  document.getElementById('dcvh-cheat-add10m').onclick = () => addPlayerCash(10000);

  document.getElementById('dcvh-cheat-reset-day').onclick = () => {
    const sim = extractSimFromDom();
    if (!sim) {
      appendLog('⚠️ Hãy tương tác với game trước!');
      return;
    }
    try {
      if (sim.contactedToday) {
        // Reset danh sách đã tiếp xúc hôm nay nếu có thể
        if (sim.contacted) sim.contacted = {};
        if (sim.st?.contacted) sim.st.contacted = {};
        appendLog('🔄 Đã làm mới lượt tương tác hôm nay! Bạn có thể mời nước tiếp.');
      }
    } catch (e) {
      appendLog(`⚠️ Lỗi reset: ${e.message}`);
    }
  };

  // ==========================================
  // AUTO ENGINE (CORE EXECUTION)
  // ==========================================
  document.getElementById('dcvh-stop-btn').onclick = () => {
    if (isRunning) {
      shouldStop = true;
      const stopBtn = document.getElementById('dcvh-stop-btn');
      stopBtn.disabled = true;
      stopBtn.textContent = '⏳ Đang dừng...';
      appendLog('⚠️ Đang ngắt tiến trình, vui lòng chờ xử lý nốt lượt hiện tại...');
    }
  };

  async function executeAutoActions() {
    const runBtn = document.getElementById('dcvh-run-btn');
    const stopBtn = document.getElementById('dcvh-stop-btn');
    const sim = extractSimFromDom();

    if (!sim) {
      clearLog();
      appendLog('⚠️ Chưa nhận diện được dữ liệu game!');
      appendLog('👉 Hãy bấm vào biểu tượng "Sổ tay dân cư" hoặc "Sân ga" trong game 1 lần duy nhất, sau đó bấm lại nút này.');
      return;
    }

    isRunning = true;
    shouldStop = false;
    runBtn.disabled = true;
    runBtn.textContent = '⏳ Đang chạy...';
    stopBtn.disabled = false;
    stopBtn.textContent = '🛑 Dừng';
    clearLog();

    const isScopeAll = userConfig.scope === 'all';
    const doTreat = userConfig.doTreat;
    const doFamily = userConfig.doFamily;
    const doInvite = userConfig.doInvite;
    const autoLeads = userConfig.autoLeads;
    const skipMaxTier = userConfig.skipMaxTier;
    const maxTreat = userConfig.maxTreatCount || 0;
    const minReserve = userConfig.minCashReserve || 0;
    const delayMs = userConfig.actionDelay || 200;

    appendLog(isScopeAll ? '🔍 Đang quét toàn bộ cư dân trong xóm...' : '🔍 Đang quét nhân vật cần thiết cho Mặt Bằng...');
    if (doTreat && maxTreat > 0) {
      appendLog(`🎯 Mục tiêu mời nước: Tối đa ${maxTreat} người.`);
    }

    let targets = [];
    const leadTargets = new Map();

    if (isScopeAll) {
      targets = getAllResidents(sim);
      appendLog(`🎯 Đã tìm thấy ${targets.length} cư dân trong toàn xóm.`);
    } else {
      const deals = sim.dealTargets ? sim.dealTargets() : [];
      const directMap = new Map();

      for (const deal of deals) {
        const gate = sim.dealGate ? sim.dealGate(deal) : null;
        if (!gate || !gate.need || gate.ready) continue;

        const houseNo = sim.houseNoOfSlot ? sim.houseNoOfSlot(deal.slot) : deal.slot;
        const dealTitle = `Căn ${houseNo}`;
        const leadsMap = sim.dealLeads ? sim.dealLeads(deal) : new Map();

        if (Array.isArray(gate.people)) {
          for (const p of gate.people) {
            if (p.tier < p.need) {
              const res = sim.resident ? sim.resident(p.rid) : null;
              const name = res ? (res.name || p.rid) : p.rid;
              const blockReason = sim.relBlock ? sim.relBlock(p.rid) : null;
              const isBlocked = Boolean(blockReason);

              if (!directMap.has(p.rid)) {
                directMap.set(p.rid, {
                  rid: p.rid,
                  name: name,
                  tier: p.tier,
                  need: p.need,
                  deal: dealTitle,
                  isBlocked: isBlocked
                });
              }

              if (isBlocked && autoLeads) {
                const leads = leadsMap.get ? (leadsMap.get(p.rid) || []) : [];
                for (const l of leads) {
                  const leadRes = sim.resident ? sim.resident(l.rid) : null;
                  const leadName = leadRes ? (leadRes.name || l.rid) : l.rid;
                  if (!leadTargets.has(l.rid)) {
                    leadTargets.set(l.rid, {
                      rid: l.rid,
                      name: leadName,
                      role: `Người dẫn mối cho ${name} (${l.label || 'người quen'})`
                    });
                  }
                }
              }
            }
          }
        }
      }
      targets = Array.from(directMap.values());
      appendLog(`🎯 Đã tìm thấy ${targets.length} nhân vật trọng yếu cho Mặt Bằng.`);
    }

    appendLog('\n⚡ BẮT ĐẦU THAO TÁC:');
    let invitedCount = 0;
    let spentCash = 0;
    let familyCount = 0;
    let inviteGheCount = 0;

    // Giai đoạn 1: Hỏi nhà toàn bộ
    if (doFamily && !shouldStop) {
      appendLog('\n--- 🏡 Giai đoạn 1: Hỏi nhà để mở gia phả ---');
      for (const item of targets) {
        if (shouldStop) {
          appendLog('🛑 Đã dừng theo yêu cầu của bạn.');
          break;
        }
        const contacted = sim.contactedToday ? sim.contactedToday(item.rid) : [];
        if (!contacted.includes('family')) {
          try {
            const famMsg = sim.contact('family', item.rid);
            if (typeof famMsg === 'string' && famMsg.includes('biết')) {
              appendLog(`🏡 [Hỏi nhà] ${item.name}: ${famMsg}`);
              familyCount++;
              await new Promise(r => setTimeout(r, Math.max(50, delayMs - 50)));
            }
          } catch (e) {}
        }
      }
      if (familyCount === 0 && !shouldStop) appendLog('ℹ️ Hôm nay không có người mới để hỏi nhà hoặc đã hỏi hết.');
    }

    // Giai đoạn 2: Chăm sóc Người dẫn mối
    if (!isScopeAll && autoLeads && leadTargets.size > 0 && !shouldStop) {
      appendLog('\n--- 🔗 Giai đoạn 2: Chăm sóc Người Dẫn Mối ---');
      for (const [rid, lead] of leadTargets.entries()) {
        if (shouldStop) {
          appendLog('🛑 Đã dừng theo yêu cầu của bạn.');
          break;
        }
        const contacted = sim.contactedToday ? sim.contactedToday(rid) : [];
        if (doTreat && !contacted.includes('treat')) {
          if (maxTreat > 0 && invitedCount >= maxTreat) {
            appendLog(`🎯 Đã hoàn thành chỉ tiêu mời nước (${invitedCount}/${maxTreat} người). Dừng mời.`);
            break;
          }
          const currentCoins = getPlayerCoins(sim);
          if (currentCoins - 15 < minReserve) {
            appendLog(`🛡️ Đã chạm mức vốn bảo toàn (${Math.floor(currentCoins)}k <= ${minReserve}k + 15k). Dừng mời.`);
            break;
          }
          try {
            const res = sim.contact('treat', rid);
            if (typeof res === 'string' && !res.includes('Hôm nay đã làm rồi') && res !== 'Không đủ 15k') {
              appendLog(`✅ [Dẫn mối] ${res}`);
              invitedCount++;
              spentCash += 15;
            }
            if (doInvite && !contacted.includes('invite')) {
              sim.contact('invite', rid);
            }
            await new Promise(r => setTimeout(r, delayMs));
          } catch (e) {}
        }
      }
    }

    // Giai đoạn 3: Mời nước & Mời ghé
    if (!shouldStop) {
      appendLog('\n--- ☕ Giai đoạn 3: Mời nước & Mời ghé ---');
      for (const item of targets) {
        if (shouldStop) {
          appendLog('🛑 Đã dừng theo yêu cầu của bạn.');
          break;
        }

        const contacted = sim.contactedToday ? sim.contactedToday(item.rid) : [];

        // Mời ghé (0k)
        if (doInvite && !contacted.includes('invite')) {
          try {
            const invRes = sim.contact('invite', item.rid);
            if (typeof invRes === 'string' && invRes.includes('Đã nhắn')) {
              appendLog(`👋 [Mời ghé] ${invRes}`);
              inviteGheCount++;
            }
          } catch (e) {}
        }

        // Mời nước (15k)
        if (doTreat) {
          if (contacted.includes('treat')) continue;

          if (maxTreat > 0 && invitedCount >= maxTreat) {
            appendLog(`🎯 Đã hoàn thành chỉ tiêu mời nước (${invitedCount}/${maxTreat} người). Dừng mời.`);
            break;
          }

          // Kiểm tra nếu đã max tier
          if (skipMaxTier) {
            const curTier = sim.soc ? sim.soc.tier(item.rid) : (item.tier || 0);
            if (item.need && curTier >= item.need) {
              continue; // Đã đủ sao cho deal này
            }
            if (curTier >= 4) {
              continue; // Thường tier 4 hoặc 5 là max
            }
          }

          if (!isScopeAll && item.isBlocked) {
            appendLog(`🔒 [Đang kẹt] ${item.name}: Bị chặn dẫn mối, tạm hoãn mời nước.`);
            continue;
          }

          const currentCoins = getPlayerCoins(sim);
          if (currentCoins - 15 < minReserve) {
            appendLog(`🛡️ Đã chạm mức vốn bảo toàn (${Math.floor(currentCoins)}k <= ${minReserve}k + 15k). Dừng mời.`);
            break;
          }

          try {
            const treatRes = sim.contact('treat', item.rid);
            if (typeof treatRes === 'string') {
              if (treatRes === 'Không đủ 15k') break;
              if (treatRes.includes('Hôm nay đã làm rồi')) continue;
              if (treatRes.includes('không tiếp người lạ') || treatRes.includes('giới thiệu')) {
                appendLog(`🔒 [Chưa mở] ${item.name}: Cần người dẫn mối.`);
                continue;
              }
              appendLog(`✅ ${treatRes}`);
            } else {
              appendLog(`✅ [Đã mời nước] ${item.name} (-15k)`);
            }

            invitedCount++;
            spentCash += 15;
            updateWidgetStatus();
            await new Promise(r => setTimeout(r, delayMs));
          } catch (err) {
            appendLog(`⚠️ Lỗi mời ${item.name}: ${err.message || err}`);
          }
        }
      }
    }

    if (shouldStop) {
      appendLog(`\n🛑 TIẾN TRÌNH ĐÃ ĐƯỢC DỪNG LẠI THÀNH CÔNG!`);
    } else {
      appendLog(`\n🎉 HOÀN TẤT THAO TÁC!`);
    }
    const targetLabel = maxTreat > 0 ? `${invitedCount}/${maxTreat}` : `${invitedCount}`;
    appendLog(` • Đã mời nước: ${targetLabel} người (Tổng chi: ${spentCash}k).`);
    appendLog(` • Đã hỏi nhà: ${familyCount} người.`);
    appendLog(` • Đã mời ghé quầy: ${inviteGheCount} người.`);

    updateWidgetStatus();
    isRunning = false;
    shouldStop = false;
    runBtn.disabled = false;
    runBtn.textContent = '🚀 Bắt Đầu Tự Động';
    stopBtn.disabled = true;
    stopBtn.textContent = '🛑 Dừng';
  }

  document.getElementById('dcvh-run-btn').onclick = executeAutoActions;
})();

