# Smart Event Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng Smart Event Engine cho script Tampermonkey `decheviahe_auto_invite.user.js` nhằm tự động nhận diện và lựa chọn tối ưu các sự kiện ngẫu nhiên trong game (như xin ghi sổ nợ, kiểm tra đô thị, tình huống thường ngày) dựa trên phân tích tag và quản lý rủi ro vốn.

**Architecture:** Mở rộng module Auto Event trong Userscript với:
1. Hàm nhận diện modal linh hoạt `isRealEventModal` (hỗ trợ các modal có nhiều nút "Chọn" và loại trừ triệt để modal hệ thống).
2. Bộ chấm điểm phương án `scoreEventOption` và bộ điều phối `evaluateAndChooseEventOption` dựa trên trọng số tác động (quan hệ, uy tín, thu nhập, rủi ro) và ngưỡng vốn an toàn `minCashReserve`.
3. Giao diện tùy chỉnh chiến lược (Thông minh, An toàn, Chọn 1, Thủ công) trong Tab Tự động của Tool.
4. Bộ unit test độc lập bằng Node.js để kiểm thử tự động thuật toán chấm điểm trước khi tích hợp.

**Tech Stack:** JavaScript (ES6+ Userscript), Node.js (cho test runner độc lập)

## Global Constraints
- Target file: `decheviahe_auto_invite.user.js`
- Giữ nguyên toàn bộ comment và các tính năng hiện có (Mời nước, Đổi mặt bằng, Giftcode, Tua tốc độ).
- Phiên bản script nâng lên `3.2.0`.
- Không phụ thuộc vào thư viện ngoài runtime; thuần DOM & Vanilla JS.

---

### Task 1: Bộ Kiểm Thử Thuật Toán Chấm Điểm & Phân Tích Tag (Unit Tests)

**Files:**
- Create: `tests/test-smart-event.js`

**Interfaces:**
- Produces: `scoreEventOption(optionData, currentCash, minCashReserve, strategy)`

- [ ] **Step 1: Viết test case độc lập kiểm tra thuật toán phân tích điểm**

Viết file `tests/test-smart-event.js` kiểm tra các kịch bản:
- Kịch bản 1: Đủ vốn cho ghi sổ ("Anh Trung xin ghi sổ", có `thân +`, chi 450k, tiền mặt 77k, vốn tối thiểu 20k) -> Phương án 1 điểm cao hơn Phương án 2.
- Kịch bản 2: Thiếu vốn cho ghi sổ (chi 450k, nhưng tiền mặt chỉ có 460k, vốn tối thiểu 20k -> còn 10k < 20k) -> Bị phạt -500 điểm, tự động chọn Phương án 2 ("Không bán chịu").
- Kịch bản 3: Chiến lược `safe` -> Ưu tiên phương án không mất tiền / không rủi ro.
- Kịch bản 4: Chiến lược `first` -> Luôn chọn phương án đầu tiên.

