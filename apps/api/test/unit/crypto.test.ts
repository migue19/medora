import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, hashPassword, randomToken, verifyPassword } from '../../src/common/crypto';
import { RateLimiter } from '../../src/common/rate-limit';
import { validateRules } from '../../src/scheduling/scheduling.controller';

test('scrypt verifica la contraseña correcta y rechaza otra', async () => {
  const hash = await hashPassword('una-contraseña-larga');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword('una-contraseña-larga', hash), true);
  assert.equal(await verifyPassword('otra', hash), false);
  assert.equal(await verifyPassword('x', 'basura'), false);
});

test('hash canónico ignora el orden de claves', () => {
  assert.equal(canonicalHash({ a: 1, b: { c: 2, d: 3 } }), canonicalHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(canonicalHash({ a: 1 }), canonicalHash({ a: 2 }));
});

test('token de refresh de 384 bits', () => {
  assert.equal(Buffer.from(randomToken(), 'base64url').length, 48);
});

test('limitador rechaza después del límite', () => {
  const l = new RateLimiter(2, 1000);
  l.consume('k', 0); l.consume('k', 1);
  assert.throws(() => l.consume('k', 2));
  l.consume('k', 1001);
});

test('validateRules rechaza traslapes y minutos no múltiplos de 5', () => {
  assert.doesNotThrow(() => validateRules([
    { weekday: 1, startMinute: 540, endMinute: 600 }, { weekday: 1, startMinute: 600, endMinute: 660 },
  ]));
  assert.throws(() => validateRules([
    { weekday: 1, startMinute: 540, endMinute: 610 }, { weekday: 1, startMinute: 600, endMinute: 660 },
  ]));
  assert.throws(() => validateRules([{ weekday: 1, startMinute: 541, endMinute: 600 }]));
});
