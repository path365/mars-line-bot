/**
 * Gemini Prompt Templates
 *
 * 所有 AI prompt 模板集中管理，方便調整與維護。
 */

// ===== Rich Menu Postback Actions =====
const ACTIONS = {
  AI_CHAT: 'action=ai_chat',
  FEATURES: 'action=features',
  HELP: 'action=help',
};

// ===== 功能列表定義（新增功能時在此維護） =====
const FEATURE_LIST = [
  { name: '🤖 AI 智能問答', description: '輸入任何問題，AI 會自動拆解並由多位專業 Agent 協作回答' },
  { name: '📋 功能列表', description: '查看目前所有可用功能' },
  { name: '❓ 使用說明', description: '查看 Bot 的使用方式與說明' },
];

/**
 * 產生功能列表回應文字
 */
function buildFeatureListText() {
  const items = FEATURE_LIST.map((f, i) => `${i + 1}. ${f.name}\n   ${f.description}`).join('\n\n');
  return `【目前可用功能】\n\n${items}\n\n💡 持續開發中，更多功能敬請期待！`;
}

/**
 * 產生使用說明回應文字
 */
function buildHelpText() {
  return `【使用說明】

🤖 AI 智能問答
直接輸入您的問題即可！Bot 會自動判斷問題複雜度：
• 簡單問題 → 直接回覆
• 複雜問題 → 拆解為多個子任務，由專業 AI Agent 協作完成後統整回覆

📋 功能列表
點選底部選單的「功能列表」按鈕，查看所有可用功能。

💬 小提示
• 可以同時提出多個要求，例如：「幫我翻譯這段話成英文，並寫一首詩」
• Bot 會自動分配給不同專業 Agent 並行處理`;
}

const AI_CHAT_GREETING = '請直接輸入您的問題，我會為您處理！💬\n\n您可以提出任何問題，複雜的需求我會自動拆解並交由多位專業 AI 協作完成。';

/**
 * Supervisor prompt — 分析使用者需求，拆解為子任務。
 * 輸出格式：JSON 陣列 [{"role": "...", "instruction": "..."}]
 * 簡單任務回傳 []
 */
const SUPERVISOR_PROMPT = `你是一個統管 AI Agent 的 Supervisor。請分析使用者的要求，並將其拆解為多個獨立的子任務。判斷每個子任務需要哪種專業角色的 AI (例如: 翻譯員、程式設計師、搜尋專家)。
請嚴格輸出 JSON 陣列，格式為: [{"role": "角色名稱", "instruction": "具體指令"}]。如果判定使用者的要求非常簡單，只需要單一對話即可完成，請輸出空陣列 []。
不要輸出其他任何 Markdown 或文字解釋，只能輸出純 JSON。`;

/**
 * Sub-agent prompt 產生器
 * @param {string} role - Agent 角色名稱
 * @param {string} instruction - 具體指令
 * @param {string} userMessage - 使用者原始訊息
 * @returns {string} 完整 prompt
 */
function buildAgentPrompt(role, instruction, userMessage) {
  return `你現在是 ${role}。請根據以下指令執行任務，並直接給出結果：\n${instruction}\n\n這是一開始使用者的原始訊息作為參考：${userMessage}`;
}

/**
 * Synthesizer prompt 產生器 — 統整所有 sub-agent 回報
 * @param {string} userMessage - 使用者原始訊息
 * @param {string} agentResultsCombined - 所有 sub-agent 結果合併文字
 * @returns {string} 完整 prompt
 */
function buildSynthesizerPrompt(userMessage, agentResultsCombined) {
  return `你是一個負責統整最終報告的 Synthesizer AI。
這是一開始使用者的要求：\n"${userMessage}"

以下是各個專業 AI Agent 完成的結果：
${agentResultsCombined}

請將這些結果綜整成一個連貫、自然且易讀的最終回覆給使用者。請直接給出回覆內容，不需提及你是由哪些 Agent 統整出來的。`;
}

module.exports = {
  SUPERVISOR_PROMPT,
  buildAgentPrompt,
  buildSynthesizerPrompt,
  ACTIONS,
  FEATURE_LIST,
  buildFeatureListText,
  buildHelpText,
  AI_CHAT_GREETING,
};
