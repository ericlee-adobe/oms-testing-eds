import JSEncrypt from 'jsencrypt';

/*
 * Password encryption for LG ACC sign-in, ported from the reference
 * implementation at cm-lge-sites-repo .../ssoScripts/../common/encrypt.js.
 *
 * The ACC validationAccount API expects two SHA-512 hex digests:
 *   emp(SHA512 [password])         -> sent as empPassword
 *   lge(SHA512 [email + password]) -> sent as lgePassword
 * plus an optional RSA-2048 encryption of the raw password (used by other
 * flows such as account integration).
 */

/**
 * RSA-2048 encrypt a string with the given public key.
 * @param {string} str
 * @param {string} publicKey base64 SPKI public key (no PEM header/footer needed)
 * @returns {string|false} base64 ciphertext, or false if encryption fails
 */
export const getRsa2048Value = (str, publicKey) => {
    const rsa2048Encryption = new JSEncrypt({ default_key_size: 2048 });
    rsa2048Encryption.setPublicKey(publicKey);
    return rsa2048Encryption.encrypt(str);
};

/**
 * SHA-512 hex digest of a string via the Web Crypto API.
 * @param {string} str
 * @returns {Promise<string>} lowercase hex digest
 */
export const sha512 = (str) => crypto.subtle
    .digest('SHA-512', new TextEncoder('utf-8').encode(str))
    .then((buf) => Array.prototype.map
        .call(new Uint8Array(buf), (x) => `00${x.toString(16)}`.slice(-2))
        .join(''));

/**
 * Build the encrypted password payload the ACC API expects.
 * @param {string} email
 * @param {string} password
 * @param {string} [publicKey] optional RSA public key; RSA2048 is skipped if absent
 * @returns {Promise<{RSA2048?: string, 'emp(SHA512 [password])': string, 'lge(SHA512 [email + password])': string}>}
 */
export const getRSAEncrytpedPasswords = async (email, password, publicKey) => {
    if (!(email && password)) {
        return Promise.reject(new Error('Email and password are required'));
    }

    const [empHash, lgeHash] = await Promise.all([
        sha512(password),
        sha512(`${email}${password}`),
    ]);

    const encryptedTexts = {
        'emp(SHA512 [password])': empHash,
        'lge(SHA512 [email + password])': lgeHash,
    };

    if (publicKey) {
        encryptedTexts.RSA2048 = getRsa2048Value(password, publicKey);
    }

    return encryptedTexts;
};
