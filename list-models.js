require('dotenv').config();

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.models) {
            console.log('Available Models:');
            data.models.forEach(m => console.log(m.name));
        } else {
            console.log('Error fetching models:', data);
        }
    } catch (err) {
        console.error('Fetch error:', err);
    }
}

listModels();
