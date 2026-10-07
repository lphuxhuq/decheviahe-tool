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
