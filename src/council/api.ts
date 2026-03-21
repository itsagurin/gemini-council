import { GoogleGenAI } from "@google/genai";

export async function callGemini(
  client: GoogleGenAI,
  model: string,
  userPrompt: string,
  systemPrompt: string
): Promise<string> {
  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
    },
  });

  return response.text ?? "(no response text)";
}

