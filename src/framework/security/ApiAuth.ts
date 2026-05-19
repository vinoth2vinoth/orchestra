import { timingSafeEqual } from 'crypto';
import type express from 'express';

function constantTimeEquals(actual: string, expected: string): boolean {
  if (!actual || !expected) return false;

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createApiAuthMiddleware(env: NodeJS.ProcessEnv = process.env): express.RequestHandler {
  return (req, res, next) => {
    if (env.ORCHESTRA_DEV_AUTH_BYPASS === 'true') {
      return next();
    }

    const configuredToken = env.ORCHESTRA_API_TOKEN;
    if (!configuredToken) {
      return res.status(503).json({
        error: 'API authentication is not configured. Set ORCHESTRA_API_TOKEN or explicitly enable ORCHESTRA_DEV_AUTH_BYPASS=true for local development.'
      });
    }

    const authHeader = req.header('authorization') || '';
    const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const apiKey = req.header('x-orchestra-api-key') || '';

    if (
      !constantTimeEquals(bearerToken, configuredToken) &&
      !constantTimeEquals(apiKey, configuredToken)
    ) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  };
}
