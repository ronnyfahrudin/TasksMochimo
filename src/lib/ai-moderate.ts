import Anthropic from "@anthropic-ai/sdk";

export type ModerationVerdict = {
  verdict: "approve" | "reject" | "review";
  score: number; // 0..1 confidence proof is valid Mochimo content
  reason: string;
};

const SYSTEM_PROMPT = `You are a strict but fair content moderator for the Mochimo Tasks faucet program. Your job is to decide whether a user-submitted proof of a marketing task should be APPROVED, REJECTED, or sent to human REVIEW.

Mochimo ($MCM) is a quantum-resistant proof-of-work cryptocurrency. Acceptable content must:
1. Be genuinely about Mochimo, $MCM, or its quantum-resistant tech.
2. NOT be spammy, repetitive, AI-slop, plagiarized, or hateful.
3. NOT promote unrelated tokens, scams, airdrops, giveaways, or pump groups.
4. Match the claimed task type (tweet / thread / article / video).

Respond with STRICT JSON only, no prose:
{ "verdict": "approve" | "reject" | "review", "score": 0..1, "reason": "<<=160 chars>>" }

- score is your confidence (0..1) that the proof is valid and on-topic.
- Use "review" when uncertain (e.g. content is on-topic but quality is borderline).
- Use "reject" for off-topic, scam, plagiarism, or empty/low-effort.`;

export async function moderateContent(input: {
  taskTitle: string;
  taskDescription: string;
  proofUrl?: string | null;
  proofText?: string | null;
}): Promise<ModerationVerdict> {
  // If no API key, default to "review" so a human handles it.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.XAI_API_KEY) {
    return {
      verdict: "review",
      score: 0.5,
      reason: "No moderation API key configured — manual review required.",
    };
  }

  const userMsg = `TASK: ${input.taskTitle}
DESCRIPTION: ${input.taskDescription}
PROOF URL: ${input.proofUrl ?? "(none)"}
PROOF TEXT: ${input.proofText ?? "(none)"}

Return JSON only.`;

  // Prefer Anthropic Claude; fall back to xAI Grok (OpenAI-compatible API).
  if (process.env.ANTHROPIC_API_KEY) {
    return moderateWithClaude(userMsg);
  }
  return moderateWithGrok(userMsg);
}

async function moderateWithClaude(userMsg: string): Promise<ModerationVerdict> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  const text =
    res.content.find((c) => c.type === "text")?.type === "text"
      ? (res.content.find((c) => c.type === "text") as { text: string }).text
      : "";
  return parseVerdict(text);
}

async function moderateWithGrok(userMsg: string): Promise<ModerationVerdict> {
  const r = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY!}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-2-latest",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    return {
      verdict: "review",
      score: 0.5,
      reason: `Grok API error ${r.status} — manual review`,
    };
  }
  const data = (await r.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return parseVerdict(data.choices?.[0]?.message?.content ?? "");
}

function parseVerdict(raw: string): ModerationVerdict {
  try {
    // Strip ``` fences if any
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ModerationVerdict>;
    const verdict =
      parsed.verdict === "approve" || parsed.verdict === "reject"
        ? parsed.verdict
        : "review";
    const score = Math.max(0, Math.min(1, Number(parsed.score ?? 0.5)));
    const reason = String(parsed.reason ?? "").slice(0, 200);
    return { verdict, score, reason };
  } catch {
    return {
      verdict: "review",
      score: 0.5,
      reason: "Moderator returned unparseable response — manual review",
    };
  }
}
