require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is missing in .env');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // Use gemini-2.5-flash

async function testGemini() {
    const userMessage = '請幫我翻譯"Hello World"成日文，並且寫一首關於蘋果的短詩';
    console.log('Testing User Message:', userMessage);
    console.log('-----------------------------------');

    try {
        // --- Step 1: Supervisor Analysis ---
        console.log('1. Starting Supervisor Analysis...');
        const supervisorPrompt = `你是一個統管 AI Agent 的 Supervisor。請分析使用者的要求，並將其拆解為多個獨立的子任務。判斷每個子任務需要哪種專業角色的 AI (例如: 翻譯員、程式設計師、搜尋專家)。
請嚴格輸出 JSON 陣列，格式為: [{"role": "角色名稱", "instruction": "具體指令"}]。如果判定使用者的要求非常簡單，只需要單一對話即可完成，請輸出空陣列 []。
不要輸出其他任何 Markdown 或文字解釋，只能輸出純 JSON。`;

        const supervisorResult = await model.generateContent(`${supervisorPrompt}\n\n用戶訊息：${userMessage}`);
        const supervisorResponseText = supervisorResult.response.text();
        console.log('Supervisor Raw Output:', supervisorResponseText);

        let tasks = [];
        try {
            const cleanJsonStr = supervisorResponseText.replace(/```json\n?|```/gi, '').trim();
            tasks = JSON.parse(cleanJsonStr);
        } catch (parseError) {
            console.warn("Supervisor JSON parsing failed.", parseError.message);
            tasks = [];
        }

        if (!Array.isArray(tasks) || tasks.length === 0) {
            console.log('Fallback: Using simple response mode.');
            return;
        }

        // --- Step 2: Sub-agent Execution ---
        console.log(`\n2. Supervisor assigned ${tasks.length} tasks. Executing parallel sub-agents...`);
        const agentPromises = tasks.map(async (task) => {
            const agentPrompt = `你現在是 ${task.role}。請根據以下指令執行任務，並直接給出結果：\n${task.instruction}\n\n這是一開始使用者的原始訊息作為參考：${userMessage}`;
            const agentResult = await model.generateContent(agentPrompt);
            const output = agentResult.response.text();
            console.log(`[Sub-agent ${task.role} Finished]`);
            return `【${task.role} 的回報】:\n${output}`;
        });

        const agentResultsArray = await Promise.all(agentPromises);
        const agentResultsCombined = agentResultsArray.join('\n\n');
        console.log('\nSub-agents Combined Results:\n', agentResultsCombined);

        // --- Step 3: Synthesis ---
        console.log('\n3. Starting Synthesizer to combine results...');
        const synthesizerPrompt = `你是一個負責統整最終報告的 Synthesizer AI。
這是一開始使用者的要求：\n"${userMessage}"

以下是各個專業 AI Agent 完成的結果：
${agentResultsCombined}

請將這些結果綜整成一個連貫、自然且易讀的最終回覆給使用者。請直接給出回覆內容，不需提及你是由哪些 Agent 統整出來的。`;

        const finalResult = await model.generateContent(synthesizerPrompt);
        console.log('\n================ FINAL RESULT ================');
        console.log(finalResult.response.text());
        console.log('==============================================');

    } catch (err) {
        console.error('Test failed with error:', err);
    }
}

testGemini();
