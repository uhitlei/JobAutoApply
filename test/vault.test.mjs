// Testa o cofre fora do Chrome: node test/vault.test.mjs
import assert from 'node:assert/strict';
const mem = { local: {}, session: {} };
const area = (name) => ({
  async get(k) { const keys = Array.isArray(k) ? k : [k]; return Object.fromEntries(keys.filter((x) => x in mem[name]).map((x) => [x, mem[name][x]])); },
  async set(o) { Object.assign(mem[name], o); },
  async remove(k) { for (const x of [].concat(k)) delete mem[name][x]; },
});
globalThis.chrome = { storage: { local: area('local'), session: area('session') } };
const v = await import('../src/bg/vault.js');

assert.deepEqual(await v.status(), { configured: false, unlocked: false });
await assert.rejects(v.getKeys(), /Nenhuma chave/);
await assert.rejects(v.create('curta', {}), /8 caracteres/);
await v.create('senha-forte-123', { anthropicKey: 'sk-ant-abc', openaiKey: '' });
assert.deepEqual(await v.status(), { configured: true, unlocked: true });
assert.equal((await v.getKeys()).anthropicKey, 'sk-ant-abc');
assert.ok(!JSON.stringify(mem.local).includes('sk-ant-abc'), 'a chave não pode aparecer em texto claro no disco');
await v.lock();
await assert.rejects(v.getKeys(), /bloqueado/);
await assert.rejects(v.unlock('senha-errada-999'), /incorreta/);
await v.unlock('senha-forte-123');
await v.setKeys({ anthropicKey: 'sk-ant-novo', openaiKey: 'sk-openai' });
assert.deepEqual(await v.getKeys(), { anthropicKey: 'sk-ant-novo', openaiKey: 'sk-openai' });
await v.changePassword('senha-forte-123', 'outra-senha-456');
await v.lock();
await assert.rejects(v.unlock('senha-forte-123'), /incorreta/);
await v.unlock('outra-senha-456');
assert.equal((await v.getKeys()).openaiKey, 'sk-openai');
await v.remove();
assert.deepEqual(await v.status(), { configured: false, unlocked: false });
console.log('vault OK');
