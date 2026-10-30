export async function withBackup<T>(primary: () => Promise<T>, backup?: () => Promise<T>): Promise<T> {
  try { return await primary(); }
  catch (error) {
    if (!backup) throw error;
    console.log(JSON.stringify({ stage: 'groq.fallback' }));
    return backup();
  }
}
