import { config } from "../config";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatJson<T>(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: params.system },
    { role: "user", content: params.user },
  ];

  const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: params.temperature ?? 0.2,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${text}`);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek returned empty content");

  try {
    return JSON.parse(content) as T;
  } catch {
    // Fallback: extract first JSON object
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Failed to parse DeepSeek JSON: ${content}`);
    return JSON.parse(match[0]) as T;
  }
}

export async function chatText(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const res = await fetch(`${config.deepseekBaseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.deepseekApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.deepseekModel,
      temperature: params.temperature ?? 0.4,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${text}`);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content?.trim() || "";
}
