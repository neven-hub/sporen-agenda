/**
 * Versleuteling in de browser (WebCrypto). De opslag (Supabase) en de website
 * (GitHub Pages) zien alleen onleesbare tekens.
 *
 * Opbouw:
 * - Elke persoon heeft een sleutelpaar (ECDH P-256). De publieke sleutel staat
 *   leesbaar in het profiel; de private sleutel staat versleuteld met een
 *   sleutel die uit het wachtwoord wordt afgeleid (PBKDF2). Het wachtwoord
 *   verlaat het toestel nooit in een vorm waarmee je de private sleutel opent.
 * - Elke "ruimte" (privé, begeleiding, team, gedeeld) heeft één AES-GCM-sleutel.
 *   Die sleutel wordt per lid "ingepakt" met de publieke sleutel van dat lid.
 * - Een afspraak wordt versleuteld met de sleutel van zijn ruimte.
 */

export const PBKDF2_ITERATIES = 600_000;

export interface Pakket {
  /** base64 */
  iv: string;
  /** base64 */
  ct: string;
}

export interface IngepakteSleutel extends Pakket {
  /** Tijdelijke publieke sleutel (JWK) van de inpakker */
  epk: JsonWebKey;
}

const tekst = new TextEncoder();
const lees = new TextDecoder();

function cryptoApi(): Crypto {
  return globalThis.crypto;
}

export function naarBase64(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export function uitBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

export function willekeurig(n: number): Uint8Array<ArrayBuffer> {
  return cryptoApi().getRandomValues(new Uint8Array(n));
}

// ── Wachtwoord → sleutel ────────────────────────────────────────────────────

export async function sleutelUitWachtwoord(
  wachtwoord: string,
  zout: Uint8Array<ArrayBuffer>,
  iteraties = PBKDF2_ITERATIES,
): Promise<CryptoKey> {
  const basis = await cryptoApi().subtle.importKey('raw', tekst.encode(wachtwoord), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return cryptoApi().subtle.deriveKey(
    { name: 'PBKDF2', salt: zout, iterations: iteraties, hash: 'SHA-256' },
    basis,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── Symmetrisch ─────────────────────────────────────────────────────────────

export async function versleutelBytes(sleutel: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Pakket> {
  const iv = willekeurig(12);
  const ct = await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv }, sleutel, data);
  return { iv: naarBase64(iv), ct: naarBase64(ct) };
}

export async function ontsleutelBytes(sleutel: CryptoKey, p: Pakket): Promise<Uint8Array<ArrayBuffer>> {
  const pt = await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: uitBase64(p.iv) }, sleutel, uitBase64(p.ct));
  return new Uint8Array(pt);
}

export async function versleutelJson(sleutel: CryptoKey, waarde: unknown): Promise<Pakket> {
  return versleutelBytes(sleutel, tekst.encode(JSON.stringify(waarde)));
}

export async function ontsleutelJson<T>(sleutel: CryptoKey, p: Pakket): Promise<T> {
  return JSON.parse(lees.decode(await ontsleutelBytes(sleutel, p))) as T;
}

// ── Ruimtesleutels ──────────────────────────────────────────────────────────

export async function nieuweRuimteSleutel(): Promise<CryptoKey> {
  return cryptoApi().subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// ── Sleutelparen ────────────────────────────────────────────────────────────

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export interface Sleutelpaar {
  publiek: CryptoKey;
  prive: CryptoKey;
}

export async function nieuwSleutelpaar(): Promise<Sleutelpaar> {
  const kp = await cryptoApi().subtle.generateKey(ECDH, true, ['deriveKey']);
  return { publiek: kp.publicKey, prive: kp.privateKey };
}

export async function exporteerPubliek(k: CryptoKey): Promise<JsonWebKey> {
  const jwk = await cryptoApi().subtle.exportKey('jwk', k);
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

export async function importeerPubliek(jwk: JsonWebKey): Promise<CryptoKey> {
  return cryptoApi().subtle.importKey('jwk', jwk, ECDH, true, []);
}

/** Private sleutel versleuteld bewaren met de wachtwoordsleutel. */
export async function bewaarPrive(prive: CryptoKey, wachtwoordSleutel: CryptoKey): Promise<Pakket> {
  const pkcs8 = await cryptoApi().subtle.exportKey('pkcs8', prive);
  return versleutelBytes(wachtwoordSleutel, new Uint8Array(pkcs8));
}

export async function openPrive(p: Pakket, wachtwoordSleutel: CryptoKey): Promise<CryptoKey> {
  const pkcs8 = await ontsleutelBytes(wachtwoordSleutel, p);
  return cryptoApi().subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveKey']);
}

async function gedeeldeSleutel(prive: CryptoKey, publiek: CryptoKey): Promise<CryptoKey> {
  return cryptoApi().subtle.deriveKey({ name: 'ECDH', public: publiek }, prive, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/** Pak een ruimtesleutel in voor één lid (ECIES: tijdelijk sleutelpaar + AES-GCM). */
export async function pakIn(ruimteSleutel: CryptoKey, ontvanger: CryptoKey): Promise<IngepakteSleutel> {
  const tijdelijk = await nieuwSleutelpaar();
  const k = await gedeeldeSleutel(tijdelijk.prive, ontvanger);
  const raw = new Uint8Array(await cryptoApi().subtle.exportKey('raw', ruimteSleutel));
  const p = await versleutelBytes(k, raw);
  return { ...p, epk: await exporteerPubliek(tijdelijk.publiek) };
}

export async function pakUit(ingepakt: IngepakteSleutel, mijnPrive: CryptoKey): Promise<CryptoKey> {
  const k = await gedeeldeSleutel(mijnPrive, await importeerPubliek(ingepakt.epk));
  const raw = await ontsleutelBytes(k, ingepakt);
  return cryptoApi().subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
