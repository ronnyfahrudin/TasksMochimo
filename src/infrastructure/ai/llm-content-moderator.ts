import Anthropic from "@anthropic-ai/sdk";
import {
  ModerationVerdict,
  type ContentModerator,
  type Verdict,
} from "@/domain/tasks/moderation";
import type { Proof } from "@/domain/tasks/proof";

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

function parseVerdict(raw: string): ModerationVerdict {
  try {
    // Models sometimes wrap JSON in ``` fences despite the instruction.
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const v = JSON.parse(cleaned) as { verdict?: string; score?: number; reason?: string };
    const verdict: Verdict =
      v.verdict === "approve" || v.verdict === "reject" ? v.verdict : "review";
    const score = typeof v.score === "number" ? Math.min(1, Math.max(0, v.score)) : 0.5;
    return new ModerationVerdict(verdict, score, (v.reason ?? "").slice(0, 300));
  } catch {
    return ModerationVerdict.needsHuman("Moderator returned unparseable output.");
  }
}

/**
 * Claude, with xAI Grok as a fallback.
 *
 * Every failure path lands on "review": an unavailable or confused moderator
 * must never auto-approve or auto-reject someone's work. It is a triage tool,
 * not an authority — high-value tasks still deserve human eyes.
 */
export class LlmContentModerator implements ContentModerator {
  async review(input: {
    taskTitle: string;
    taskDescription: string;
    proof: Proof;
  }): Promise<ModerationVerdict> {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.XAI_API_KEY) {
      return ModerationVerdict.needsHuman(
        "No moderation API key configured — manual review required.",
      );
    }

    const userMsg = `TASK: ${input.taskTitle}
DESCRIPTION: ${input.taskDescription}
PROOF URL: ${input.proof.url ?? "(none)"}
PROOF TEXT: ${input.proof.text ?? "(none)"}

Return JSON only.`;

    try {
      return process.env.ANTHROPIC_API_KEY
        ? await this.viaClaude(userMsg)
        : await this.viaGrok(userMsg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ModerationVerdict.needsHuman(`Moderator unavailable: ${msg.slice(0, 120)}`);
    }
  }

  private async viaClaude(userMsg: string): Promise<ModerationVerdict> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = res.content.find((c) => c.type === "text");
    return parseVerdict(text && "text" in text ? text.text : "");
  }

  private async viaGrok(userMsg: string): Promise<ModerationVerdict> {
    const r = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-2-latest",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      }),
    });
    if (!r.ok) return ModerationVerdict.needsHuman(`Grok API error ${r.status} — manual review`);
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseVerdict(data.choices?.[0]?.message?.content ?? "");
  }
}
