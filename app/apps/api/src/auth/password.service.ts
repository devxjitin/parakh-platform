import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

// argon2id with the OWASP-recommended minimum parameters (19 MiB, 2 passes, 1 lane).
const OPTIONS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  // A real hash of a throwaway string, used to keep login timing the same for unknown emails.
  private readonly dummyHash: Promise<string> = hash('throwaway-password-for-timing', OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Burns the same CPU time as a real check; call when the account does not exist. */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(await this.dummyHash, password);
  }
}
