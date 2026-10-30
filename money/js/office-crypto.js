// 비밀번호가 걸린 엑셀(xlsx) 풀기 — 브라우저 안에서만, 파일과 비밀번호는 밖으로 나가지 않음
// 암호화된 xlsx는 CFB(옛 오피스 파일 상자) 안에 EncryptionInfo와 EncryptedPackage가 들어 있음 (ECMA-376 Agile / Standard).
// 비밀번호 → (해시 10만 번 반복) → 키 → 실제 파일 키 → 4096바이트씩 AES로 풀면 보통 xlsx(zip)가 나옴.
// 해시 반복은 WebCrypto로 하면 너무 느려서(수 초) SHA-512·SHA-1을 여기서 직접 계산함.

const subtle = globalThis.crypto.subtle;

/* ---------- 바이트 ---------- */
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const le32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const utf16 = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 255; b[i * 2 + 1] = s.charCodeAt(i) >> 8; } return b; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/* ---------- 빠른 해시 (동기) ---------- */
const K512 = [
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc, 0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2, 0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65, 0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4, 0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df, 0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30, 0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8, 0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec, 0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178, 0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c, 0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
];
const H512 = [0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1, 0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179];
const W = new Int32Array(160);
function sha512(msg) {
  const len = msg.length, total = Math.ceil((len + 17) / 128) * 128;
  const m = new Uint8Array(total);
  m.set(msg); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, len * 8); dv.setUint32(total - 8, Math.floor(len / 0x20000000));
  const h = Int32Array.from(H512);
  for (let off = 0; off < total; off += 128) {
    for (let i = 0; i < 32; i++) W[i] = dv.getInt32(off + i * 4);
    for (let i = 32; i < 160; i += 2) {
      // σ0(W[t-15]), σ1(W[t-2]) — 64비트 값을 [높은 32, 낮은 32]로 나눠 계산
      let xh = W[i - 30], xl = W[i - 29];
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      xh = W[i - 4]; xl = W[i - 3];
      const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
      const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
      let lo = (s0l >>> 0) + (s1l >>> 0) + (W[i - 13] >>> 0) + (W[i - 31] >>> 0);
      W[i] = (s0h + s1h + W[i - 14] + W[i - 32] + Math.floor(lo / 0x100000000)) | 0;
      W[i + 1] = lo | 0;
    }
    let [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl] = h;
    for (let i = 0; i < 160; i += 2) {
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
      let t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i + 1] >>> 0) + (W[i + 1] >>> 0);
      const t1h = (hh + S1h + chh + K512[i] + W[i] + Math.floor(t1l / 0x100000000)) | 0;
      t1l |= 0;
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = (S0h + mjh + Math.floor(t2l / 0x100000000)) | 0;
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      const el2 = (dl >>> 0) + (t1l >>> 0);
      eh = (dh + t1h + Math.floor(el2 / 0x100000000)) | 0; el = el2 | 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      const al2 = (t1l >>> 0) + (t2l >>> 0);
      ah = (t1h + t2h + Math.floor(al2 / 0x100000000)) | 0; al = al2 | 0;
    }
    const v = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
    for (let i = 0; i < 16; i += 2) {
      const lo = (h[i + 1] >>> 0) + (v[i + 1] >>> 0);
      h[i] = (h[i] + v[i] + Math.floor(lo / 0x100000000)) | 0; h[i + 1] = lo | 0;
    }
  }
  const out = new Uint8Array(64), o = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) o.setInt32(i * 4, h[i]);
  return out;
}
function sha1(msg) {
  const len = msg.length, total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(msg); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, len * 8); dv.setUint32(total - 8, Math.floor(len / 0x20000000));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Int32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const out = new Uint8Array(20), o = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((v, i) => o.setInt32(i * 4, v));
  return out;
}
export const HASH = { SHA512: sha512, SHA1: sha1 };
const hashOf = (name) => {
  const f = HASH[String(name).toUpperCase().replace("-", "")];
  if (!f) throw new Error(`지원하지 않는 암호 방식이에요 (${name}).`);
  return (...parts) => f(cat(...parts));
};

/* ---------- AES ---------- */
// WebCrypto의 AES-CBC는 끝 패딩을 꼭 확인해서, 패딩 없는 데이터 끝에 '패딩 블록'을 하나 만들어 붙인 뒤 풂
async function aesCbc(keyBytes, iv, data) {
  const key = await subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt", "decrypt"]);
  const last = data.slice(data.length - 16);
  const pad = last.map((v) => v ^ 16);
  const extra = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, key, pad)).slice(0, 16);
  return new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv }, key, cat(data, extra)));
}
// ECB: CBC(iv=0)로 푼 뒤 각 블록에 앞 암호 블록을 다시 XOR
async function aesEcb(keyBytes, data) {
  const p = await aesCbc(keyBytes, new Uint8Array(16), data);
  for (let i = 16; i < p.length; i++) p[i] ^= data[i - 16];
  return p;
}

