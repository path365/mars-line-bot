require('dotenv').config();
const { generateContent } = require('./utils/gemini');
const { SUPERVISOR_PROMPT, buildAgentPrompt, buildSynthesizerPrompt } = require('./prompts');

if (!process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is missing in .env');
    process.exit(1);
}

async function testGemini() {
    const userMessage = '請幫我翻譯"Hello World"成日文，並且寫一首關於蘋果的短詩';
    console.log('Testing User Message:', userMessage);
    console.log('-----------------------------------');

    try {
        // --- Step 1: Supervisor Analysis ---
        console.log('1. Starting Supervisor Analysis...');
        const supervisorResult = await generateContent(`${SUPERVISOR_PROMPT}\n\n用戶訊息：${userMessage}`);
        const supervisorResponseText = supervisorResult.response.text();
        console.log('Supervisor Raw Output:', supervisorResponseText);

        let tasks = [];
        let parsed = null;
        try {
            const cleanJsonStr = supervisorResponseText.replace(/```json\n?|```/gi, '').trim();
            parsed = JSON.parse(cleanJsonStr);
        } catch (parseError) {
            console.warn("Supervisor JSON parsing failed.", parseError.message);
            console.log('Using raw supervisor response as answer.');
            console.log('\n================ FINAL RESULT ================');
            console.log(supervisorResponseText);
            console.log('==============================================');
            return;
        }

        // 簡單任務：Supervisor 直接回答 (1 次 API 呼叫)
        if (parsed.type === 'simple' && parsed.answer) {
            console.log('Supervisor answered directly (simple mode). [1 API call]');
            console.log('\n================ FINAL RESULT ================');
            console.log(parsed.answer);
            console.log('==============================================');
            return;
        }

        tasks = parsed.tasks || [];
        if (!Array.isArray(tasks) || tasks.length === 0) {
            console.log('No valid tasks found. Returning raw supervisor response.');
            return;
        }

        // --- Step 2: Sub-agent Execution ---
        console.log(`\n2. Supervisor assigned ${tasks.length} tasks. Executing parallel sub-agents...`);
        const agentPromises = tasks.map(async (task) => {
            const agentPrompt = buildAgentPrompt(task.role, task.instruction, userMessage);
            const agentResult = await generateContent(agentPrompt);
            const output = agentResult.response.text();
            console.log(`[Sub-agent ${task.role} Finished]`);
            return `【${task.role} 的回報】:\n${output}`;
        });

        const agentResultsArray = await Promise.all(agentPromises);
        const agentResultsCombined = agentResultsArray.join('\n\n');
        console.log('\nSub-agents Combined Results:\n', agentResultsCombined);

        // --- Step 3: Synthesis ---
        console.log('\n3. Starting Synthesizer to combine results...');
        const finalResult = await generateContent(buildSynthesizerPrompt(userMessage, agentResultsCombined));
        console.log('\n================ FINAL RESULT ================');
        console.log(finalResult.response.text());
        console.log('==============================================');

    } catch (err) {
        console.error('Test failed with error:', err);
    }
}

testGemini();
