import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { requestIdOf } from './request-log';
import { captureApiException } from './sentry';

/**
 * Behaves exactly like Nest's default handler, but writes one structured line for every
 * unexpected error (anything that is not a deliberate 4xx), with the request id and stack, so a
 * 500 can be found in the logs and matched to the request that caused it.
 */
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(
    applicationRef?: ConstructorParameters<typeof BaseExceptionFilter>[0],
    private readonly write: (line: string) => void = (line) =>
      void process.stderr.write(line + '\n'),
  ) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const unexpected = !(exception instanceof HttpException) || exception.getStatus() >= 500;
    if (unexpected && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<Request>();
      const err = exception instanceof Error ? exception : new Error(String(exception));
      captureApiException(err);
      this.write(
        JSON.stringify({
          t: new Date().toISOString(),
          level: 'error',
          msg: 'unhandled error',
          reqId: requestIdOf(req),
          method: req.method,
          path: req.path,
          error: err.name,
          message: err.message,
          stack: err.stack,
        }),
      );
    }
    super.catch(exception, host);
  }
}