/* ---------- 엑셀 ---------- */
const attrs = (xml, tag) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*)>`));
  return m ? Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]])) : null;
};
const fit = (b, n, fill) => (b.length >= n ? b.slice(0, n) : cat(b, new Uint8Array(n - b.length).fill(fill)));
const BK = { verifierInput: [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79], verifierHash: [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e], key: [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6] };

export class WrongPassword extends Error {}

/** CFB 안에 암호화된 엑셀이 들어 있는지 */
export function isEncryptedOffice(CFB, data) {
  if (!(data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0)) return false;
  try { return !!CFB.find(CFB.read(data, { type: "array" }), "EncryptionInfo"); } catch { return false; }
}

/** 암호화된 엑셀(CFB) + 비밀번호 → 풀린 xlsx 바이트. 비밀번호가 틀리면 WrongPassword */
export async function decryptOffice(CFB, data, password) {
  const cfb = CFB.read(data, { type: "array" });
  const info = Uint8Array.from(CFB.find(cfb, "EncryptionInfo").content);
  const pkg = Uint8Array.from(CFB.find(cfb, "EncryptedPackage").content);
  const dv = new DataView(info.buffer);
  const major = dv.getUint16(0, true), minor = dv.getUint16(2, true);
  const size = Number(new DataView(pkg.buffer).getBigUint64(0, true));
  const body = pkg.slice(8);

  if (major === 4 && minor === 4) {
    // Agile (엑셀 2010 이후)
    const xml = new TextDecoder().decode(info.slice(8));
    const kd = attrs(xml, "keyData"), ek = attrs(xml, "encryptedKey");
    if (!kd || !ek) throw new Error("암호 정보를 읽지 못했어요.");
    const H = hashOf(ek.hashAlgorithm), bytes = Number(ek.keyBits) / 8, spin = Number(ek.spinCount);
    let h = H(b64(ek.saltValue), utf16(password));
    for (let i = 0; i < spin; i++) h = H(le32(i), h);
    const keyFor = (blk) => fit(H(h, Uint8Array.from(blk)), bytes, 0x36);
    const salt = b64(ek.saltValue);
    const input = await aesCbc(keyFor(BK.verifierInput), salt, b64(ek.encryptedVerifierHashInput));
    const want = await aesCbc(keyFor(BK.verifierHash), salt, b64(ek.encryptedVerifierHashValue));
    const got = H(input.slice(0, Number(ek.saltSize ?? 16)));
    if (!same(got, want.slice(0, got.length))) throw new WrongPassword();
    const fileKey = (await aesCbc(keyFor(BK.key), salt, b64(ek.encryptedKeyValue))).slice(0, Number(kd.keyBits) / 8);
    const KH = hashOf(kd.hashAlgorithm), kdSalt = b64(kd.saltValue), block = Number(kd.blockSize);
    const out = new Uint8Array(body.length);
    for (let i = 0, off = 0; off < body.length; i++, off += 4096) {
      const seg = body.slice(off, off + 4096);
      out.set(await aesCbc(fileKey, fit(KH(kdSalt, le32(i)), block, 0x36), seg), off);
    }
    return out.slice(0, size);
  }

  if ((major === 3 || major === 4) && minor === 2) {
    // Standard (엑셀 2007): SHA-1 5만 번, AES-ECB
    const hsize = dv.getUint32(8, true);
    const header = new DataView(info.buffer, 12, hsize);
    const keyBits = header.getUint32(16, true) || 128;
    const v = 12 + hsize;
    const saltSize = dv.getUint32(v, true);
    const salt = info.slice(v + 4, v + 4 + saltSize);
    const encVerifier = info.slice(v + 4 + saltSize, v + 20 + saltSize);
    const encVerifierHash = info.slice(v + 24 + saltSize, v + 56 + saltSize);
    let h = sha1(cat(salt, utf16(password)));
    for (let i = 0; i < 50000; i++) h = sha1(cat(le32(i), h));
    h = sha1(cat(h, le32(0)));
    const x1 = sha1(cat(new Uint8Array(64).fill(0x36).map((c, i) => (i < 20 ? c ^ h[i] : c))));
    const x2 = sha1(cat(new Uint8Array(64).fill(0x5c).map((c, i) => (i < 20 ? c ^ h[i] : c))));
    const key = cat(x1, x2).slice(0, keyBits / 8);
    const verifier = await aesEcb(key, encVerifier);
    const verifierHash = await aesEcb(key, encVerifierHash);
    if (!same(sha1(verifier), verifierHash.slice(0, 20))) throw new WrongPassword();
    const pad = (16 - (body.length % 16)) % 16;
    return (await aesEcb(key, pad ? cat(body, new Uint8Array(pad)) : body)).slice(0, size);
  }
  throw new Error("지원하지 않는 엑셀 암호 방식이에요.");
}
