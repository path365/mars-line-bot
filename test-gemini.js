require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { SUPERVISOR_PROMPT, buildAgentPrompt, buildSynthesizerPrompt } = require('./prompts');

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
        const supervisorResult = await model.generateContent(`${SUPERVISOR_PROMPT}\n\n用戶訊息：${userMessage}`);
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
            const agentPrompt = buildAgentPrompt(task.role, task.instruction, userMessage);
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
        const finalResult = await model.generateContent(buildSynthesizerPrompt(userMessage, agentResultsCombined));
        console.log('\n================ FINAL RESULT ================');
        console.log(finalResult.response.text());
        console.log('==============================================');

    } catch (err) {
        console.error('Test failed with error:', err);
    }
}

testGemini();
