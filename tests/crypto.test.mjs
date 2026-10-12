import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,pbkdf2Sync,createCipheriv} from 'node:crypto';
import {unlockLibrary} from '../crypto.js';
import {createZip} from '../zip.js';

test('library decrypts only with the correct password and rejects altered ciphertext',async()=>{
  const password='fixture-password-only',salt=randomBytes(16),iv=randomBytes(12),iterations=600000;
  const plain={schemaVersion:1,templates:Array.from({length:10},(_,i)=>({id:String(i)}))};
  const cipher=createCipheriv('aes-256-gcm',pbkdf2Sync(password,salt,iterations,32,'sha256'),iv);
  cipher.setAAD(Buffer.from('prescot-mail-library-v1'));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(plain)),cipher.final(),cipher.getAuthTag()]);
  const payload={version:1,algorithm:'AES-GCM',iterations,salt:salt.toString('base64'),iv:iv.toString('base64'),data:encrypted.toString('base64')};
  assert.deepEqual(await unlockLibrary(password,payload),plain);
  await assert.rejects(unlockLibrary('wrong-password',payload));
  encrypted[3]^=1;
  await assert.rejects(unlockLibrary(password,{...payload,data:encrypted.toString('base64')}));
});

test('ZIP records all entries with matching lengths and UTF-8 flag',async()=>{
  const files=[{name:'01-mail/mail.txt',content:'Zażółć gęślą jaźń'},{name:'02-mail/mail.html',content:'<p>Treść</p>'}];
  const bytes=new Uint8Array(await createZip(files).arrayBuffer()),view=new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),0x04034b50);
  assert.equal(view.getUint16(6,true),0x800);
  assert.equal(view.getUint16(bytes.length-12,true),files.length);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
});
