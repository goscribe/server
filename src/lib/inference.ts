import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.INFERENCE_API_KEY,
    baseURL: process.env.INFERENCE_BASE_URL,
});

async function inference(prompt: string) {
    try {
        const response = await openai.chat.completions.create({
            model: "command-a-03-2025",
            messages: [{ role: "user", content: prompt }],
        });
        return response;
    } catch (error) {
        console.error('Inference error:', error);
        throw error;
    }
}

export default inference;
