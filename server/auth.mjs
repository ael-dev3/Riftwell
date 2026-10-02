import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { appendAudit } from './database.mjs';
import { fail } from './errors.mjs';
import { fields, address, uuid, sameOwner } from './validation.mjs';

const iso = (time) => new Date(time).toISOString();

export function registerAuth(app, ctx) {
  const { db, config, now, hash, limiter } = ctx;
  const cookieName = config.production
    ? '__Host-riftwell_session'
    : 'riftwell_session';
  const cookieToken = (request) => {
    const cookies = request.headers.cookie;
    if (!cookies || cookies.length > 4096) return null;
    const pairs = cookies.split(';').map((value) => value.trim().split('='));
    const matches = pairs.filter(([key]) => key === cookieName);
    if (matches.length !== 1 || !/^[0-9a-f]{64}$/.test(matches[0][1] ?? ''))
      return null;
    return matches[0][1];
  };
  const csrfFor = (token) => hash(`csrf-token:${token}`);
  const cookie = (token, expiresAt, clear = false) =>
    `${cookieName}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict${config.production ? '; Secure' : ''}; Max-Age=${clear ? 0 : Math.max(0, Math.floor((expiresAt - now()) / 1000))}; Expires=${new Date(clear ? 0 : expiresAt).toUTCString()}`;
  const sessionResponse = (row, token) => ({
    address: row.address,
    chainId: row.chain_id,
    csrfToken: csrfFor(token),
    expiresAt: iso(row.expires_at),
  });
  const requireSession = (request, mutation = false) => {
    const token = cookieToken(request);
    const row =
      token &&
      db
        .prepare(
          'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
        )
        .get(hash(token), now());
    if (!row)
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
  ctx.requireSession = requireSession;

  app.post('/api/v1/auth/challenge', async (request) => {
    const body = fields(request.body, ['address', 'chainId']);
    const account = address(body.address);
    if (body.chainId !== 999)
      fail(400, 'WRONG_CHAIN', 'Use HyperEVM, chain 999.');
    limiter.take(`auth-address:${account}`, 10, 15 * 60_000);
    const issuedAt = now();
    const expiresAt = issuedAt + 5 * 60_000;
    const challengeId = randomUUID();
    const nonce = randomBytes(16).toString('hex');
    const message = `${new URL(config.origin).host} wants you to sign in with your Ethereum account:\n${account}\n\nSign in to Riftwell to manage off-chain marketplace listings and cancel historical lending intents. This does not authorize transactions or move funds.\n\nURI: ${config.origin}\nVersion: 1\nChain ID: 999\nNonce: ${nonce}\nIssued At: ${iso(issuedAt)}\nExpiration Time: ${iso(expiresAt)}\nRequest ID: ${challengeId}`;
    db.transaction(() => {
      db.prepare(
        'INSERT INTO challenges(id,address,chain_id,nonce,message,created_at,expires_at) VALUES (?,?,999,?,?,?,?)',
      ).run(challengeId, account, nonce, message, issuedAt, expiresAt);
      appendAudit(
        db,
        issuedAt,
        account,
        'auth.challenge-created',
        'auth',
        challengeId,
      );
    })();
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
    const challenge = db
      .prepare('SELECT * FROM challenges WHERE id = ?')
      .get(challengeId);
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
    let recovered;
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
    const createdAt = now();
    const expiresAt = createdAt + config.sessionTtlSeconds * 1000;
    const session = {
      address: challenge.address,
      chain_id: 999,
      expires_at: expiresAt,
    };
    db.transaction(() => {
      const consumed = db
        .prepare(
          'UPDATE challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?',
        )
        .run(createdAt, challengeId, createdAt).changes;
      if (consumed !== 1)
        fail(
          401,
          'CHALLENGE_INVALID',
          'The sign-in challenge is expired or already used.',
        );
      const previous = cookieToken(request);
      if (previous) {
        const removed = db
          .prepare('DELETE FROM sessions WHERE token_hash = ?')
          .run(hash(previous)).changes;
        if (removed)
          appendAudit(
            db,
            createdAt,
            challenge.address,
            'auth.session-superseded',
            'auth',
            null,
          );
      }
      db.prepare(
        'INSERT INTO sessions(token_hash,address,chain_id,csrf_hash,created_at,expires_at) VALUES (?,?,999,?,?,?)',
      ).run(
        hash(token),
        challenge.address,
        hash(`csrf:${csrfFor(token)}`),
        createdAt,
        expiresAt,
      );
      appendAudit(
        db,
        createdAt,
        challenge.address,
        'auth.challenge-consumed',
        'auth',
        challengeId,
      );
      appendAudit(
        db,
        createdAt,
        challenge.address,
        'auth.session-created',
        'auth',
        null,
      );
    })();
    reply.header('set-cookie', cookie(token, expiresAt));
    return sessionResponse(session, token);
  });

  app.get('/api/v1/auth/session', async (request) => {
    fields(request.query, []);
    const session = requireSession(request);
    return sessionResponse(session, session.token);
  });
  app.post('/api/v1/auth/logout', async (request, reply) => {
    fields(request.body, [], true);
    const session = requireSession(request, true);
    db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(
        hash(session.token),
      );
      appendAudit(
        db,
        now(),
        session.address,
        'auth.session-revoked',
        'auth',
        null,
      );
    })();
    reply.header('set-cookie', cookie('', 0, true));
    return { ok: true };
  });
}
