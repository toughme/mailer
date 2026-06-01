const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createSecurityManager(baseDataDir) {
  const secretsDir = path.join(baseDataDir, 'secrets');
  const keyPath = path.join(secretsDir, 'vault.key');
  fs.mkdirSync(secretsDir, { recursive: true });

  let key;
  if (fs.existsSync(keyPath)) {
    key = fs.readFileSync(keyPath);
  } else {
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key);
  }

  function encrypt(value) {
    if (!value) {
      return '';
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  function decrypt(payload) {
    if (!payload) {
      return '';
    }

    const [ivHex, tagHex, encryptedHex] = String(payload).split(':');
    if (!ivHex || !tagHex || !encryptedHex) {
      return '';
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  }

  return { encrypt, decrypt };
}

module.exports = { createSecurityManager };
