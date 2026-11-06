export const AUTH_MAIL_CONFIG = Symbol('AuthMailConfig');

export interface AuthMailConfig {
  /**
   * Origin that links in emails are built from. Comes from configuration
   * only, never from request data. Undefined means "do not send".
   */
  appBaseUrl: string | undefined;
}
