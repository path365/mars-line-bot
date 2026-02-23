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

// ===== 簡易 Rich Menu 圖片產生 (純 PNG, 無外部依賴) =====

/**
 * 產生一個簡易 PNG 圖片 (2500x843)
 * 使用最小化 PNG 格式 — 三個色塊區域
 * 注意：這是一個簡易佔位圖，建議之後替換為設計過的圖片
 */
function generateSimpleRichMenuImage() {
  const width = 2500;
  const height = 843;

  // 三個區域的顏色 (RGB)
  const colors = [
    [41, 128, 185],   // 藍色 — AI 智能問答
    [39, 174, 96],    // 綠色 — 功能列表
    [142, 68, 173],   // 紫色 — 使用說明
  ];

  const colWidth = Math.floor(width / 3);

  // 建立原始像素資料 (RGBA)
  const rawData = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colIndex = Math.min(Math.floor(x / colWidth), 2);
      const [r, g, b] = colors[colIndex];
      const offset = (y * width + x) * 4;
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
      rawData[offset + 3] = 255; // alpha
    }
  }

  // 建立未壓縮的 PNG
  return createUncompressedPNG(width, height, rawData);
}

/**
 * 建立最小化未壓縮 PNG (使用 zlib deflate)
 */
function createUncompressedPNG(width, height, rawRGBA) {
  const zlib = require('zlib');

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createPNGChunk('IHDR', ihdrData);

  // IDAT chunk — filter each row with filter type 0 (None)
  const filteredRows = [];
  for (let y = 0; y < height; y++) {
    filteredRows.push(Buffer.from([0])); // filter type: None
    const rowStart = y * width * 4;
    filteredRows.push(rawRGBA.subarray(rowStart, rowStart + width * 4));
  }
  const rawImageData = Buffer.concat(filteredRows);
  const compressed = zlib.deflateSync(rawImageData, { level: 1 });
  const idat = createPNGChunk('IDAT', compressed);

  // IEND chunk
  const iend = createPNGChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createPNGChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc32 = crc32Calc(Buffer.concat([typeBuffer, data]));
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32 >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// Simple CRC32 implementation for PNG chunks
function crc32Calc(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
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
  const imageBuffer = generateSimpleRichMenuImage();
  await uploadRichMenuImage(richMenuId, imageBuffer);
  console.log('   ✅ 圖片上傳成功 (2500x843, 三色佔位圖)');
  console.log('   💡 提示：可替換為設計過的圖片，放在 assets/rich-menu.png');

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
