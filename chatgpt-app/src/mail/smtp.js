/**
 * SMTP クライアント。接続は cloudflare:sockets。
 * connect({hostname,port},{secureTransport:'on'|'starttls',allowHalfOpen:false})、各読み書きは 15 秒。
 * EHLO →（587 は STARTTLS）→ AUTH PLAIN、または秘密が oauth2: で始まるときは AUTH XOAUTH2
 * → MAIL FROM / RCPT TO / DATA（ドットスタッフィング）→ QUIT。
 * from / rcpt / data を省くとログイン確認だけで、メールは送らない。
 * DATA のあとで切れたら uncertain。再送しない。
 */

import { plainInitial, xoauth2Initial } from './auth.js';

const TIMEOUT_MS = 15000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function dotStuff(message) {
  const text = String(message ?? '').replace(/\r?\n/g, '\r\n');
  return text
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

async function readReply(transport, ms) {
  return withTimeout(transport.readReply(), ms);
}

async function command(transport, line, ms) {
  await withTimeout(transport.write(line), ms);
  return readReply(transport, ms);
}

export async function smtpSession(transport, options = {}) {
  const ms = options.timeoutMs || TIMEOUT_MS;
  let current = transport;
  let dataSent = false;
  const fail = (error, extra = {}) => ({ ok: false, error: String(error || 'smtp_failed'), ...extra });
  try {
    const greeting = await readReply(current, ms);
    if (greeting.code !== 220) return fail(`greeting ${greeting.code}`);
    const ehloName = options.ehloName || 'reply.kimitotalk.link';
    let ehlo = await command(current, `EHLO ${ehloName}`, ms);
    if (ehlo.code !== 250) return fail(`ehlo ${ehlo.code}`);
    if (options.secureTransport === 'starttls') {
      const start = await command(current, 'STARTTLS', ms);
      if (start.code !== 220) return fail(`starttls ${start.code}`);
      current = await current.startTls();
      ehlo = await command(current, `EHLO ${ehloName}`, ms);
      if (ehlo.code !== 250) return fail(`ehlo ${ehlo.code}`);
    }
    const secret = String(options.secret || '');
    const username = String(options.username || '');
    const authLine = secret.startsWith('oauth2:')
      ? `AUTH XOAUTH2 ${xoauth2Initial(username, secret.slice('oauth2:'.length))}`
      : `AUTH PLAIN ${plainInitial(username, secret)}`;
    const auth = await command(current, authLine, ms);
    if (auth.code !== 235 && auth.code !== 250) return fail((auth.lines || []).join(' '), { auth: true });
    const loginOnly = options.from == null && options.rcpt == null && options.data == null;
    if (loginOnly) {
      await command(current, 'QUIT', ms).catch(() => {});
      return { ok: true };
    }
    const mailed = await command(current, `MAIL FROM:<${options.from}>`, ms);
    if (mailed.code !== 250) return fail(`mail ${mailed.code}`);
    const recipients = Array.isArray(options.rcpt) ? options.rcpt : [options.rcpt];
    for (const recipient of recipients) {
      if (!recipient) continue;
      const accepted = await command(current, `RCPT TO:<${recipient}>`, ms);
      if (accepted.code !== 250 && accepted.code !== 251) return fail(`rcpt ${accepted.code}`);
    }
    const data = await command(current, 'DATA', ms);
    if (data.code !== 354) return fail(`data ${data.code}`);
    const payload = `${dotStuff(options.data)}\r\n.\r\n`;
    try {
      await withTimeout(current.writeRaw(payload), ms);
      dataSent = true;
      const accepted = await readReply(current, ms);
      if (accepted.code !== 250) return fail(`data rejected ${accepted.code}`);
    } catch (error) {
      return fail(error.timeout ? 'timeout' : 'disconnected_after_data', { uncertain: true });
    }
    await command(current, 'QUIT', ms).catch(() => {});
    return { ok: true };
  } catch (error) {
    if (dataSent) return fail('disconnected_after_data', { uncertain: true });
    return fail(error.timeout ? 'timeout' : error.message || 'smtp_failed');
  } finally {
    try {
      await current.close?.();
    } catch {
      /* 切断は結果を変えない */
    }
  }
}

export function wrapSocket(socket) {
  const decoder = new TextDecoder();
  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  let buffer = '';
  const transport = {
    async readLine() {
      while (!buffer.includes('\n')) {
        const { value, done } = await reader.read();
        if (done) {
          if (!buffer) throw Object.assign(new Error('closed'), { closed: true });
          const rest = buffer.replace(/\r$/, '');
          buffer = '';
          return rest;
        }
        buffer += decoder.decode(value, { stream: true });
      }
      const index = buffer.indexOf('\n');
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      return line;
    },
    async readReply() {
      const lines = [];
      while (true) {
        const line = await this.readLine();
        lines.push(line);
        if (line.length < 4 || line[3] === ' ') break;
      }
      return { code: Number(lines[0].slice(0, 3)), lines };
    },
    async write(line) {
      await writer.write(new TextEncoder().encode(`${line}\r\n`));
    },
    async writeRaw(text) {
      await writer.write(new TextEncoder().encode(text));
    },
    async startTls() {
      reader.releaseLock();
      writer.releaseLock();
      return wrapSocket(socket.startTls());
    },
    async close() {
      try {
        await writer.close();
      } catch {
        /* already closed */
      }
      try {
        await socket.close?.();
      } catch {
        /* already closed */
      }
    }
  };
  return transport;
}

export async function openSmtpTransport(host, port, secureTransport) {
  const { connect } = await import('cloudflare:sockets');
  const socket = connect({ hostname: host, port: Number(port) }, { secureTransport, allowHalfOpen: false });
  return wrapSocket(socket);
}
