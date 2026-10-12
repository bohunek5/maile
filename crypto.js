// The password and decrypted library stay in memory for the current page only.
const bytes = value => Uint8Array.from(atob(value), ch => ch.charCodeAt(0));

export async function unlockLibrary(password, payload) {
  if (payload.version !== 1 || payload.algorithm !== 'AES-GCM' || payload.iterations !== 600000) {
    throw new Error('Unsupported library format');
  }
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(payload.salt), iterations: payload.iterations },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(payload.iv), additionalData: new TextEncoder().encode('prescot-mail-library-v1') }, key, bytes(payload.data));
  const library = JSON.parse(new TextDecoder().decode(clear));
  if (library.schemaVersion !== 1 || !Array.isArray(library.templates) || library.templates.length !== 10) throw new Error('Invalid library');
  return library;
}
