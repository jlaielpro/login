import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const scryptAsync = promisify(scrypt);

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@bd.local').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Administrator';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ *
 * Database
 * ------------------------------------------------------------------ */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ------------------------------------------------------------------ *
 * Passwords & sessions
 * ------------------------------------------------------------------ */

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, keyHex] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(keyHex, 'hex');
    const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === key.length && timingSafeEqual(expected, key);
  } catch {
    return false;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const { error } = await supabase.from('sessions').insert({
    token_hash: sha256(token),
    user_id: userId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + SESSION_MS).toISOString(),
  });
  if (error) throw error;
  return token;
}

function readCookie(header, name) {
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

function sessionCookie(req, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https';
  return [
    `sid=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function clearSessionCookie() {
  return 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

async function getSessionUser(req) {
  const token = readCookie(req.headers.cookie || '', 'sid');
  if (!token) return null;

  const tokenHash = sha256(token);
  const { data, error } = await supabase
    .from('sessions')
    .select('expires_at, users(id, name, email, role, created_at, last_login_at)')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (Date.parse(data.expires_at) <= Date.now()) {
    await supabase.from('sessions').delete().eq('token_hash', tokenHash);
    return null;
  }

  return data.users || null;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(body);
}

function sendHtml(res, status, html, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    ...SECURITY_HEADERS,
    ...headers,
  });
  res.end(html);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...SECURITY_HEADERS,
  });
  res.end(text);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, ...SECURITY_HEADERS });
  res.end();
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

/* Basic in-memory rate limiting for the auth endpoints. */
const attempts = new Map();

function isRateLimited(key, limit = 20, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

setInterval(async () => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
  try {
    await supabase.from('sessions').delete().lte('expires_at', new Date(now).toISOString());
  } catch (e) {
    // ignore cleanup errors
  }
}, 60 * 60 * 1000).unref();

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function validateSignup(body) {
  const fields = {};
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  if (name.length < 2 || name.length > 80) {
    fields.name = 'Name must be between 2 and 80 characters.';
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    fields.email = 'Enter a valid email address.';
  }
  if (password.length < 8) {
    fields.password = 'Password must be at least 8 characters.';
  } else if (password.length > 200) {
    fields.password = 'Password must be at most 200 characters.';
  }

  if (Object.keys(fields).length) {
    throw new HttpError(422, Object.values(fields)[0], fields);
  }

  return { name, email, password };
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/me' && method === 'GET') {
    const user = await getSessionUser(req);
    return sendJson(res, 200, { user: user || null });
  }

  if (pathname === '/api/signup' && method === 'POST') {
    if (isRateLimited(`signup:${req.socket.remoteAddress}`, 10)) {
      return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    }

    const body = await readJson(req);
    const { name, email, password } = validateSignup(body);

    const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (existing) {
      return sendJson(res, 409, {
        error: 'An account with that email already exists.',
        fields: { email: 'An account with that email already exists.' },
      });
    }

    const passwordHash = await hashPassword(password);
    const { error } = await supabase.from('users').insert({
      name,
      email,
      password_hash: passwordHash,
      role: 'user',
      created_at: new Date().toISOString(),
    });
    if (error) throw error;

    return sendJson(res, 201, { ok: true, message: 'Account created. You can sign in now.' });
  }

  if (pathname === '/api/login' && method === 'POST') {
    if (isRateLimited(`login:${req.socket.remoteAddress}`)) {
      return sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    }

    const body = await readJson(req);
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');

    if (!email || !password) {
      return sendJson(res, 422, { error: 'Enter your email and password.' });
    }

    const { data: account } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    const valid = account ? await verifyPassword(password, account.password_hash) : false;

    if (!account || !valid) {
      return sendJson(res, 401, { error: 'Wrong email or password.' });
    }

    const token = await createSession(account.id);
    const now = new Date().toISOString();
    await supabase.from('users').update({ last_login_at: now }).eq('id', account.id);

    return sendJson(
      res,
      200,
      {
        ok: true,
        user: {
          id: account.id,
          name: account.name,
          email: account.email,
          role: account.role,
          created_at: account.created_at,
          last_login_at: now,
        },
      },
      { 'Set-Cookie': sessionCookie(req, token) },
    );
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = readCookie(req.headers.cookie || '', 'sid');
    if (token) {
      await supabase.from('sessions').delete().eq('token_hash', sha256(token));
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  if (pathname === '/api/admin/users' && method === 'GET') {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: 'Not signed in.' });
    if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admins only.' });

    const { data: users, error } = await supabase
      .from('users')
      .select('id, name, email, role, created_at, last_login_at')
      .order('id', { ascending: true });
    if (error) throw error;

    return sendJson(res, 200, { users: users || [] });
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (deleteMatch && method === 'DELETE') {
    const user = await getSessionUser(req);
    if (!user) return sendJson(res, 401, { error: 'Not signed in.' });
    if (user.role !== 'admin') return sendJson(res, 403, { error: 'Admins only.' });

    const id = Number(deleteMatch[1]);
    if (id === user.id) {
      return sendJson(res, 400, { error: 'You cannot delete your own account.' });
    }

    const { data: target } = await supabase.from('users').select('id').eq('id', id).maybeSingle();
    if (!target) return sendJson(res, 404, { error: 'User not found.' });

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found.' });
}

/* ------------------------------------------------------------------ *
 * Static files
 * ------------------------------------------------------------------ */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? '/login.html' : pathname;
  if (relative === '/admin') relative = '/admin.html';

  const filePath = normalize(join(PUBLIC_DIR, relative));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    return sendText(res, 403, 'Forbidden');
  }

  if (relative === '/admin.html') {
    const user = await getSessionUser(req);
    if (!user || user.role !== 'admin') return redirect(res, '/login.html?next=admin');
  }

  let content;
  try {
    content = await readFile(filePath);
  } catch {
    return sendText(res, 404, 'Not found');
  }

  const type = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const isHtml = type.startsWith('text/html');

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': content.length,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=0, must-revalidate',
    ...(isHtml
      ? {
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
        }
      : {}),
    ...SECURITY_HEADERS,
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method Not Allowed');
    }

    return await serveStatic(req, res, pathname);
  } catch (error) {
    if (error instanceof HttpError) {
      if (!res.headersSent) sendJson(res, error.status, { error: error.message, fields: error.fields });
      else res.end();
      return;
    }
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
    else res.end();
  }
});

/* Seed the admin account once. */
async function ensureAdmin() {
  const { data: existing } = await supabase.from('users').select('id, role').eq('email', ADMIN_EMAIL).maybeSingle();

  if (existing) {
    if (existing.role !== 'admin') {
      await supabase.from('users').update({ role: 'admin' }).eq('id', existing.id);
      console.log(`Promoted ${ADMIN_EMAIL} to admin.`);
    }
    return;
  }

  const passwordHash = hashPasswordSync(ADMIN_PASSWORD);
  await supabase.from('users').insert({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password_hash: passwordHash,
    role: 'admin',
    created_at: new Date().toISOString(),
  });

  console.log('Created the admin account:');
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
  console.log('  (set ADMIN_EMAIL / ADMIN_PASSWORD before the first run to change these)');
}

function hashPasswordSync(password) {
  // The admin account is seeded before the server starts listening,
  // so blocking here keeps startup ordering simple.
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

ensureAdmin()
  .then(() => supabase.from('sessions').delete().lte('expires_at', new Date().toISOString()))
  .catch((err) => console.error('Failed to initialize admin:', err));

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  BD is running at http://${HOST}:${PORT}`);
  console.log(`  Database: Supabase Postgres`);
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Start with a different port, e.g. PORT=3001 node server.js`);
    process.exit(1);
  }
  throw error;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
