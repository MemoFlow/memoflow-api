export const PROMPT_QUEUE = Symbol('PromptQueue');

/**
 * Queue port abstracting the async dispatch of a planning job (BullMQ today,
 * see infrastructure/queue/context). The payload only needs the
 * `planning_jobs` id and its owner — the (later) worker loads everything
 * else it needs straight from Mongo, so the queue message stays minimal and
 * the port doesn't leak the entity shape. `userId` rides along so the
 * processor can emit owner-scoped WebSocket events without a Mongo read.
 */
export interface PromptQueue {
  enqueue(job: { jobId: string; userId: string }): Promise<void>;
}
