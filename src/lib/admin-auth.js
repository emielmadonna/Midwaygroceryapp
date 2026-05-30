import crypto from 'node:crypto';

const SESSION_TTL_HOURS = 12;
const OWNER_ROLE = 'owner';
const EMPLOYEE_ROLE = 'employee';

export function createAdminAuthService({ env = process.env, now = () => new Date(), apiTokenService = null } = {}) {
  const users = loadAdminUsers(env);
  const secret = readEnv(env, 'ADMIN_SESSION_SECRET')
    || readEnv(env, 'ADMIN_OWNER_TOKEN')
    || readEnv(env, 'MIDWAY_ADMIN_TOKEN')
    || 'midway-local-session-secret';

  return {
    users,
    async login({ email, password } = {}) {
      const normalizedEmail = normalizeEmail(email);
      const user = users.find(candidate => normalizeEmail(candidate.email) === normalizedEmail);
      if (!user || user.disabled || !await verifyPassword(password, user.passwordHash, env)) {
        const error = new Error('Email or password is incorrect.');
        error.statusCode = 401;
        error.code = 'ADMIN_LOGIN_FAILED';
        throw error;
      }

      const issuedAt = Math.floor(now().getTime() / 1000);
      const expiresAt = issuedAt + SESSION_TTL_HOURS * 60 * 60;
      const sessionUser = publicUser(user);
      const token = signSession({ user: sessionUser, iat: issuedAt, exp: expiresAt }, secret);
      return {
        token,
        user: sessionUser,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      };
    },
    async authenticateRequest(req) {
      const token = readRequestToken(req);
      if (!token) return null;

      if (token.startsWith('mw_live_') || token.startsWith('mw_test_')) {
        if (!apiTokenService) return null;
        try {
          return await apiTokenService.authenticate(token);
        } catch {
          return null;
        }
      }

      const session = verifySession(token, secret, now());
      if (!session?.user?.email) return null;

      const user = users.find(candidate => normalizeEmail(candidate.email) === normalizeEmail(session.user.email));
      if (!user || user.disabled || user.role !== session.user.role) return null;

      return {
        ...publicUser(user),
        actorType: 'session',
        sessionExpiresAt: new Date(session.exp * 1000).toISOString(),
      };
    },
  };
}

export function requireAdminRole(user, allowedRoles = [OWNER_ROLE, EMPLOYEE_ROLE]) {
  if (!user) {
    const error = new Error('Admin authentication is required.');
    error.statusCode = 401;
    error.code = 'ADMIN_AUTH_REQUIRED';
    throw error;
  }

  if (!allowedRoles.includes(user.role)) {
    const error = new Error('This action requires owner permission.');
    error.statusCode = 403;
    error.code = 'OWNER_PERMISSION_REQUIRED';
    throw error;
  }
}

export function assertProductionAdminAuth(env = process.env) {
  if (readEnv(env, 'NODE_ENV') !== 'production') return;
  const users = loadAdminUsers(env, { includeDevUser: false });
  if (!users.some(user => user.role === OWNER_ROLE && !user.disabled)) {
    throw new Error('Production runtime is not configured: at least one owner admin user is required.');
  }
  if (!readEnv(env, 'ADMIN_SESSION_SECRET')) {
    throw new Error('Production runtime is not configured: ADMIN_SESSION_SECRET is required.');
  }
  for (const user of users) {
    if (!user.passwordHash?.startsWith('pbkdf2$')) {
      throw new Error('Production runtime is not configured: admin users must use pbkdf2 password hashes.');
    }
  }
}

export function hashAdminPassword(password, { salt = crypto.randomBytes(16).toString('hex'), iterations = 210000 } = {}) {
  if (!password || typeof password !== 'string') throw new Error('Password is required.');
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

async function verifyPassword(password, passwordHash, env) {
  if (!password || !passwordHash) return false;
  if (!passwordHash.startsWith('pbkdf2$')) {
    const actual = Buffer.from(String(password));
    const expected = Buffer.from(String(passwordHash));
    return readEnv(env, 'NODE_ENV') !== 'production'
      && actual.length === expected.length
      && crypto.timingSafeEqual(actual, expected);
  }

  const [, iterationsRaw, salt, expected] = passwordHash.split('$');
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function loadAdminUsers(env, { includeDevUser = true } = {}) {
  const configured = parseAdminUsers(readEnv(env, 'ADMIN_USERS_JSON'));
  const owner = buildEnvUser({
    id: 'owner',
    role: OWNER_ROLE,
    email: readEnv(env, 'ADMIN_OWNER_EMAIL'),
    name: readEnv(env, 'ADMIN_OWNER_NAME') || 'Owner',
    passwordHash: readEnv(env, 'ADMIN_OWNER_PASSWORD_HASH') || readEnv(env, 'ADMIN_OWNER_PASSWORD'),
    disabled: readEnv(env, 'ADMIN_OWNER_DISABLED') === 'true',
  });
  const employee = buildEnvUser({
    id: 'employee',
    role: EMPLOYEE_ROLE,
    email: readEnv(env, 'ADMIN_EMPLOYEE_EMAIL'),
    name: readEnv(env, 'ADMIN_EMPLOYEE_NAME') || 'Employee',
    passwordHash: readEnv(env, 'ADMIN_EMPLOYEE_PASSWORD_HASH') || readEnv(env, 'ADMIN_EMPLOYEE_PASSWORD'),
    disabled: readEnv(env, 'ADMIN_EMPLOYEE_DISABLED') === 'true',
  });

  const users = [...configured, owner, employee].filter(Boolean);
  if (users.length === 0 && includeDevUser && readEnv(env, 'NODE_ENV') !== 'production' && readEnv(env, 'ADMIN_DISABLE_DEV_USER') !== 'true') {
    users.push({
      id: 'dev-owner',
      email: 'admin@midway.local',
      name: 'Dev Owner',
      role: OWNER_ROLE,
      passwordHash: 'midway-dev-owner',
      disabled: false,
    });
  }

  return users;
}

function parseAdminUsers(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((user, index) => buildEnvUser({
      id: user.id || `admin-${index + 1}`,
      email: user.email,
      name: user.name || user.email,
      role: user.role,
      passwordHash: user.passwordHash || user.password,
      disabled: user.disabled === true,
    })).filter(Boolean);
  } catch {
    return [];
  }
}

function buildEnvUser({ id, email, name, role, passwordHash, disabled }) {
  if (!email || !passwordHash || ![OWNER_ROLE, EMPLOYEE_ROLE].includes(role)) return null;
  return {
    id,
    email,
    name,
    role,
    passwordHash,
    disabled: Boolean(disabled),
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

function signSession(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySession(token, secret, now) {
  const [encoded, signature] = String(token).split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp <= Math.floor(now.getTime() / 1000)) return null;
  return payload;
}

function readRequestToken(req) {
  const authHeader = req.get?.('authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1].trim();
  return '';
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : value;
}
