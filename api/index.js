// Import dependencies
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Check for required environment variables
if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_CHANNEL_SECRET || !process.env.GEMINI_API_KEY) {
  console.error('Missing required environment variables. Please check your .env file or Vercel environment settings.');
  process.exit(1);
}

// LINE Bot configuration
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// Initialize clients
const app = express();
const lineClient = new line.Client(lineConfig);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Middleware to parse JSON (Removed because line.middleware handles body parsing)
// app.use(express.json());

// Webhook endpoint
app.post('/api/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    // Process all events
    const results = await Promise.all(events.map(handleEvent));
    res.json(results);
  } catch (err) {
    console.error('Webhook processing error:', err);
    // 回傳 200 OK 避免 LINE 判定為伺服器錯誤 (500)
    res.status(200).end();
  }
});

// 加入統一的錯誤處理機制，避免 line.middleware 拋出異常導致 500
app.use((err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) {
    console.error('LINE Signature Validation Failed');
    res.status(401).send(err.signature);
    return;
  } else if (err instanceof line.JSONParseError) {
    console.error('LINE JSON Parse Error');
    res.status(400).send(err.raw);
    return;
  }

  // 記錄其他錯誤，但為了通過 LINE 的假驗證，我們回傳 200 (或依情況回傳)
  console.error('Unhandled Server Error:', err);
  res.status(200).end();
});

async function handleEvent(event) {
  // Ignore LINE verification dummy tokens
  if (event.replyToken === '00000000000000000000000000000000' || event.replyToken === 'ffffffffffffffffffffffffffffffff') {
    return Promise.resolve(null);
  }

  if (event.type !== 'message' || event.message.type !== 'text') {
    // Ignore non-text messages
    return Promise.resolve(null);
  }

  try {
    const userMessage = event.message.text;

    // --- Step 1: Supervisor Analysis ---
    const supervisorPrompt = `你是一個統管 AI Agent 的 Supervisor。請分析使用者的要求，並將其拆解為多個獨立的子任務。判斷每個子任務需要哪種專業角色的 AI (例如: 翻譯員、程式設計師、搜尋專家)。
請嚴格輸出 JSON 陣列，格式為: [{"role": "角色名稱", "instruction": "具體指令"}]。如果判定使用者的要求非常簡單，只需要單一對話即可完成，請輸出空陣列 []。
不要輸出其他任何 Markdown 或文字解釋，只能輸出純 JSON。`;

    const supervisorResult = await model.generateContent(`${supervisorPrompt}\n\n用戶訊息：${userMessage}`);
    const supervisorResponseText = supervisorResult.response.text();

    let tasks = [];
    try {
      // 嘗試清理可能的 Markdown 標籤 (例如 ```json ... ```)
      const cleanJsonStr = supervisorResponseText.replace(/```json\n?|```/gi, '').trim();
      tasks = JSON.parse(cleanJsonStr);
    } catch (parseError) {
      console.warn("Supervisor JSON parsing failed. Falling back to simple response.", parseError, "Response was:", supervisorResponseText);
      // Fallback: 如果無法解析，退回空陣列
      tasks = [];
    }

    // 如果沒有子任務 (或是解析失敗)，則使用傳統單一模式
    if (!Array.isArray(tasks) || tasks.length === 0) {
      console.log("Using simple fallback response mode.");
      const result = await model.generateContent(userMessage);
      const text = result.response.text();
      return lineClient.replyMessage(event.replyToken, { type: 'text', text: text });
    }

    // --- Step 2: Sub-agent Execution ---
    console.log(`Supervisor assigned ${tasks.length} tasks:`, tasks);
    const agentPromises = tasks.map(async (task, index) => {
      const agentPrompt = `你現在是 ${task.role}。請根據以下指令執行任務，並直接給出結果：\n${task.instruction}\n\n這是一開始使用者的原始訊息作為參考：${userMessage}`;
      try {
        const agentResult = await model.generateContent(agentPrompt);
        return `【${task.role} 的回報】:\n${agentResult.response.text()}`;
      } catch (err) {
        console.error(`Sub-agent ${task.role} failed:`, err);
        return `【${task.role} 的回報】: (執行失敗)`;
      }
    });

    const agentResultsArray = await Promise.all(agentPromises);
    const agentResultsCombined = agentResultsArray.join('\n\n');

    // --- Step 3: Synthesis ---
    const synthesizerPrompt = `你是一個負責統整最終報告的 Synthesizer AI。
這是一開始使用者的要求：\n"${userMessage}"

以下是各個專業 AI Agent 完成的結果：
${agentResultsCombined}

請將這些結果綜整成一個連貫、自然且易讀的最終回覆給使用者。請直接給出回覆內容，不需提及你是由哪些 Agent 統整出來的。`;

    const finalResult = await model.generateContent(synthesizerPrompt);
    const finalText = finalResult.response.text();

    // 回覆給使用者
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: finalText,
    });

  } catch (err) {
    console.error('Error handling event:', err);
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '對不起，我在處理任務時遇到了一點系統錯誤，請稍後再試。',
    });
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.send('LINE Bot is running!');
});

// Export the app for Vercel
module.exports = app;
