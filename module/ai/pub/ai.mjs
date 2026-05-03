async function chatCompletion(data) {
    const response = await $fn('ai::chatCompletions')(data);
    return response.choices[0].message.content;
}

/* simply ask something */
export function ask(prompt, systemPrompt = null) {
    const data = { messages: [] };
    if (systemPrompt) data.messages.push({ role: 'system', content: systemPrompt });
    data.messages.push({ role: 'user', content: prompt });
    return chatCompletion(data);
}

/* chat with history */
export class AIChat {
    constructor(systemPrompt = null) {
        this.history = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
    }
    async chat(message) {
        this.history.push({ role: 'user', content: message });
        try {
            const response = await chatCompletion({ messages: this.history });
            this.history.push({ role: 'assistant', content: response });
            return response;
        } catch (error) {
            this.history.pop();
            throw error;
        }
    }
}

