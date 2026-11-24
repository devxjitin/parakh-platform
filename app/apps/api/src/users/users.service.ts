import { Injectable } from '@nestjs/common';
import type { PublicUser, UpdateProfileInput } from '@parakh/shared';
import { AuditService } from '../audit/audit.service';
import { toPublicUser } from '../auth/auth.service';
import type { AuthUser } from '../common/decorators';
import type { RequestMeta } from '../common/request-meta';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { examinerProfile: true },
    });
    return toPublicUser(user);
  }

  async updateProfile(
    actor: AuthUser,
    input: UpdateProfileInput,
    meta: RequestMeta,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        name: input.name,
        phone: input.phone,
        // Only examiners have an organisation; ignored for other roles.
        examinerProfile:
          actor.role === 'EXAMINER' && input.orgName !== undefined
            ? { upsert: { create: { orgName: input.orgName }, update: { orgName: input.orgName } } }
            : undefined,
      },
      include: { examinerProfile: true },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'user.profile_updated',
      entity: 'User',
      entityId: actor.id,
      meta: { fields: Object.keys(input) },
      ip: meta.ip,
    });
    return toPublicUser(user);
  }
}
