/**
 * Stops a Testcontainers container for `afterAll`. Docker occasionally
 * answers the removal with `409 cannot remove container: container is
 * running` while the container is still shutting down; that one error is
 * retried briefly. Every other error is rethrown.
 */
export async function stopContainer(
  container: { stop(): Promise<unknown> } | undefined,
  attempts = 5,
  delayMs = 500,
): Promise<void> {
  if (!container) return;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await container.stop();
      return;
    } catch (err) {
      if (!isRunningConflict(err) || attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

function isRunningConflict(err: unknown): boolean {
  const e = err as { statusCode?: number; message?: string } | null;
  const message = e?.message ?? '';
  return (
    (e?.statusCode === 409 || /HTTP code 409/.test(message)) &&
    /container is running/i.test(message)
  );
}
