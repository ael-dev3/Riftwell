import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { appendAudit } from './database.ts';
import { fail } from './errors.ts';
import { fields, address, uuid, sameOwner } from './validation.ts';
import type { FastifyRequest } from 'fastify';
import type {
  App,
  AuthContext,
  ChallengeRow,
  RequireSession,
  Session,
  SessionRow,
} from './types.ts';

const iso = (time: number): string => new Date(time).toISOString();

export function registerAuth(app: App, ctx: AuthContext): RequireSession {
  const { db, config, now, hash, limiter } = ctx;
  const cookieName = config.production
    ? '__Host-riftwell_session'
    : 'riftwell_session';
  const bearer = config.sessionTransport === 'bearer';
  const cookieToken = (request: FastifyRequest): string | null => {
    const cookies = request.headers.cookie;
    if (!cookies || cookies.length > 4096) return null;
    const pairs = cookies.split(';').map((value) => value.trim().split('='));
    const matches = pairs.filter(([key]) => key === cookieName);
    if (matches.length !== 1 || !/^[0-9a-f]{64}$/.test(matches[0][1] ?? ''))
      return null;
    return matches[0][1];
  };
  const csrfFor = (token: string): string => hash(`csrf-token:${token}`);
  // Exactly one configured transport. Cookies never authenticate the separate
  // Firebase frontend; Authorization never changes same-origin cookie behavior.
  const sessionToken = (request: FastifyRequest): string | null => {
    if (!bearer) return cookieToken(request);
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') return null;
    return /^Bearer ([0-9a-f]{64})$/.exec(authorization)?.[1] ?? null;
  };
  const cookie = (token: string, expiresAt: number, clear = false): string =>
    `${cookieName}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict${config.production ? '; Secure' : ''}; Max-Age=${clear ? 0 : Math.max(0, Math.floor((expiresAt - now()) / 1000))}; Expires=${new Date(clear ? 0 : expiresAt).toUTCString()}`;
  const sessionResponse = (
    row: Pick<SessionRow, 'address' | 'chain_id' | 'expires_at'>,
    token: string,
  ): Session => ({
    address: row.address,
    chainId: row.chain_id,
    csrfToken: csrfFor(token),
    expiresAt: iso(row.expires_at),
  });
  const requireSession: RequireSession = async (request, mutation = false) => {
    const token = sessionToken(request);
    if (!token)
      fail(401, 'AUTH_REQUIRED', 'Sign in with your wallet to continue.');
    const row = await db.get<SessionRow>(
      'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
      hash(token),
      now(),
    );
    if (!row || row.expires_at <= now())
      fail(401, 'AUTH_REQUIRED', 'Sign in with your wallet to continue.');
    if (mutation) {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !/^[0-9a-f]{64}$/.test(csrf))
        fail(403, 'CSRF_REJECTED', 'The request could not be verified.');
      const supplied = Buffer.from(hash(`csrf:${csrf}`), 'hex');
      const expected = Buffer.from(row.csrf_hash, 'hex');
      if (!timingSafeEqual(supplied, expected))
        fail(403, 'CSRF_REJECTED', 'The request could not be verified.');
    }
    return { ...row, token };
  };

  app.post('/api/v1/auth/challenge', async (request) => {
    const body = fields(request.body, ['address', 'chainId']);
    const account = address(body.address);
    if (body.chainId !== 999)
      fail(400, 'WRONG_CHAIN', 'Use HyperEVM, chain 999.');
    await limiter.take(`auth-address:${account}`, 10, 15 * 60_000);
    const issuedAt = now();
    const expiresAt = issuedAt + 5 * 60_000;
    const challengeId = randomUUID();
    const nonce = randomBytes(16).toString('hex');
    const message = `${new URL(config.origin).host} wants you to sign in with your Ethereum account:\n${account}\n\nSign in to Riftwell to manage off-chain marketplace listings and cancel historical lending intents. This does not authorize transactions or move funds.\n\nURI: ${config.origin}\nVersion: 1\nChain ID: 999\nNonce: ${nonce}\nIssued At: ${iso(issuedAt)}\nExpiration Time: ${iso(expiresAt)}\nRequest ID: ${challengeId}`;
    await db.transaction(async () => {
      await db.run(
        'INSERT INTO challenges(id,address,chain_id,nonce,message,created_at,expires_at) VALUES (?,?,999,?,?,?,?)',
        challengeId,
        account,
        nonce,
        message,
        issuedAt,
        expiresAt,
      );
      await appendAudit(
        db,
        issuedAt,
        account,
        'auth.challenge-created',
        'auth',
        challengeId,
      );
    });
    return { challengeId, message, expiresAt: iso(expiresAt) };
  });

  app.post('/api/v1/auth/verify', async (request, reply) => {
    const body = fields(request.body, ['challengeId', 'signature']);
    const challengeId = uuid(body.challengeId, 'Challenge ID');
    if (
      typeof body.signature !== 'string' ||
      !/^0x[0-9a-fA-F]{128}(?:[0-9a-fA-F]{2})?$/.test(body.signature)
    )
      fail(
        400,
        'INVALID_SIGNATURE',
        'A valid EOA personal-sign signature is required.',
      );
    const challenge = await db.get<ChallengeRow>(
      'SELECT * FROM challenges WHERE id = ?',
      challengeId,
    );
    if (
      !challenge ||
      challenge.consumed_at !== null ||
      challenge.expires_at <= now()
    )
      fail(
        401,
        'CHALLENGE_INVALID',
        'The sign-in challenge is expired or already used.',
      );
    let recovered: string;
    try {
      recovered = verifyMessage(challenge.message, body.signature);
    } catch {
      fail(
        401,
        'SIGNATURE_REJECTED',
        'The wallet signature could not be verified.',
      );
    }
    if (!sameOwner(recovered, challenge.address))
      fail(
        401,
        'SIGNATURE_REJECTED',
        'The wallet signature could not be verified.',
      );
    const token = randomBytes(32).toString('hex');
    let expiresAt = 0;
    await db.transaction(async () => {
      // The distributed write lock can wait behind another instance. Evaluate
      // challenge expiry and session lifetime after acquiring it.
      const createdAt = now();
      expiresAt = createdAt + config.sessionTtlSeconds * 1000;
      const consumed = (
        await db.run(
          'UPDATE challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?',
          createdAt,
          challengeId,
          createdAt,
        )
      ).changes;
      if (consumed !== 1)
        fail(
          401,
          'CHALLENGE_INVALID',
          'The sign-in challenge is expired or already used.',
        );
      const previous = sessionToken(request);
      if (previous) {
        const removed = (
          await db.run(
            'DELETE FROM sessions WHERE token_hash = ?',
            hash(previous),
          )
        ).changes;
        if (removed)
          await appendAudit(
            db,
            createdAt,
            challenge.address,
            'auth.session-superseded',
            'auth',
            null,
          );
      }
      await db.run(
        'INSERT INTO sessions(token_hash,address,chain_id,csrf_hash,created_at,expires_at) VALUES (?,?,999,?,?,?)',
        hash(token),
        challenge.address,
        hash(`csrf:${csrfFor(token)}`),
        createdAt,
        expiresAt,
      );
      await appendAudit(
        db,
        createdAt,
        challenge.address,
        'auth.challenge-consumed',
        'auth',
        challengeId,
      );
      await appendAudit(
        db,
        createdAt,
        challenge.address,
        'auth.session-created',
        'auth',
        null,
      );
    });
    if (!bearer) reply.header('set-cookie', cookie(token, expiresAt));
    const session = sessionResponse(
      { address: challenge.address, chain_id: 999, expires_at: expiresAt },
      token,
    );
    return bearer ? { ...session, accessToken: token } : session;
  });

  app.get('/api/v1/auth/session', async (request) => {
    fields(request.query, []);
    const session = await requireSession(request);
    return sessionResponse(session, session.token);
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    fields(request.body, [], true);
    const session = await requireSession(request, true);
    await db.transaction(async () => {
      await requireSession(request, true);
      await db.run(
        'DELETE FROM sessions WHERE token_hash = ?',
        hash(session.token),
      );
      await appendAudit(
        db,
        now(),
        session.address,
        'auth.session-revoked',
        'auth',
        null,
      );
    });
    if (!bearer) reply.header('set-cookie', cookie('', 0, true));
    return { ok: true };
  });
  return requireSession;
}
