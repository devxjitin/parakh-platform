import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { applyRateLimits } from './common/rate-limits';
import { ConfigModule } from './config/config.module';
import { ENV, Env } from './config/env';
import { AttemptsModule } from './attempts/attempts.module';
import { CertificatesModule } from './certificates/certificates.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { PracticeModule } from './practice/practice.module';
import { ResultsModule } from './results/results.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { PaymentsModule } from './payments/payments.module';
import { PayoutsModule } from './payouts/payouts.module';
import { ExamsModule } from './exams/exams.module';
import { HealthController } from './health/health.controller';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

/**
 * Root module. Feature modules (exams, questions, attempts, payments, ledger, payouts,
 * certificates, ...) are added sprint by sprint - see PARAKH_IMPLEMENTATION_PLAN.md.
 *
 * Guard order matters: throttle -> authenticate -> authorise by role.
 */
@Module({
  imports: [
    // Per-IP ceilings from RATE_LIMIT_* (see common/rate-limits.ts). Off in tests unless a test
    // sets RATE_LIMIT_TEST=on.
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => {
        applyRateLimits(env);
        return {
          throttlers: [{ ttl: 60_000, limit: env.RATE_LIMIT_IP_PER_MIN }],
          skipIf: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_TEST !== 'on',
        };
      },
    }),
    ConfigModule,
    PrismaModule,
    SettingsModule,
    AuditModule,
    MailModule,
    StorageModule,
    AuthModule,
    UsersModule,
    AdminModule,
    ExamsModule,
    PaymentsModule,
    PayoutsModule,
    EnrollmentsModule,
    AttemptsModule,
    ResultsModule,
    CertificatesModule,
    PracticeModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
