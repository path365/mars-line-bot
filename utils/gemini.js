/**
 * Gemini 呼叫工具
 *
 * 提供帶「重試 + 降級」機制的 generateContent：
 * 1. 先以主要模型 (PRIMARY_MODEL) 嘗試，失敗且為暫時性錯誤 (429/500/503) 時自動重試。
 * 2. 主要模型重試用盡後，降級改用較舊的 FALLBACK_MODEL，再依相同規則重試。
 *
 * 注意：require 本模組前需先載入 dotenv（process.env.GEMINI_API_KEY 必須已存在）。
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 主要 / 降級模型
const PRIMARY_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash';

// 每個模型最多重試次數（不含首次嘗試）
const MAX_RETRIES = 2;
// 重試間隔基數（毫秒），實際間隔為 RETRY_DELAY_MS * 嘗試次數（線性退避）
const RETRY_DELAY_MS = 800;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const primaryModel = genAI.getGenerativeModel({ model: PRIMARY_MODEL });
const fallbackModel = genAI.getGenerativeModel({ model: FALLBACK_MODEL });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 判斷錯誤是否為「暫時性」、值得重試的錯誤。
 * 429: Too Many Requests / 500: Internal Error / 503: Service Unavailable
 */
function isRetryable(err) {
  const status = err && err.status;
  return status === 429 || status === 500 || status === 503;
}

/**
 * 帶重試與降級機制的 generateContent。
 * 介面與 model.generateContent 相同，回傳同樣的 result 物件。
 *
 * @param {string|object} prompt - 傳給 Gemini 的提示內容
 * @returns {Promise<object>} Gemini generateContent 的回傳結果
 * @throws 若所有模型與重試都失敗，拋出最後一次的錯誤
 */
async function generateContent(prompt) {
  const attempts = [
    { model: primaryModel, name: PRIMARY_MODEL },
    { model: fallbackModel, name: FALLBACK_MODEL },
  ];

  let lastErr;
  for (const { model, name } of attempts) {
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        return await model.generateContent(prompt);
      } catch (err) {
        lastErr = err;
        const willRetry = i < MAX_RETRIES && isRetryable(err);
        console.warn(
          `[Gemini] 模型 ${name} 第 ${i + 1} 次嘗試失敗 (status=${err && err.status})。` +
            (willRetry ? ' 即將重試…' : ' 切換下一個方案。')
        );
        if (willRetry) {
          await sleep(RETRY_DELAY_MS * (i + 1));
        } else {
          break; // 此模型放棄，換下一個（降級）模型
        }
      }
    }
    console.warn(`[Gemini] 模型 ${name} 已用盡重試，若有降級模型將改用之。`);
  }

  throw lastErr;
}

module.exports = {
  generateContent,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
};
