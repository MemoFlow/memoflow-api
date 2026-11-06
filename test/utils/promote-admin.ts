import { Client } from 'pg';
import { PgTestEnv } from './pg-testcontainer';

/**
 * Sets a user's role to admin by direct DB update. There is deliberately no
 * public API for this, so e2e suites use this helper. The role is read from
 * the database on every request, so tokens issued before the promotion
 * reflect the new role immediately.
 */
export async function promoteToAdmin(
  pgEnv: PgTestEnv['env'],
  email: string,
): Promise<void> {
  await setUserRole(pgEnv, email, 'admin');
}

/** Sets a user's role by direct DB update. */
export async function setUserRole(
  pgEnv: PgTestEnv['env'],
  email: string,
  role: 'user' | 'admin',
): Promise<void> {
  const client = new Client({
    host: pgEnv.POSTGRES_HOST,
    port: Number(pgEnv.POSTGRES_PORT),
    user: pgEnv.POSTGRES_USER,
    password: pgEnv.POSTGRES_PASSWORD,
    database: pgEnv.POSTGRES_DB,
  });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE users SET role = $1 WHERE email = $2`,
      [role, email],
    );
    if (result.rowCount !== 1) {
      throw new Error(`setUserRole: no user with email ${email}`);
    }
  } finally {
    await client.end();
  }
}
