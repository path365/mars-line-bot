/**
 * Rich Menu Setup Script
 *
 * 建立 LINE Rich Menu、產生簡易圖片並上傳、設為所有使用者的預設選單。
 *
 * Usage:
 *   node scripts/setup-rich-menu.js
 *
 * 需要環境變數:
 *   LINE_CHANNEL_ACCESS_TOKEN
 *
 * 如果已有 Rich Menu，此腳本會先刪除所有現有 Rich Menu 再重建。
 */

require('dotenv').config();
const { ACTIONS } = require('../prompts');

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('Error: LINE_CHANNEL_ACCESS_TOKEN is missing in .env');
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

// Rich Menu 配置 — 2500 x 843 (compact), 3 等分區域
const RICH_MENU_BODY = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'mars-line-bot-menu',
  chatBarText: '📋 功能選單',
  areas: [
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'postback', data: ACTIONS.AI_CHAT, displayText: 'AI 智能問答' },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      action: { type: 'postback', data: ACTIONS.FEATURES, displayText: '功能列表' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: 'postback', data: ACTIONS.HELP, displayText: '使用說明' },
    },
  ],
};

// ===== LINE Messaging API Helpers =====

async function apiCall(url, options = {}) {
  const res = await fetch(url, { headers: HEADERS, ...options });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  // Some endpoints return empty body (e.g. delete)
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function listRichMenus() {
  const data = await apiCall('https://api.line.me/v2/bot/richmenu/list');
  return data?.richmenus || [];
}

async function deleteRichMenu(richMenuId) {
  await apiCall(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, { method: 'DELETE' });
}

async function createRichMenu(body) {
  return apiCall('https://api.line.me/v2/bot/richmenu', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function uploadRichMenuImage(richMenuId, imageBuffer) {
  const res = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'image/png',
      },
      body: imageBuffer,
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload image ${res.status}: ${body}`);
  }
}

async function setDefaultRichMenu(richMenuId) {
  await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

// ===== Rich Menu 圖片產生 (使用 sharp + SVG) =====

/**
 * 產生 Rich Menu PNG 圖片 (2500x843)
 * 三個色塊區域 + 白色文字標籤 + emoji 圖示
 */
async function generateRichMenuImage() {
  const sharp = require('sharp');
  const width = 2500;
  const height = 843;
  const colWidth = Math.floor(width / 3);

  const sections = [
    { color: '#2980b9', icon: '🤖', label: 'AI 智能問答' },
    { color: '#27ae60', icon: '📋', label: '功能列表' },
    { color: '#8e44ad', icon: '❓', label: '使用說明' },
  ];

  const svgParts = sections.map((s, i) => {
    const x = i * colWidth;
    const centerX = x + colWidth / 2;
    const centerY = height / 2;
    return `
      <rect x="${x}" y="0" width="${colWidth + (i < 2 ? 1 : 0)}" height="${height}" fill="${s.color}"/>
      <text x="${centerX}" y="${centerY - 40}" text-anchor="middle" font-size="120" fill="white">${s.icon}</text>
      <text x="${centerX}" y="${centerY + 80}" text-anchor="middle" font-family="sans-serif" font-size="72" font-weight="bold" fill="white">${s.label}</text>
    `;
  });

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${svgParts.join('')}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ===== Main =====

async function main() {
  console.log('🔧 Rich Menu Setup Script\n');

  // Step 1: 刪除現有 Rich Menu
  console.log('1. 檢查並刪除現有 Rich Menu...');
  const existingMenus = await listRichMenus();
  if (existingMenus.length > 0) {
    for (const menu of existingMenus) {
      await deleteRichMenu(menu.richMenuId);
      console.log(`   ✅ 已刪除: ${menu.richMenuId} (${menu.name})`);
    }
  } else {
    console.log('   (無現有 Rich Menu)');
  }

  // Step 2: 建立新 Rich Menu
  console.log('\n2. 建立新 Rich Menu...');
  const result = await createRichMenu(RICH_MENU_BODY);
  const richMenuId = result.richMenuId;
  console.log(`   ✅ 建立成功: ${richMenuId}`);

  // Step 3: 產生並上傳圖片
  console.log('\n3. 產生並上傳 Rich Menu 圖片...');
  const imageBuffer = await generateRichMenuImage();
  await uploadRichMenuImage(richMenuId, imageBuffer);
  console.log('   ✅ 圖片上傳成功 (2500x843, 含文字標籤)');

  // Step 4: 設為預設 Rich Menu
  console.log('\n4. 設為所有使用者的預設 Rich Menu...');
  await setDefaultRichMenu(richMenuId);
  console.log('   ✅ 已設為預設');

  console.log('\n🎉 Rich Menu 設定完成！');
  console.log(`   Menu ID: ${richMenuId}`);
  console.log('   區域配置:');
  console.log('   ┌──────────────┬──────────────┬──────────────┐');
  console.log('   │ 🤖 AI 智能問答 │ 📋 功能列表   │ ❓ 使用說明   │');
  console.log('   └──────────────┴──────────────┴──────────────┘');
}

main().catch((err) => {
  console.error('❌ Rich Menu 設定失敗:', err.message);
  process.exit(1);
});
