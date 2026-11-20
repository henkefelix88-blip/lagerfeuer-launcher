/**
 * Party-Code: kodiert IPv4-Adresse + Port des Party-Hosts in einen kurzen, gut abtippbaren Code.
 * Es wird KEIN externer Server benötigt – der Code IST die Adresse (plus Prüfsumme gegen Tippfehler).
 *
 * Aufbau: 7 Bytes = [IP1, IP2, IP3, IP4, PortHi, PortLo, Prüfsumme] → Crockford-Base32 → "XXXX-XXXX-XXXX"
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford (ohne I, L, O, U)

function checksum(bytes) {
  let c = 0x5a;
  for (let i = 0; i < bytes.length; i++) c = ((c * 31) ^ (bytes[i] + i * 7)) & 0xff;
  return c;
}

/** @returns {string} z. B. "3ZK8-1M0Q-7AHT" */
export function encodePartyCode(ip, port) {
  const parts = String(ip).trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) throw new Error('Ungültige IPv4-Adresse');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ungültiger Port');
  const bytes = [...parts, port >> 8, port & 0xff];
  bytes.push(checksum(bytes));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  n <<= 4n; // 56 Bit → 60 Bit = 12 Zeichen
  let out = '';
  for (let i = 11; i >= 0; i--) out += ALPHABET[Number((n >> BigInt(i * 5)) & 31n)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/** @returns {{address:string, port:number} | null} */
export function decodePartyCode(code) {
  const clean = String(code).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== 12) return null;
  let n = 0n;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = (n << 5n) | BigInt(v);
  }
  n >>= 4n;
  const bytes = [];
  for (let i = 6; i >= 0; i--) bytes.push(Number((n >> BigInt(i * 8)) & 0xffn));
  if (checksum(bytes.slice(0, 6)) !== bytes[6]) return null;
  return { address: bytes.slice(0, 4).join('.'), port: (bytes[4] << 8) | bytes[5] };
}

/**
 * Akzeptiert Party-Code ODER "ip:port" / "hostname:port" (direkte Eingabe).
 * @returns {{address:string, port:number} | null}
 */
export function parseJoinTarget(input, defaultPort) {
  const s = String(input).trim();
  const decoded = decodePartyCode(s);
  if (decoded) return decoded;
  const m = s.match(/^([a-zA-Z0-9.\-]+)(?::(\d{1,5}))?$/);
  if (m && (m[1].includes('.') || m[1] === 'localhost')) {
    const port = m[2] ? Number(m[2]) : defaultPort;
    if (port > 0 && port < 65536) return { address: m[1], port };
  }
  return null;
}
