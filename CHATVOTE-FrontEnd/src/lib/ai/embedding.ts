import { embed } from 'ai';
import { embeddingModel } from './providers';

export async function embedQuery(query: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: query,
  });
  return embedding;
}
