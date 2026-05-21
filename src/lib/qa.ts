import { streamText, tool, stepCountIs } from "ai";
import { transformersJS, type TransformersJSLanguageModel } from "@browser-ai/transformers-js";
import { z } from "zod";
import type { SearchHit } from "../types";

export type SearchFn = (query: string) => Promise<SearchHit[]>;

export type QAEvent =
  | { type: "loading"; progress: number; file: string }
  | { type: "ready" }
  | { type: "tool-call"; query: string }
  | { type: "tool-result"; hits: SearchHit[] }
  | { type: "answer"; text: string }
  | { type: "error"; message: string };

export type QAModel = TransformersJSLanguageModel;

// Strong instruction: model must search, not answer from memory.
const SYSTEM_PROMPT =
  "You are an assistant for Sky Atlas governance documentation. " +
  "You MUST call search_atlas before answering every question — never use internal knowledge. " +
  "After receiving search results, answer in 2-3 sentences citing doc numbers";

export async function ensureModelReady(
  model: QAModel,
  emit: (e: QAEvent) => void,
): Promise<boolean> {
  const availability = await model.availability();
  if (availability === "unavailable") {
    emit({ type: "error", message: "This browser does not support in-browser inference." });
    return false;
  }
  if (availability === "downloadable") {
    await model.createSessionWithProgress((progress: number) => {
      emit({ type: "loading", progress: Math.round(progress * 100), file: "" });
    });
  }
  emit({ type: "ready" });
  return true;
}

export async function runQA(
  question: string,
  model: QAModel,
  search: SearchFn,
  emit: (e: QAEvent) => void,
): Promise<void> {
  try {
    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],
      tools: {
        search_atlas: tool({
          description:
            "Search Sky Atlas governance documentation. You MUST call this before answering.",
          inputSchema: z.object({
            query: z.string().describe("Search terms"),
          }),
          execute: async ({ query }) => {
            emit({ type: "tool-call", query });
            const hits = await search(query);
            emit({ type: "tool-result", hits });
            return hits.slice(0, 3).map((h) => ({
              doc_no: h.doc_no,
              title: h.title,
              excerpt: h.snippet.replace(/<[^>]+>/g, ""),
            }));
          },
        }),
      },
      stopWhen: stepCountIs(4),
    });

    let answer = "";
    for await (const chunk of result.textStream) {
      answer += chunk;
    }
    emit({ type: "answer", text: answer.trim() || "(No response generated)" });
  } catch (err) {
    emit({ type: "error", message: String(err) });
  }
}
