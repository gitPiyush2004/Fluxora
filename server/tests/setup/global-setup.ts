import { existsSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

let mongod: MongoMemoryServer | undefined;

/**
 * Starts one in-memory MongoDB for the whole run. If a local `mongod` binary exists it is
 * reused (no download); otherwise mongodb-memory-server downloads a pinned binary.
 */
export async function setup(project: TestProject) {
  const systemBinary = process.env.MONGOMS_SYSTEM_BINARY ?? ['/opt/homebrew/bin/mongod', '/usr/local/bin/mongod', '/usr/bin/mongod'].find((p) => existsSync(p));
  mongod = await MongoMemoryServer.create(systemBinary ? { binary: { systemBinary } } : {});
  project.provide('mongoUri', mongod.getUri());
}

export async function teardown() {
  await mongod?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
