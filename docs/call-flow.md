# 系統呼叫流程文件

> 本文件描述 mars-line-bot 從使用者發送訊息到收到回覆的完整流程，包含所有分支路徑與 Gemini API 呼叫次數。

## 總覽流程圖

```
使用者 (LINE App)
    │
    ▼
LINE Platform
    │  POST /api/webhook (附帶簽章)
    ▼
┌─────────────────────────────────────────┐
│ Vercel Serverless (api/index.js)        │
│                                         │
│  line.middleware() ← 驗證簽章 + 解析 body │
│         │                               │
│         ▼                               │
│    handleEvent(event)                   │
│         │                               │
│         ├─ 驗證 token? → 忽略 (null)      │
│         ├─ postback?  → handlePostback() │
│         ├─ 非文字?    → 忽略 (null)       │
│         └─ 文字訊息   → Multi-Agent 流程  │
│                                         │
└─────────────────────────────────────────┘
    │
    ▼
LINE Platform → 使用者 (LINE App)
```

## 事件分流

當 LINE 送來 webhook 事件後，`handleEvent` 依序檢查：

| 順序 | 條件 | 行為 | API 呼叫 |
|---:|---|---|---|
| 1 | `replyToken` 為 `000...0` 或 `fff...f` | 靜默忽略（LINE 驗證用） | 0 次 |
| 2 | `event.type === 'postback'` | 交由 `handlePostback()` 處理 | 0 次 |
| 3 | 非文字訊息 | 靜默忽略 | 0 次 |
| 4 | 文字訊息 | 進入 Multi-Agent 流程 | 見下方 |

## Postback 流程（Rich Menu 按鈕）

```
使用者點擊 Rich Menu 按鈕
    │
    ▼
handlePostback(event)
    │
    ├─ action=ai_chat   → 回覆 AI_CHAT_GREETING 文字
    ├─ action=features  → 回覆 buildFeatureListText()
    ├─ action=help      → 回覆 buildHelpText()
    └─ 未知 action      → 回覆 ⚠️ 錯誤提示
```

- **Gemini API 呼叫：0 次**（純靜態文字回覆，內容由 `prompts/index.js` 管理）

## Multi-Agent 流程（文字訊息）

### 情境 A：簡單問題 — Gemini API **1 次**

```
使用者: "今天天氣如何？"
    │
    ▼
Step 1: Supervisor 分析 ─── Gemini API 呼叫 #1
    │
    │  回傳: {"type": "simple", "answer": "直接回覆內容"}
    │
    ▼
lineClient.replyMessage() → 使用者收到回覆
```

**流程說明：**
1. 將 `SUPERVISOR_PROMPT` + 使用者訊息一起送給 Gemini
2. Supervisor 判定為簡單問題，**直接在 JSON 中附帶完整答案**
3. 解析 JSON 後取出 `answer` 欄位，直接回覆使用者
4. 不需要額外的 Gemini 呼叫

### 情境 B：複雜問題 — Gemini API **N + 2 次**

```
使用者: "幫我翻譯 Hello World 成日文，並寫一首關於蘋果的詩"
    │
    ▼
Step 1: Supervisor 分析 ─── Gemini API 呼叫 #1
    │
    │  回傳: {"type": "multi", "tasks": [
    │    {"role": "翻譯員", "instruction": "將 Hello World 翻成日文"},
    │    {"role": "詩人",   "instruction": "寫一首關於蘋果的短詩"}
    │  ]}
    │
    ▼
Step 2: Sub-agent 並行執行 (Promise.all)
    │
    ├─ 翻譯員 ─── Gemini API 呼叫 #2  ──┐
    │                                    │ 並行
    ├─ 詩人   ─── Gemini API 呼叫 #3  ──┘
    │
    │  合併結果:
    │  【翻譯員的回報】: ハローワールド
    │  【詩人的回報】: 紅潤如朝霞...
    │
    ▼
Step 3: Synthesizer 統整 ─── Gemini API 呼叫 #4
    │
    │  將所有 Sub-agent 結果綜合為一個連貫回覆
    │
    ▼
lineClient.replyMessage() → 使用者收到回覆
```

**流程說明：**
1. **Supervisor (1 次)**：分析使用者需求，拆解成 N 個子任務
2. **Sub-agents (N 次)**：每個子任務各呼叫一次 Gemini，使用 `buildAgentPrompt()` 產生角色專屬 prompt，所有 Sub-agent **並行執行**
3. **Synthesizer (1 次)**：使用 `buildSynthesizerPrompt()` 將所有結果統整為自然連貫的最終回覆

### 情境 C：JSON 解析失敗 — Gemini API **1 次**

```
使用者: (任意輸入)
    │
    ▼
Step 1: Supervisor 分析 ─── Gemini API 呼叫 #1
    │
    │  回傳無法解析的 JSON（格式錯誤）
    │
    ▼
直接將 Supervisor 原始回應文字回覆給使用者
```

## Gemini API 呼叫次數總結

| 情境 | Gemini API 呼叫次數 | 說明 |
|---|:---:|---|
| Postback (Rich Menu) | **0** | 純靜態文字，無需 AI |
| 簡單問題 | **1** | Supervisor 直接回答 |
| 複雜問題 (N 個子任務) | **N + 2** | Supervisor (1) + Sub-agents (N) + Synthesizer (1) |
| JSON 解析失敗 | **1** | 使用 Supervisor 原始回應作為 fallback |

## 關鍵檔案對照

| 流程步驟 | 對應檔案 | 函數/常數 |
|---|---|---|
| Webhook 入口 | `api/index.js` | `app.post('/api/webhook', ...)` |
| 事件分流 | `api/index.js` | `handleEvent()` |
| Postback 處理 | `api/index.js` | `handlePostback()` |
| Supervisor Prompt | `prompts/index.js` | `SUPERVISOR_PROMPT` |
| Sub-agent Prompt | `prompts/index.js` | `buildAgentPrompt()` |
| Synthesizer Prompt | `prompts/index.js` | `buildSynthesizerPrompt()` |
| Rich Menu 動作常數 | `prompts/index.js` | `ACTIONS` |
| 功能列表/說明文字 | `prompts/index.js` | `buildFeatureListText()`, `buildHelpText()` |
| Rich Menu 建立 | `scripts/setup-rich-menu.js` | `main()` |
