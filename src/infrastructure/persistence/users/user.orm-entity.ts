import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
@Check('CHK_users_role', `"role" IN ('user', 'admin')`)
export class UserOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @Column({ type: 'varchar', name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', name: 'display_name' })
  displayName: string;

  @Column({ type: 'varchar', default: 'user' })
  role: string;

  @Index()
  @Column({ type: 'int', default: 0 })
  xp: number;

  @Column({ type: 'int', default: 1 })
  level: number;

  // Mutable "last seen" timestamp, updated on login — not an immutable
  // creation time, so a plain column (not @CreateDateColumn) is correct.
  @Column({
    type: 'timestamptz',
    name: 'last_active_at',
    default: () => 'now()',
  })
  lastActiveAt: Date;

  // Account creation time. Persistence-only: not on the domain User entity or
  // any user route; read by the lead read repository as `registered_at`.
  @Column({
    type: 'timestamptz',
    name: 'created_at',
    default: () => 'now()',
  })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'disabled_at', nullable: true })
  disabledAt: Date | null;
}