```javascript
// tests/test-smart-event.js
const assert = require('assert');

// Hàm chấm điểm cần kiểm thử
function scoreEventOption(option, currentCash, minCashReserve, strategy = 'smart') {
  if (strategy === 'first') return option.index === 0 ? 9999 : 0;

  let score = 0;
  const tagsText = (option.tags || []).join(' ').toLowerCase();
  const titleText = (option.title || '').toLowerCase();
  const allText = titleText + ' ' + tagsText;

  // 1. Kiểm tra an toàn vốn
  const costMatch = allText.match(/(?:đưa|chi|phạt|mất|tốn)\s*(\d+(?:\.\d+)?)\s*k?/i);
  let cost = 0;
  if (costMatch) {
    cost = parseFloat(costMatch[1]);
  }

  const remainingCash = currentCash - cost;
  const isAffordable = remainingCash >= minCashReserve;

  if (cost > 0 && !isAffordable) {
    score -= 500; // Phạt nặng nếu làm hụt vốn an toàn
  }

  if (strategy === 'safe') {
    if (cost > 0) score -= 200;
    if (allText.includes('có khi mất') || allText.includes('nguy cơ') || allText.includes('rủi ro')) score -= 100;
    if (allText.includes('không') || allText.includes('từ chối')) score += 50;
    return score;
  }

  // Strategy 'smart'
  // Thân thiết / Quan hệ
  if (allText.includes('thân +') || allText.includes('kết thân') || allText.includes('thân thiết')) score += 50;
  if (allText.includes('mất lòng') || allText.includes('khách quen xa') || allText.includes('thân -')) score -= 40;

  // Uy tín / Danh tiếng
  if (allText.includes('danh tiếng +') || allText.includes('uy tín +')) score += 40;
  if (allText.includes('danh tiếng -') || allText.includes('mất uy tín')) score -= 35;

  // Thu nhập / Khách
  if (allText.includes('tăng khách') || allText.includes('khách +') || allText.includes('lời')) score += 30;

  // Rủi ro
  if (allText.includes('có khi mất') || allText.includes('rủi ro')) score -= 15;

  // Tag chung
  if (allText.includes('+')) score += 20;
  if (allText.includes('-')) score -= 20;

  return score;
}

// Chạy các bài test
console.log('🧪 Đang chạy Unit Tests cho Smart Event Scoring...');

// Test 1: Đủ vốn cho ghi sổ
const optChoGhiSo = { index: 0, title: 'Cho ghi sổ', tags: ['đưa 450k', 'hẹn 3 ngày', 'có khi mất', 'thân +'] };
const optKhongCho = { index: 1, title: 'Không bán chịu', tags: ['mất lòng', 'khách quen xa'] };

const score1_rich = scoreEventOption(optChoGhiSo, 77000, 20, 'smart');
const score2_rich = scoreEventOption(optKhongCho, 77000, 20, 'smart');
assert(score1_rich > score2_rich, `Khi đủ tiền, Cho ghi sổ (${score1_rich}) phải lớn hơn Không bán chịu (${score2_rich})`);
console.log('✅ Test 1 (Đủ tiền chọn Thân thiết) PASS!');

// Test 2: Thiếu vốn
const score1_poor = scoreEventOption(optChoGhiSo, 460, 20, 'smart'); // 460 - 450 = 10 < 20
const score2_poor = scoreEventOption(optKhongCho, 460, 20, 'smart');
assert(score1_poor < score2_poor, `Khi thiếu tiền, Cho ghi sổ (${score1_poor}) phải bị phạt thấp hơn Không bán chịu (${score2_poor})`);
console.log('✅ Test 2 (Thiếu tiền tự né rủi ro) PASS!');

// Test 3: Chiến lược Safe
const scoreSafe1 = scoreEventOption(optChoGhiSo, 77000, 20, 'safe');
const scoreSafe2 = scoreEventOption(optKhongCho, 77000, 20, 'safe');
assert(scoreSafe2 > scoreSafe1, 'Chiến lược safe phải chọn Không bán chịu');
console.log('✅ Test 3 (Chiến lược Safe) PASS!');

// Test 4: Chiến lược First
assert.strictEqual(scoreEventOption(optChoGhiSo, 100, 20, 'first'), 9999);
assert.strictEqual(scoreEventOption(optKhongCho, 100, 20, 'first'), 0);
console.log('✅ Test 4 (Chiến lược First) PASS!');

console.log('🎉 TOÀN BỘ 4 UNIT TESTS ĐÃ PASS THÀNH CÔNG!');
```

- [ ] **Step 2: Chạy unit test để xác nhận logic hoạt động chính xác**

Chạy lệnh: `node tests/test-smart-event.js`
Kỳ vọng: Output có `🎉 TOÀN BỘ 4 UNIT TESTS ĐÃ PASS THÀNH CÔNG!` và exit code 0.

- [ ] **Step 3: Commit unit test**

```bash
git add tests/test-smart-event.js
git commit -m "test: add smart event engine logic tests"
```

---

### Task 2: Cập Nhật Cấu Hình & Giao Diện Tool (Settings & Config)

**Files:**
- Modify: `decheviahe_auto_invite.user.js:23-50` (thêm `eventChoiceStrategy: 'smart'`)
- Modify: `decheviahe_auto_invite.user.js:460-520` (thêm phần tử UI cấu hình)
- Modify: `decheviahe_auto_invite.user.js:920-950` (event listener cho select/radio chiến lược)

**Interfaces:**
- Consumes: `userConfig.eventChoiceStrategy`
- Produces: UI control `#dcvh-event-strategy` và cập nhật localStorage

