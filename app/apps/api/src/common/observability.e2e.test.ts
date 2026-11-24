import type { ArgumentsHost } from '@nestjs/common';
import { HttpException, NotFoundException } from '@nestjs/common';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { TestContext, createTestApp } from '../../test/helpers';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { requestLogger } from './request-log';

describe('request logger', () => {
  const lines: string[] = [];
  const app = express();
  app.use(requestLogger({ enabled: true, write: (l) => lines.push(l) }));
  app.get('/x', (_req, res) => void res.send('ok'));
  app.get('/health', (_req, res) => void res.send('ok'));
  app.get('/boom', (_req, res) => void res.status(500).send('bad'));

  it('logs one JSON line per request with an id, and never the query string', async () => {
    lines.length = 0;
    const res = await request(app).get('/x?token=super-secret');
    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({
      level: 'info',
      msg: 'request',
      method: 'GET',
      path: '/x',
      status: 200,
    });
    expect(line.reqId).toBe(res.headers['x-request-id']);
    expect(typeof line.ms).toBe('number');
    expect(lines.join('')).not.toContain('super-secret');
  });

  it('keeps a sane incoming id, replaces a bad one, and marks failures', async () => {
    lines.length = 0;
    const kept = await request(app).get('/x').set('x-request-id', 'abc12345-trace');
    expect(kept.headers['x-request-id']).toBe('abc12345-trace');
    const replaced = await request(app).get('/x').set('x-request-id', 'bad id with spaces!');
    expect(replaced.headers['x-request-id']).not.toBe('bad id with spaces!');
    await request(app).get('/boom');
    expect(JSON.parse(lines[2]).level).toBe('error');
  });

  it('does not log the health check, and logs nothing when disabled', async () => {
    lines.length = 0;
    await request(app).get('/health');
    expect(lines).toHaveLength(0);

    const quiet: string[] = [];
    const off = express();
    off.use(requestLogger({ enabled: false, write: (l) => quiet.push(l) }));
    off.get('/x', (_req, res) => void res.send('ok'));
    const res = await request(off).get('/x');
    expect(quiet).toHaveLength(0);
    expect(res.headers['x-request-id']).toBeTruthy(); // the id is still given
  });
});

describe('error filter', () => {
  const reply = vi.fn();
  const ref = { reply, isHeadersSent: () => false, end: vi.fn() };
  const hostFor = (req: object): ArgumentsHost =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
      getArgByIndex: () => ({}),
    }) as unknown as ArgumentsHost;
  const req = { method: 'POST', path: '/exams', requestId: 'req-12345678' };

  it('writes a structured line with the id and stack for an unexpected error', () => {
    const lines: string[] = [];
    const filter = new AllExceptionsFilter(ref as never, (l) => lines.push(l));
    filter.catch(new TypeError('cannot read x'), hostFor(req));
    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({
      level: 'error',
      msg: 'unhandled error',
      reqId: 'req-12345678',
      method: 'POST',
      path: '/exams',
      error: 'TypeError',
    });
    expect(line.stack).toContain('cannot read x');
    expect(reply).toHaveBeenCalledWith(expect.anything(), expect.anything(), 500);
  });

  it('stays quiet for a deliberate 4xx but still logs a 5xx HttpException', () => {
    const lines: string[] = [];
    const filter = new AllExceptionsFilter(ref as never, (l) => lines.push(l));
    filter.catch(new NotFoundException('nope'), hostFor(req));
    expect(lines).toHaveLength(0);
    filter.catch(new HttpException('upstream failed', 502), hostFor(req));
    expect(lines).toHaveLength(1);
  });
});

describe('health check', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('answers 200 with the database status, and a request id', async () => {
    const res = await ctx.http().get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('answers 503 when the database cannot be reached', async () => {
    const prisma = ctx.app.get(PrismaService);
    const spy = vi
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('connection refused'));
    const res = await ctx.http().get('/health').expect(503);
    expect(res.body).toMatchObject({ status: 'degraded', database: 'unreachable' });
    spy.mockRestore();
    await ctx.http().get('/health').expect(200);
  });
});
