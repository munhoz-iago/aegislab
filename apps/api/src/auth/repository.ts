export interface PublicUser {
  id: string;
  email: string;
  createdAt: Date;
}

export interface StoredUser extends PublicUser {
  passwordHash: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("Email is already registered");
  }
}

export interface AuthRepository {
  ping(): Promise<void>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserBySession(tokenHash: string, now: Date): Promise<PublicUser | null>;
  createUser(email: string, passwordHash: string): Promise<StoredUser>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
}
