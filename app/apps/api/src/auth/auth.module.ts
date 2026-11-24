import { Global, Module } from '@nestjs/common';
import { AuthCleanupService } from './auth-cleanup.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokensService, OtpService, AuthCleanupService],
  exports: [AuthService, PasswordService, TokensService],
})
export class AuthModule {}
