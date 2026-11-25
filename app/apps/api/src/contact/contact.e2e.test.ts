import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext, createTestApp } from '../../test/helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(async () => {
  await ctx.reset();
  ctx.mail.clear();
});

const valid = {
  name: 'Asha Rao',
  email: 'Asha@Example.com',
  topic: 'Custom websites and web platforms',
  message: 'We need a booking site for our clinic, with payments.',
};

describe('contact form', () => {
  it('emails the support inbox with a reply-to, and confirms to the visitor', async () => {
    const res = await ctx.http().post('/contact').send(valid).expect(200);
    expect(res.body).toEqual({ sent: true });
    const inbox = ctx.mail.outbox.find((m) => m.to === 'support@nandivex.com');
    expect(inbox?.replyTo).toBe('asha@example.com');
    expect(inbox?.subject).toContain('Asha Rao');
    expect(inbox?.text).toContain('We need a booking site');
    expect(ctx.mail.lastTo('asha@example.com')?.subject).toBe('We got your message');
  });

  it('can be posted from the company website origin', async () => {
    const res = await ctx
      .http()
      .options('/contact')
      .set('Origin', 'https://nandivex.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.headers['access-control-allow-origin']).toBe('https://nandivex.com');
  });

  it('rejects bad input', async () => {
    await ctx
      .http()
      .post('/contact')
      .send({ ...valid, email: 'nope' })
      .expect(400);
    await ctx
      .http()
      .post('/contact')
      .send({ ...valid, message: 'short' })
      .expect(400);
    await ctx
      .http()
      .post('/contact')
      .send({ ...valid, name: '' })
      .expect(400);
    expect(ctx.mail.outbox).toHaveLength(0);
  });

  it('says "sent" to a bot that fills the hidden field, but sends nothing', async () => {
    const res = await ctx
      .http()
      .post('/contact')
      .send({ ...valid, website: 'http://spam.example' })
      .expect(200);
    expect(res.body).toEqual({ sent: true });
    expect(ctx.mail.outbox).toHaveLength(0);
  });

  it('cannot inject headers through the name', async () => {
    await ctx
      .http()
      .post('/contact')
      .send({ ...valid, name: 'Evil\r\nBcc: victim@example.com' })
      .expect(200);
    const inbox = ctx.mail.outbox.find((m) => m.to === 'support@nandivex.com');
    expect(inbox?.subject).not.toMatch(/[\r\n]/);
  });
});
