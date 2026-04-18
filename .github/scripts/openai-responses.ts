#!/usr/bin/env bun

interface CreateTextOptions {
  apiKey: string | undefined;
  model?: string | undefined;
  prompt: string;
  maxOutputTokens?: number | undefined;
}

interface OpenAIResponseContentItem {
  type?: string;
  text?: string;
}

interface OpenAIResponseOutputItem {
  content?: OpenAIResponseContentItem[];
}

interface OpenAIResponsePayload {
  output_text?: string;
  output?: OpenAIResponseOutputItem[];
  error?: {
    message?: string;
  };
}

function extractOutputText(payload: OpenAIResponsePayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  const chunks: string[] = [];
  for (const outputItem of payload.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
        chunks.push(contentItem.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

export async function createOpenAITextResponse({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
}: CreateTextOptions): Promise<string> {
  if (!apiKey) {
    throw new Error('Missing required environment variable: OPENAI_API_KEY');
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'gpt-5',
      input: prompt,
      ...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
    }),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error('OpenAI API returned no output text.');
  }

  return outputText;
}
