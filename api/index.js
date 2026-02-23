// Import dependencies
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { SUPERVISOR_PROMPT, buildAgentPrompt, buildSynthesizerPrompt, ACTIONS, buildFeatureListText, buildHelpText, AI_CHAT_GREETING } = require('../prompts');

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

  // --- Handle Postback Events (Rich Menu) ---
  if (event.type === 'postback') {
    return handlePostback(event);
  }

  if (event.type !== 'message' || event.message.type !== 'text') {
    // Ignore non-text messages
    return Promise.resolve(null);
  }

  try {
    const userMessage = event.message.text;

    // --- Step 1: Supervisor Analysis ---
    const supervisorResult = await model.generateContent(`${SUPERVISOR_PROMPT}\n\n用戶訊息：${userMessage}`);
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
      const agentPrompt = buildAgentPrompt(task.role, task.instruction, userMessage);
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
    const finalResult = await model.generateContent(buildSynthesizerPrompt(userMessage, agentResultsCombined));
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

// --- Postback Handler (Rich Menu actions) ---
async function handlePostback(event) {
  const data = event.postback.data;

  try {
    switch (data) {
      case ACTIONS.FEATURES:
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: buildFeatureListText(),
        });

      case ACTIONS.HELP:
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: buildHelpText(),
        });

      case ACTIONS.AI_CHAT:
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: AI_CHAT_GREETING,
        });

      default:
        console.warn('Unknown postback action:', data);
        return lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: '⚠️ 未知的操作，請使用底部選單的功能按鈕。',
        });
    }
  } catch (err) {
    console.error('Error handling postback:', err);
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: '對不起，處理操作時遇到錯誤，請稍後再試。',
    });
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.send('LINE Bot is running!');
});

// Export the app for Vercel
module.exports = app;
