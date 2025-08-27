async function inference(prompt: string, tag: string) {
    try {
        const response = await fetch("https://proxy-ai.onrender.com/api/cohere/inference", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: prompt,
                model: "command-r-plus",
                max_tokens: 2000,
            }),
        });
        return response;
    } catch (error) {
        console.error('Inference error:', error);
        throw error;
    }
}

export default inference;
