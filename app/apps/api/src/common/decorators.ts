import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { INTEGRITY, type Role } from '@parakh/shared';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Skips authentication for a route (login, register, health, ...). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to the listed roles. Routes without @Roles allow any signed-in user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest().user;
  },
);

/** Where a request came from. The device id is a random id the web app keeps in the browser. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  deviceId: string | null;
}

export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest();
  const device = String(req.headers['x-device-id'] ?? '');
  return {
    ip: (req.ip as string | undefined) ?? null,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
    deviceId: INTEGRITY.DEVICE_ID_PATTERN.test(device) ? device : null,
  };
});
