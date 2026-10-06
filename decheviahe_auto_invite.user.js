// ==UserScript==
// @name         Đế Chế Vỉa Hè - Siêu Tool Auto & Tiện Ích
// @namespace    https://decheviahe.com/
// @version      2.2.0
// @description  Tự động Mời Nước, Mời Ghé, Hỏi Nhà, Nhận Giftcode 21 triệu vốn, Soi tiến độ mặt bằng, Sao lưu save game và Tua nhanh tốc độ
// @author       Antigravity
// @match        https://decheviahe.com/*
// @updateURL    https://raw.githubusercontent.com/lphuxhuq/decheviahe-tool/main/decheviahe_auto_invite.user.js
// @downloadURL  https://raw.githubusercontent.com/lphuxhuq/decheviahe-tool/main/decheviahe_auto_invite.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  let cachedSim = null;
  window.__timeMultiplier = 1;

  let isRunning = false;
  let shouldStop = false;

  // Lấy số tiền hiện có từ sim (trong game biến tiền là sim.coins)
  function getPlayerCoins(sim) {
    if (!sim) return 0;
    if (typeof sim.coins === 'number') return sim.coins;
    if (typeof sim.st?.coins === 'number') return sim.st.coins;
    if (typeof sim.cash === 'number') return sim.cash;
    if (typeof sim.st?.cash === 'number') return sim.st.cash;
    return 0;
  }

  // Hook sim.update để tua nhanh tốc độ game
  function applyTimeMultiplier(sim, mult) {
    window.__timeMultiplier = mult;
    if (sim && !sim.__updateHooked && typeof sim.update === 'function') {
      const origUpdate = sim.update;
      sim.update = function (dt) {
        const m = window.__timeMultiplier || 1;
        return origUpdate.call(this, dt * m);
      };
      sim.__updateHooked = true;
    }
  }

  // Quét đối tượng sim từ React Fiber
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

    const journalRoot = document.getElementById('journal-root') || document.getElementById('app') || document.body;
    if (journalRoot) {
      const candidates = [journalRoot, ...journalRoot.querySelectorAll('*')];
      for (const el of candidates) {
        const fiberKey = Object.keys(el).find(
          k => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$') || k.startsWith('__reactProps$')
        );
        if (fiberKey) {
          let node = el[fiberKey];
          let depth = 0;
          while (node && depth < 30) {
            depth++;
            const props = node.memoizedProps;
            if (props && props.sim && typeof props.sim.dealTargets === 'function') {
              cachedSim = props.sim;
              window.__dcvh_sim = cachedSim;
              applyTimeMultiplier(cachedSim, window.__timeMultiplier);
              return cachedSim;
            }
            node = node.return || node.child;
          }
        }
      }
    }
    return null;
  }

  // Lắng nghe khi DOM thay đổi để bắt `sim` ngay khi mở Sổ tay
  const domObserver = new MutationObserver(() => {
    if (!cachedSim) {
      const sim = extractSimFromDom();
      if (sim) updateWidgetStatus(true);
    }
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

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
      if (!isNaN(numId) && numId > 9000) continue;

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

  // CSS Giao diện Widget
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    #dcvh-auto-btn {
      position: fixed;
      right: 16px;
      bottom: 24px;
      z-index: 999999;
      background: #9a3b28;
      color: #fffdf6;
      border: 2px solid #fff;
      border-radius: 50px;
      padding: 10px 16px;
      font: 700 14px "Mali", "Segoe UI", sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,0.35);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      user-select: none;
      transition: all 0.2s ease;
    }
    #dcvh-auto-btn:hover {
      background: #b54631;
      transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    }
    #dcvh-modal {
      position: fixed;
      right: 16px;
      bottom: 74px;
      width: 370px;
      max-height: 600px;
      z-index: 999999;
      background: #fffdf6;
      border: 3px solid #6b5136;
      border-radius: 18px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      font: 600 13px/1.45 "Mali", "Segoe UI", sans-serif;
      color: #3c3a38;
      display: none;
      flex-direction: column;
      overflow: hidden;
      animation: dcvhFadeIn 0.2s ease;
    }
    @keyframes dcvhFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .dcvh-header {
      background: #6b5136;
      color: #fff;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 700;
      font-size: 15px;
    }
    .dcvh-header span { display: flex; align-items: center; gap: 6px; }
    .dcvh-close {
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 6px;
      background: rgba(255,255,255,0.2);
    }
    .dcvh-close:hover { background: rgba(255,255,255,0.35); }
    .dcvh-body {
      padding: 12px 14px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .dcvh-status-card {
      background: #f4ecdd;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 12.5px;
    }
    .dcvh-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .dcvh-quick-tools {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .dcvh-tool-btn {
      background: #e8dbca;
      border: 1.5px solid #a38c72;
      border-radius: 8px;
      padding: 6px 4px;
      font: 700 11.5px "Mali", sans-serif;
      color: #3c3a38;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .dcvh-tool-btn:hover { background: #dfceb7; border-color: #6b5136; }
    .dcvh-tool-btn.highlight {
      background: #fcefdc;
      border-color: #d9822b;
      color: #9a3b28;
    }
    .dcvh-speed-group {
      display: flex;
      gap: 6px;
      margin-top: 3px;
    }
    .dcvh-speed-btn {
      flex: 1;
      background: #eedec7;
      border: 1.5px solid #8a7a66;
      border-radius: 8px;
      padding: 4px 0;
      font: 700 12px "Mali", sans-serif;
      color: #3c3a38;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .dcvh-speed-btn:hover { background: #e0ceb4; }
    .dcvh-speed-btn.active {
      background: #9a3b28;
      color: #fff;
      border-color: #9a3b28;
    }
    .dcvh-section-title {
      font-size: 12px;
      font-weight: 700;
      color: #6b5136;
      margin-bottom: 2px;
    }
    .dcvh-btn-row {
      display: flex;
      gap: 8px;
    }
    .dcvh-start-btn {
      flex: 2;
      background: #4e8b46;
      color: #fff;
      border: 0;
      border-radius: 12px;
      padding: 10px;
      font: 700 14px "Mali", sans-serif;
      cursor: pointer;
      box-shadow: 0 3px 0 #34602f;
      transition: all 0.15s ease;
      text-align: center;
    }
    .dcvh-start-btn:hover { background: #5ba352; }
    .dcvh-start-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 #34602f; }
    .dcvh-start-btn:disabled { background: #a8a8a8; box-shadow: none; cursor: not-allowed; }
    
    .dcvh-stop-btn {
      flex: 1;
      background: #d9544d;
      color: #fff;
      border: 0;
      border-radius: 12px;
      padding: 10px;
      font: 700 14px "Mali", sans-serif;
      cursor: pointer;
      box-shadow: 0 3px 0 #9e3832;
      transition: all 0.15s ease;
      text-align: center;
    }
    .dcvh-stop-btn:hover { background: #e36862; }
    .dcvh-stop-btn:active { transform: translateY(2px); box-shadow: 0 1px 0 #9e3832; }
    .dcvh-stop-btn:disabled { background: #c5b8a5; box-shadow: none; cursor: not-allowed; opacity: 0.6; }

    .dcvh-log {
      max-height: 160px;
      overflow-y: auto;
      background: #2b211b;
      color: #e6dfd5;
      border-radius: 8px;
      padding: 8px;
      font: 11px/1.4 monospace;
      white-space: pre-wrap;
    }
  `;
  document.head.appendChild(styleEl);

  const btnEl = document.createElement('div');
  btnEl.id = 'dcvh-auto-btn';
  btnEl.innerHTML = `<span>☕</span><span>Auto Đế Chế</span>`;
  document.body.appendChild(btnEl);

  const modalEl = document.createElement('div');
  modalEl.id = 'dcvh-modal';
  modalEl.innerHTML = `
    <div class="dcvh-header">
      <span>☕ Siêu Tool Đế Chế Vỉa Hè</span>
      <span class="dcvh-close" title="Đóng">✕</span>
    </div>
    <div class="dcvh-body">
      <div class="dcvh-status-card">
        <div class="dcvh-row">
          <span>Kết nối Game:</span>
          <b id="dcvh-status-text" style="color: #d9544d">Chờ mở Sổ tay...</b>
        </div>
        <div class="dcvh-row" style="margin-top: 4px;">
          <span>Tiền mặt hiện tại:</span>
          <b id="dcvh-cash-text" style="color: #4e8b46">0k</b>
        </div>
      </div>

      <!-- Công cụ Tiện ích Nhanh -->
      <div>
        <div class="dcvh-section-title">🛠️ Tiện ích Hỗ trợ 1-Click:</div>
        <div class="dcvh-quick-tools">
          <button id="dcvh-btn-gift" class="dcvh-tool-btn highlight" title="Nhận 5 mã giftcode: 21 triệu vốn">🎁 Nhận 21M Giftcode</button>
          <button id="dcvh-btn-inspect" class="dcvh-tool-btn" title="Soi chi tiết tiến độ các căn">📊 Soi Mặt Bằng</button>
          <button id="dcvh-btn-export" class="dcvh-tool-btn" title="Lưu bản sao save game về máy">💾 Sao Lưu Save</button>
          <button id="dcvh-btn-import" class="dcvh-tool-btn" title="Nạp lại file save game">📥 Nạp Lại Save</button>
        </div>
        <input type="file" id="dcvh-file-input" style="display: none;" accept=".json" />
      </div>

      <!-- Tốc độ Game (Tua nhanh) -->
      <div>
        <div class="dcvh-section-title">⚡ Tốc độ Game (Tua nhanh thời gian):</div>
        <div class="dcvh-speed-group">
          <button class="dcvh-speed-btn active" data-speed="1">1x Chuẩn</button>
          <button class="dcvh-speed-btn" data-speed="2">2x Nhanh</button>
          <button class="dcvh-speed-btn" data-speed="3">3x Nhanh</button>
          <button class="dcvh-speed-btn" data-speed="5">5x Siêu tốc</button>
        </div>
      </div>

      <!-- Phạm vi đối tượng -->
      <div>
        <div class="dcvh-section-title">🎯 Phạm vi đối tượng:</div>
        <div style="display: flex; gap: 14px; font-size: 12px;">
          <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
            <input type="radio" name="dcvh-scope" id="dcvh-scope-deals" value="deals" />
            <span>Chỉ Mặt Bằng</span>
          </label>
          <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
            <input type="radio" name="dcvh-scope" id="dcvh-scope-all" value="all" checked />
            <b>Toàn bộ cư dân trong xóm</b>
          </label>
        </div>
      </div>

      <!-- Hành động cần làm -->
      <div>
        <div class="dcvh-section-title">📋 Hành động thực hiện:</div>
        <div style="font-size: 12px; color: #5a4a37; display: flex; flex-direction: column; gap: 4px;">
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="dcvh-act-treat" checked />
            <b>☕ Mời nước (15k/người - Tăng sao)</b>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="dcvh-act-family" checked />
            <span>🏡 Hỏi nhà (0k - Mở khóa toàn bộ gia phả)</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="dcvh-act-invite" checked />
            <span>👋 Mời ghé (0k - Rủ ghé quầy mua hàng)</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="dcvh-act-leads" checked />
            <span>🔗 Tự động tìm & chăm sóc Người Dẫn Mối</span>
          </label>
        </div>
      </div>

      <!-- Hàng nút Bắt đầu & Dừng lại -->
      <div class="dcvh-btn-row">
        <button id="dcvh-run-btn" class="dcvh-start-btn">🚀 Bắt Đầu Thực Hiện</button>
        <button id="dcvh-stop-btn" class="dcvh-stop-btn" disabled>🛑 Dừng</button>
      </div>

      <div class="dcvh-section-title" style="margin-top: 2px;">Nhật ký hành động:</div>
      <div id="dcvh-log-box" class="dcvh-log">Sẵn sàng! Bấm nút để bắt đầu.</div>
    </div>
  `;
  document.body.appendChild(modalEl);

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

  btnEl.onclick = () => {
    const isShowing = modalEl.style.display === 'flex';
    modalEl.style.display = isShowing ? 'none' : 'flex';
    if (!isShowing) updateWidgetStatus();
  };

  modalEl.querySelector('.dcvh-close').onclick = () => {
    modalEl.style.display = 'none';
  };

  function appendLog(msg) {
    const logBox = document.getElementById('dcvh-log-box');
    if (logBox) {
      logBox.textContent += '\n' + msg;
      logBox.scrollTop = logBox.scrollHeight;
    }
  }

  function clearLog() {
    const logBox = document.getElementById('dcvh-log-box');
    if (logBox) logBox.textContent = '';
  }

  function updateWidgetStatus() {
    const sim = extractSimFromDom();
    const statusText = document.getElementById('dcvh-status-text');
    const cashText = document.getElementById('dcvh-cash-text');

    if (sim) {
      if (statusText) {
        statusText.textContent = '✅ Đã kết nối';
        statusText.style.color = '#4e8b46';
      }
      if (cashText) {
        const coins = getPlayerCoins(sim);
        cashText.textContent = `${Math.floor(coins).toLocaleString('vi-VN')}k`;
      }
    } else {
      if (statusText) {
        statusText.textContent = '⚠️ Hãy mở Sổ tay 1 lần';
        statusText.style.color = '#d9822b';
      }
    }
  }

  // Tiện ích 1: Nhận Giftcode
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

  // Tiện ích 2: Soi tiến độ Mặt Bằng
  document.getElementById('dcvh-btn-inspect').onclick = () => {
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

  // Tiện ích 3: Sao lưu Save Game
  document.getElementById('dcvh-btn-export').onclick = () => {
    const sim = extractSimFromDom();
    const saveKey = 'de-che-via-he/save/v3';
    const data = localStorage.getItem(saveKey);
    if (!data) {
      appendLog('⚠️ Không tìm thấy file lưu trên máy!');
      return;
    }
    const day = sim?.day || 'backup';
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DeCheViaHe_Ngay_${day}.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog(`💾 Đã xuất và tải file sao lưu save game (Ngày ${day}) về máy!`);
  };

  // Tiện ích 4: Nạp lại Save Game
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
        JSON.parse(text); // validate
        localStorage.setItem('de-che-via-he/save/v3', text);
        appendLog('📥 Đã khôi phục file save thành công! Đang tải lại game...');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        appendLog(`❌ File save không đúng định dạng: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Nút Dừng lại (Stop)
  document.getElementById('dcvh-stop-btn').onclick = () => {
    if (isRunning) {
      shouldStop = true;
      const stopBtn = document.getElementById('dcvh-stop-btn');
      stopBtn.disabled = true;
      stopBtn.textContent = '⏳ Đang dừng...';
      appendLog('⚠️ Đang ngắt tiến trình, vui lòng đợi xong người hiện tại...');
    }
  };

  // Thực thi tự động
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

    const isScopeAll = document.getElementById('dcvh-scope-all').checked;
    const doTreat = document.getElementById('dcvh-act-treat').checked;
    const doFamily = document.getElementById('dcvh-act-family').checked;
    const doInvite = document.getElementById('dcvh-act-invite').checked;
    const autoLeads = document.getElementById('dcvh-act-leads').checked;

    appendLog(isScopeAll ? '🔍 Đang quét toàn bộ cư dân trong xóm...' : '🔍 Đang quét nhân vật cần cho Mặt Bằng...');

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
      appendLog('\n--- 🏡 Giai đoạn 1: Hỏi nhà toàn bộ ---');
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
              await new Promise(r => setTimeout(r, 150));
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
          const currentCoins = getPlayerCoins(sim);
          if (currentCoins < 15) {
            appendLog(`❌ Hết tiền! Còn ${Math.floor(currentCoins)}k. Dừng lại.`);
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
            await new Promise(r => setTimeout(r, 250));
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

        // Mời ghé
        if (doInvite && !contacted.includes('invite')) {
          try {
            const invRes = sim.contact('invite', item.rid);
            if (typeof invRes === 'string' && invRes.includes('Đã nhắn')) {
              appendLog(`👋 [Mời ghé] ${invRes}`);
              inviteGheCount++;
            }
          } catch (e) {}
        }

        // Mời nước
        if (doTreat) {
          if (contacted.includes('treat')) continue;

          if (!isScopeAll && item.isBlocked) {
            appendLog(`🔒 [Đang kẹt] ${item.name}: Bị chặn dẫn mối, tạm hoãn mời nước.`);
            continue;
          }

          const currentCoins = getPlayerCoins(sim);
          if (currentCoins < 15) {
            appendLog(`❌ Hết tiền mặt! Còn ${Math.floor(currentCoins)}k (cần 15k). Đã dừng.`);
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
            await new Promise(r => setTimeout(r, 250));
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
    appendLog(` • Đã mời nước: ${invitedCount} người (Tổng chi: ${spentCash}k).`);
    appendLog(` • Đã hỏi nhà: ${familyCount} người.`);
    appendLog(` • Đã mời ghé quầy: ${inviteGheCount} người.`);

    updateWidgetStatus();
    isRunning = false;
    shouldStop = false;
    runBtn.disabled = false;
    runBtn.textContent = '🚀 Bắt Đầu Thực Hiện';
    stopBtn.disabled = true;
    stopBtn.textContent = '🛑 Dừng';
  }

  document.getElementById('dcvh-run-btn').onclick = executeAutoActions;
})();
