// ==UserScript==
// @name         Đế Chế Vỉa Hè - Siêu Tool Auto & Tiện Ích
// @namespace    https://decheviahe.com/
// @version      2.2.2
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
  // Lấy số tiền hiện có từ sim (trong game biến tiền là sim.coins, fallback đọc từ save)
  function getPlayerCoins(sim) {
    if (sim) {
      if (typeof sim.coins === 'number') return sim.coins;
      if (typeof sim.st?.coins === 'number') return sim.st.coins;
      if (typeof sim.cash === 'number') return sim.cash;
      if (typeof sim.st?.cash === 'number') return sim.st.cash;
    }
    try {
      const raw = localStorage.getItem('de-che-via-he/save/v3');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.coins === 'number') return parsed.coins;
      }
    } catch (e) {}
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
