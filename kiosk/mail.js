// Minimal SMTP client: plain SMTP on port 25, no TLS, no login (internal relay of the school).
'use strict';
const net = require('net');
const crypto = require('crypto');
const os = require('os');

const MAIL_HOST = process.env.MAIL_HOST || 'es-vs01.ict-tfbern.ch';
const MAIL_PORT = Number(process.env.MAIL_PORT || 25);
const MAIL_FROM = process.env.MAIL_FROM || 'pfsense@ict-tfbern.ch';
const FROM_NAME = 'KI-Bildgenerator TF Bern';

// Simple, strict address check (no quotes, no comments, no spaces, no line breaks).
const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const validEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s);

const b64Lines = (buf) => buf.toString('base64').replace(/.{76}/g, '$&\r\n');
const encodeWord = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;

function buildMessage({ to, subject, text, attachment }) {
  const boundary = 'kiosk_' + crypto.randomBytes(12).toString('hex');
  const domain = MAIL_FROM.split('@')[1];
  const headers = [
    `From: ${encodeWord(FROM_NAME)} <${MAIL_FROM}>`,
    `To: <${to}>`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(Buffer.from(text.replace(/\r?\n/g, '\r\n'))),
    `--${boundary}`,
    `Content-Type: ${attachment.type}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    b64Lines(attachment.data),
    `--${boundary}--`,
    '',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n');
}

// Talk SMTP step by step. `dryRun` stops after RCPT TO (checks the relay without sending).
function smtp(to, message, { dryRun = false, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(MAIL_PORT, MAIL_HOST);
    socket.setTimeout(timeout);
    let buffer = '';
    let waiting = null;
    const fail = (e) => { socket.destroy(); reject(e); };
    socket.on('timeout', () => fail(new Error('Zeitüberschreitung beim Mailserver')));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      // A reply is complete when a line has "code<space>" (multi-line replies use "code-").
      const m = buffer.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (m && waiting) {
        const reply = { code: Number(m[1]), text: buffer.trim() };
        buffer = '';
        const w = waiting;
        waiting = null;
        w(reply);
      }
    });
    const expect = (ok) => new Promise((res, rej) => {
      waiting = (r) => (ok.includes(r.code) ? res(r) : rej(new Error(`Mailserver: ${r.text.split('\r\n').pop()}`)));
    });
    const send = (line, ok) => { const p = expect(ok); socket.write(line + '\r\n'); return p; };

    (async () => {
      await expect([220]);
      await send(`EHLO ${os.hostname() || 'kiosk'}`, [250]);
      await send(`MAIL FROM:<${MAIL_FROM}>`, [250]);
      await send(`RCPT TO:<${to}>`, [250, 251]);
      if (dryRun) {
        await send('RSET', [250]);
      } else {
        await send('DATA', [354]);
        // Dot-stuffing: lines starting with "." get a second one.
        await send(message.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
      }
      await send('QUIT', [221]).catch(() => {});
      socket.end();
      resolve();
    })().catch(fail);
  });
}

// ComfyUI writes the whole workflow into PNG text chunks: drop them before the image leaves the school.
function stripPngText(buf) {
  const SIG = 8;
  if (buf.length < SIG || buf.readUInt32BE(0) !== 0x89504e47) return buf;
  const keep = [buf.subarray(0, SIG)];
  let pos = SIG;
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + len;
    if (end > buf.length) return buf; // broken file: send as it is
    if (!['tEXt', 'iTXt', 'zTXt'].includes(type)) keep.push(buf.subarray(pos, end));
    pos = end;
  }
  return Buffer.concat(keep);
}

async function sendImage({ to, prompt, data, type }) {
  if (type === 'image/png') data = stripPngText(data);
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  const text = [
    'Hallo',
    '',
    'Im Anhang findest du das Bild, das du am Tag der offenen Tür der Technischen Fachschule Bern mit dem KI-Bildgenerator erstellt hast.',
    '',
    prompt ? `Deine Beschreibung: «${prompt}»` : null,
    prompt ? '' : null,
    'Das Bild wurde von einer KI (FLUX) auf einem Server der TF Bern gemalt.',
    '',
    'Mehr über die Technische Fachschule Bern: https://www.tfbern.ch',
    '',
    'Freundliche Grüsse',
    'Technische Fachschule Bern',
    '',
    '(Diese Mail wurde automatisch verschickt. Bitte nicht darauf antworten.)',
  ].filter((l) => l !== null).join('\n');
  const message = buildMessage({
    to,
    subject: 'Dein KI-Bild vom Tag der offenen Tür',
    text,
    attachment: { filename: `ki-bild-tfbern.${ext}`, type, data },
  });
  await smtp(to, message);
}

module.exports = { sendImage, smtp, validEmail, MAIL_HOST, MAIL_PORT, MAIL_FROM };
