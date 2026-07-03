import { MongoMemoryServer } from 'mongodb-memory-server';

export interface MongoTestEnv {
  server: MongoMemoryServer;
  uri: string;
}

export async function startMongoMemory(): Promise<MongoTestEnv> {
  const server = await MongoMemoryServer.create();
  return { server, uri: server.getUri('memoflow-test') };
}
