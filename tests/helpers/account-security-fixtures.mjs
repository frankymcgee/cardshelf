// Synthetic software authenticator for security tests. This exercises real
// SimpleWebAuthn parsing/signature verification; it is not hardware/browser QA.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const hash = value => createHash('sha256').update(value).digest();
const encode = value => Buffer.from(value).toString('base64url');
const uint32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };

export function softwareAuthenticator() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32), id = encode(credentialId);
  const cose = Buffer.from(isoCBOR.encode(new Map([
    [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
  ])));
  const clientData = (type, challenge, origin, extra = {}) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false, ...extra }));
  return {
    id, publicKey: cose,
    registration(options, origin, overrides = {}) {
      const rpId = overrides.rpId || options.rp.id;
      const credentialLength = Buffer.alloc(2); credentialLength.writeUInt16BE(credentialId.length);
      const authenticatorData = Buffer.concat([
        hash(rpId), Buffer.from([overrides.uv === false ? 0x41 : 0x45]), uint32(0),
        Buffer.alloc(16), credentialLength, credentialId, cose,
      ]);
      const attestation = isoCBOR.encode(new Map([
        ['fmt', 'none'], ['attStmt', new Map()], ['authData', authenticatorData],
      ]));
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: encode(clientData('webauthn.create', overrides.challenge || options.challenge, overrides.origin || origin)),
          attestationObject: encode(attestation), transports: ['internal'] } };
    },
    assertion(options, origin, overrides = {}) {
      const authenticatorData = Buffer.concat([
        hash(overrides.rpId || options.rpId), Buffer.from([overrides.uv === false ? 0x01 : 0x05]), uint32(overrides.counter ?? 1),
      ]);
      const data = clientData('webauthn.get', overrides.challenge || options.challenge, overrides.origin || origin, overrides.clientData);
      const signature = sign('sha256', Buffer.concat([authenticatorData, hash(data)]), privateKey);
      if (overrides.badSignature) signature[signature.length - 1] ^= 1;
      return { id, rawId: id, type: 'public-key', clientExtensionResults: {},
        response: { clientDataJSON: encode(data), authenticatorData: encode(authenticatorData), signature: encode(signature),
          ...(overrides.userHandle ? { userHandle: overrides.userHandle } : {}) } };
    },
  };
}