- [ ] **Step 1: Cập nhật `defaultConfig` và metadata script**
Nâng version lên `3.2.0`, thêm `eventChoiceStrategy: 'smart'` vào `defaultConfig`.

- [ ] **Step 2: Thêm giao diện chọn Chiến Lược vào Tab Tự Động**
Thêm hàng điều khiển dưới mục "Tự động xử lý sự kiện & bong bóng":
```html
<div class="dcvh-row" style="margin-top: 4px;">
  <span style="font-size: 11.5px; color: #5a4b3c;">Chiến lược sự kiện:</span>
  <select id="dcvh-event-strategy" class="dcvh-input" style="width: 140px; padding: 3px 5px; font-size: 11px;">
    <option value="smart">🧠 Thông minh (Ưu tiên Quan hệ)</option>
    <option value="safe">🛡️ An toàn (Tránh mất tiền)</option>
    <option value="first">⏩ Luôn chọn phương án 1</option>
    <option value="manual">✋ Bỏ qua (Tự bấm tay)</option>
  </select>
</div>
```

- [ ] **Step 3: Gắn event listener cập nhật `userConfig.eventChoiceStrategy`**
Khi người dùng đổi select, lưu vào `userConfig` và gọi `saveUserConfig()`.

- [ ] **Step 4: Commit thay đổi UI & Config**
```bash
git add decheviahe_auto_invite.user.js
git commit -m "feat: add eventChoiceStrategy config and UI controls"
```

---

### Task 3: Tích Hợp Smart Scoring Engine & Nhận Diện Modal

**Files:**
- Modify: `decheviahe_auto_invite.user.js:970-1145`

**Interfaces:**
- Consumes: `isRealEventModal(modal)`, `getPlayerCoins(sim)`, `userConfig`
- Produces: `evaluateAndChooseEventOption(modal, sim)`, cập nhật `processAutoEvents()`

- [ ] **Step 1: Cải tiến `isRealEventModal`**
Mở rộng phát hiện:
- Nhận diện các modal chứa từ khóa: `ghi sổ`, `bán chịu`, `nợ`, `khách quen`, `đô thị`, `kiểm tra`, `thời tiết`.
- Hoặc modal có từ 2 thẻ lựa chọn trở lên chứa nút có text `"Chọn"`.
- Đảm bảo danh sách đen loại trừ: Sổ tay dân cư (`#journal-root`), Sân ga (`#books-root`), Chợ, Cửa hàng, Nhân viên, Mặt bằng.

- [ ] **Step 2: Tích hợp hàm `evaluateAndChooseEventOption`**
Quét các lựa chọn (options container / card):
- Lấy tiêu đề và danh sách nhãn (`badge`, `tag`, `span`).
- Gọi logic chấm điểm tương thích với Unit Test ở Task 1.
- Nếu `strategy === 'manual'`, bỏ qua không bấm để người chơi tự chọn.
- Nếu tìm thấy phương án điểm cao nhất:
  - Bấm nút "Chọn" của phương án đó.
  - Ghi log trực quan vào box log của tool.

- [ ] **Step 3: Hỗ trợ nút "Chọn" cho sự kiện 1 nút nếu có**
Thêm `'chọn'` vào danh sách `validActionKeywords` khi modal chỉ có 1 nút duy nhất.

- [ ] **Step 4: Chạy kiểm thử cú pháp file JS**
Chạy: `node -c decheviahe_auto_invite.user.js`
Kỳ vọng: Không có lỗi cú pháp JS (exit code 0).

- [ ] **Step 5: Commit tích hợp Smart Event Engine**
```bash
git add decheviahe_auto_invite.user.js
git commit -m "feat: implement smart event detection and decision engine"
```

---

### Task 4: Kiểm Thử Toàn Diện & Tinh Chỉnh Cuối Cùng

**Files:**
- Test: `tests/test-smart-event.js`
- Test: Syntax check `decheviahe_auto_invite.user.js`

- [ ] **Step 1: Chạy lại toàn bộ test suite**
Chạy `node tests/test-smart-event.js`
Chạy `node -c decheviahe_auto_invite.user.js`

- [ ] **Step 2: Đảm bảo git status sạch và sẵn sàng**
Commit các điều chỉnh nếu có.
