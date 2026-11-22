// Self-check of the output guard: node api/ask.test.ts
import assert from 'node:assert/strict'
import { acceptable } from './ask.ts'

assert.ok(acceptable('سلام علي، نوبتك من 18:00 لـ 20:33، 153 م³.', 'darija', true))
assert.ok(acceptable('ヘディさん、今夜の給水は22:36〜23:36です。', 'ja', true))
assert.ok(!acceptable('', 'fr', true), 'empty')
assert.ok(!acceptable('x'.repeat(401), 'fr', true), 'SMS too long')
assert.ok(acceptable('x'.repeat(401), 'fr', false), 'answers may be longer than an SMS')
assert.ok(!acceptable('あなたの「during_cut」は', 'ja', false), 'leaked JSON key')
assert.ok(!acceptable('Bonjour {member.name}', 'fr', true), 'placeholder')
assert.ok(!acceptable('المياه توصل بالجمبريّة', 'darija', true), 'shrimp for gravity')
assert.ok(!acceptable('Hedi-san, anata no kangai wa 22:36', 'ja', false), 'romaji instead of Japanese')
const plan = JSON.stringify({ turn: { start: '18:00', end: '20:33' }, steg_cut: '12:00-17:00' })
assert.ok(acceptable('Votre tour : 18:00 → 20:33, coupure 12:00-17:00.', 'fr', true, plan), 'times from the plan pass')
assert.ok(!acceptable('Votre tour : 19:15 → 21:00.', 'fr', true, plan), 'invented time rejected')
assert.ok(acceptable('Tour 8:00', 'fr', true, JSON.stringify({ start: '08:00' })), 'single-digit hour matches')
console.log('ok: output guard')
