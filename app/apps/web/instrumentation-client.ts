import * as Sentry from '@sentry/browser';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    defaultIntegrations: false,
    integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend(event) {
      return {
        type: event.type,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: event.platform,
        environment: event.environment,
        release: event.release,
        level: event.level,
        exception: {
          values: event.exception?.values?.map(({ type, stacktrace }) => ({
            type: type && /^[A-Za-z][\w.]{0,79}$/.test(type) ? type : 'Error',
            value: 'Unexpected browser error',
            stacktrace: {
              // Keep only static script paths. The page URL may contain a seat link or a token.
              frames: stacktrace?.frames?.flatMap(({ filename, lineno, colno }) => {
                const path = filename?.match(/\/(_next\/static\/[\w./-]+\.js)(?:[?#]|$)/);
                return path ? [{ filename: '/' + path[1], lineno, colno, in_app: true }] : [];
              }),
            },
          })),
        },
      };
    },
  });
}
