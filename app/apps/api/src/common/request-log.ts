import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const VALID_ID = /^[\w-]{8,64}$/;

export interface RequestLogOptions {
  /** Write one JSON line per finished request. Off in tests and local dev to keep them quiet. */
  enabled: boolean;
  write?: (line: string) => void;
}

/** The id a request was given, for matching an error report to its log lines. */
export const requestIdOf = (req: Request): string | undefined =>
  (req as Request & { requestId?: string }).requestId;

/**
 * Gives every request an id (kept if the caller sent a sane one) and returns it in the
 * `x-request-id` header. When enabled, logs one JSON line per finished request: method, path,
 * status, duration and user id. Never the query string, body, headers or IP: they can carry
 * tokens and personal data.
 */
export function requestLogger({ enabled, write }: RequestLogOptions) {
  const out = write ?? ((line: string) => void process.stdout.write(line + '\n'));
  return (req: Request, res: Response, next: NextFunction) => {
    const sent = req.headers['x-request-id'];
    const id = typeof sent === 'string' && VALID_ID.test(sent) ? sent : randomUUID();
    (req as Request & { requestId?: string }).requestId = id;
    res.setHeader('x-request-id', id);
    if (!enabled || req.path === '/health') return next();

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const status = res.statusCode;
      out(
        JSON.stringify({
          t: new Date().toISOString(),
          level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
          msg: 'request',
          reqId: id,
          method: req.method,
          path: req.path,
          status,
          ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10,
          userId: (req as Request & { user?: { id: string } }).user?.id,
        }),
      );
    });
    next();
  };
}
