import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { answer, newsTool } from './agent.js';

const article = z.object({ title: z.string(), url: z.string(), source: z.string(), published: z.string(), text: z.string() });
const input = z.object({ mode: z.enum(['chat', 'ask', 'latest', 'digest', 'web']), query: z.string(), resource: z.string(), thread: z.string(), articles: z.array(article).optional() });
const fetched = input.extend({ articles: z.array(article) });

const fetchArticles = createStep({
  id: 'fetch-articles', inputSchema: input, outputSchema: fetched,
  execute: async ({ inputData }) => {
    const articles = inputData.articles ?? (inputData.mode === 'latest'
      ? await newsTool<z.infer<typeof article>[]>('latest_news', { limit: 8 })
      : await newsTool<z.infer<typeof article>[]>('search_news', { query: inputData.query, limit: 8 }));
    return { ...inputData, articles };
  },
});
export const newsWorkflow = createWorkflow({ id: 'p1-retrieval', inputSchema: input, outputSchema: fetched })
  .then(fetchArticles).commit();

export async function runNewsWorkflow(data: z.infer<typeof input>, keys: { primaryKey: string; backupKey: string }): Promise<string> {
  const run = await newsWorkflow.createRun();
  const result = await run.start({ inputData: data });
  if (result.status !== 'success') throw new Error(`Mastra workflow ${result.status}`);
  if (!result.result.articles.length && data.mode !== 'chat') return 'No indexed P1 articles are available yet.';
  const question = data.mode === 'latest' ? 'Give a readable summary of these recent tech stories, with each exact source URL.' : data.query;
  return answer(question, data.resource, data.thread, keys.primaryKey, keys.backupKey, result.result.articles, data.mode === 'web' ? 8000 : 1200);
}
