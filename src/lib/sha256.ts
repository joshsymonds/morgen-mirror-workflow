// Pure-JS SHA-256 (FIPS 180-4). We bundle our own because the workflow
// runtime in Morgen's V8 isolate exposes only morgen.util/morgen.deps
// plus the global ECMAScript surface — no node:crypto, no guaranteed
// Web Crypto. Producing dedup hashes that are byte-identical between
// local tests and the live workflow demands a deterministic in-process
// implementation.

const ROUND_CONSTANTS = new Uint32Array([
  0x42_8a_2f_98, 0x71_37_44_91, 0xb5_c0_fb_cf, 0xe9_b5_db_a5, 0x39_56_c2_5b, 0x59_f1_11_f1,
  0x92_3f_82_a4, 0xab_1c_5e_d5, 0xd8_07_aa_98, 0x12_83_5b_01, 0x24_31_85_be, 0x55_0c_7d_c3,
  0x72_be_5d_74, 0x80_de_b1_fe, 0x9b_dc_06_a7, 0xc1_9b_f1_74, 0xe4_9b_69_c1, 0xef_be_47_86,
  0x0f_c1_9d_c6, 0x24_0c_a1_cc, 0x2d_e9_2c_6f, 0x4a_74_84_aa, 0x5c_b0_a9_dc, 0x76_f9_88_da,
  0x98_3e_51_52, 0xa8_31_c6_6d, 0xb0_03_27_c8, 0xbf_59_7f_c7, 0xc6_e0_0b_f3, 0xd5_a7_91_47,
  0x06_ca_63_51, 0x14_29_29_67, 0x27_b7_0a_85, 0x2e_1b_21_38, 0x4d_2c_6d_fc, 0x53_38_0d_13,
  0x65_0a_73_54, 0x76_6a_0a_bb, 0x81_c2_c9_2e, 0x92_72_2c_85, 0xa2_bf_e8_a1, 0xa8_1a_66_4b,
  0xc2_4b_8b_70, 0xc7_6c_51_a3, 0xd1_92_e8_19, 0xd6_99_06_24, 0xf4_0e_35_85, 0x10_6a_a0_70,
  0x19_a4_c1_16, 0x1e_37_6c_08, 0x27_48_77_4c, 0x34_b0_bc_b5, 0x39_1c_0c_b3, 0x4e_d8_aa_4a,
  0x5b_9c_ca_4f, 0x68_2e_6f_f3, 0x74_8f_82_ee, 0x78_a5_63_6f, 0x84_c8_78_14, 0x8c_c7_02_08,
  0x90_be_ff_fa, 0xa4_50_6c_eb, 0xbe_f9_a3_f7, 0xc6_71_78_f2,
]);

const INITIAL_HASH = new Uint32Array([
  0x6a_09_e6_67, 0xbb_67_ae_85, 0x3c_6e_f3_72, 0xa5_4f_f5_3a, 0x51_0e_52_7f, 0x9b_05_68_8c,
  0x1f_83_d9_ab, 0x5b_e0_cd_19,
]);

const BLOCK_BYTES = 64;
const DIGEST_BYTES = 32;

// Hand-rolled UTF-8 encoder. We can't use the platform's TextEncoder
// because Morgen's V8 isolate doesn't expose it — the workflow path
// would ReferenceError. Keeping the encoding identical here ensures
// lib tests and the deployed workflow produce byte-identical digests.
function utf8Encode(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const codePoint = input.codePointAt(i) ?? 0;
    if (codePoint > 0xff_ff) i++; // skip the low surrogate
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x8_00) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x1_00_00) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

// noUncheckedIndexedAccess types every typed-array read as `number |
// undefined` even though Uint32Array always returns a number for
// in-bounds indices. Wrap the read once so call sites stay readable.
// The `?? 0` fallback is unreachable on valid inputs.
/* v8 ignore next */
const u32 = (arr: Uint32Array, i: number): number => arr[i] ?? 0;

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

function padMessage(bytes: Uint8Array): Uint8Array {
  const messageBits = BigInt(bytes.length) * 8n;
  // Append 0x80, then zeros, then a big-endian 64-bit length so the
  // total length is a multiple of 64.
  const minLength = bytes.length + 1 + 8;
  const paddedLength = Math.ceil(minLength / BLOCK_BYTES) * BLOCK_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setBigUint64(paddedLength - 8, messageBits, false);
  return padded;
}

function expandSchedule(padded: Uint8Array, offset: number): Uint32Array {
  const w = new Uint32Array(64);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  for (let i = 0; i < 16; i++) {
    w[i] = view.getUint32(offset + i * 4, false);
  }
  for (let i = 16; i < 64; i++) {
    const x15 = u32(w, i - 15);
    const x2 = u32(w, i - 2);
    const smallSigma0 = rotr(x15, 7) ^ rotr(x15, 18) ^ (x15 >>> 3);
    const smallSigma1 = rotr(x2, 17) ^ rotr(x2, 19) ^ (x2 >>> 10);
    w[i] = (u32(w, i - 16) + smallSigma0 + u32(w, i - 7) + smallSigma1) >>> 0;
  }
  return w;
}

function compressBlock(state: Uint32Array, w: Uint32Array): void {
  const h0 = u32(state, 0);
  const h1 = u32(state, 1);
  const h2 = u32(state, 2);
  const h3 = u32(state, 3);
  const h4 = u32(state, 4);
  const h5 = u32(state, 5);
  const h6 = u32(state, 6);
  const h7 = u32(state, 7);

  let a = h0;
  let b = h1;
  let c = h2;
  let d = h3;
  let e = h4;
  let f = h5;
  let g = h6;
  let h = h7;

  for (let i = 0; i < 64; i++) {
    const bigSigma1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const choose = (e & f) ^ (~e & g);
    const temp1 = (h + bigSigma1 + choose + u32(ROUND_CONSTANTS, i) + u32(w, i)) >>> 0;
    const bigSigma0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (bigSigma0 + majority) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  state[0] = (h0 + a) >>> 0;
  state[1] = (h1 + b) >>> 0;
  state[2] = (h2 + c) >>> 0;
  state[3] = (h3 + d) >>> 0;
  state[4] = (h4 + e) >>> 0;
  state[5] = (h5 + f) >>> 0;
  state[6] = (h6 + g) >>> 0;
  state[7] = (h7 + h) >>> 0;
}

export function sha256Bytes(input: string): Uint8Array {
  const padded = padMessage(utf8Encode(input));
  const state = new Uint32Array(INITIAL_HASH);
  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    compressBlock(state, expandSchedule(padded, offset));
  }
  const result = new Uint8Array(DIGEST_BYTES);
  const resultView = new DataView(result.buffer);
  for (let i = 0; i < 8; i++) {
    resultView.setUint32(i * 4, u32(state, i), false);
  }
  return result;
}
