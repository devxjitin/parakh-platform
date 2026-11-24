import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT,
    release: process.env.SENTRY_RELEASE,
    defaultIntegrations: false,
    enableRuntimeChannelInjection: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    beforeSend(event) {
      // Exception messages and contextual data can contain student and payment details.
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
            value: 'Unexpected API error',
            stacktrace: {
              frames: stacktrace?.frames?.flatMap(({ filename, function: name, lineno, colno }) => {
                const file = filename
                  ?.replaceAll('\\', '/')
                  .match(/\/apps\/api\/(?:dist|src)\/([\w./-]+\.[cm]?[jt]s)$/);
                return file
                  ? [{ filename: file[1], function: name, lineno, colno, in_app: true }]
                  : [];
              }),
            },
          })),
        },
      };
    },
  });
}

export function captureApiException(error: Error): string | undefined {
  if (dsn) return Sentry.captureException(error);
}
