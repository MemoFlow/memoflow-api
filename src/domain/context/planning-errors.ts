/**
 * Typed planning failures with FIXED messages. They are safe to record on a
 * job (clients read `error_message`); anything else a planning job throws is
 * replaced with a generic message before it is stored.
 */

export const PLANNING_FAILED_MESSAGE = 'Planning job processing failed';

/** The planner's reply didn't match the expected shape or size limits. */
export class PlanningOutputInvalidError extends Error {
  constructor(message = 'The AI planner returned an invalid result') {
    super(message);
    this.name = 'PlanningOutputInvalidError';
  }
}

/** The planner's reply echoed the nonce or the system prompt. */
export class PlanningOutputRejectedError extends Error {
  constructor(message = 'The AI planner returned a result that was rejected') {
    super(message);
    this.name = 'PlanningOutputRejectedError';
  }
}

/** Error code recorded when the job's user is gone or disabled. */
export const USER_INACTIVE_ERROR_CODE = 'USER_INACTIVE';

/** The job's user no longer exists or was disabled before the job ran. */
export class JobUserInactiveError extends Error {
  constructor(message = 'The account that submitted this job is not active') {
    super(message);
    this.name = 'JobUserInactiveError';
  }
}
