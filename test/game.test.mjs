import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGameServer } from '../server.mjs';
import { buildResult, evaluateImage, GameError, validateInput } from '../lib/evaluate.mjs';

// Malý platný PNG jako fixture; žádné testy nevolají placené API.
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=';
const input = (overrides = {}) => ({ caseId: '550e8400-e29b-41d4-a716-446655440000', image, answer: 'Je to AI, písmena na ceduli nedávají smysl.', guess: 'ai', origin: 'unknown', source: '', ...overrides });
const assessment = (overrides = {}) => ({ student_guess: 'ai', model_origin: 'ai', argument_supported: true, analysis: 'Detektive, všiml sis konkrétního detailu. Nečitelný text je indicie, ale sám o sobě původ nepotvrzuje.', ...overrides });

test('bez ověřeného původu se nikdy neboduje správnost tipu', () => {
  const result = buildResult(input(), assessment());
  assert.equal(result.guessCorrect, null);
  assert.deepEqual(result.points, { guess: 0, argument: 1, total: 1, available: 1 });
  assert.match(result.feedback[0], /není ověřený/);
});

test('ověřený původ má přednost před odhadem modelu; argument se boduje nezávisle', () => {
  const correct = buildResult(input({ origin: 'real', source: 'Vlastní fotografie', guess: 'real' }), assessment());
  assert.deepEqual(correct.points, { guess: 1, argument: 1, total: 2, available: 2 });
  const wrong = buildResult(input({ origin: 'real', source: 'Vlastní fotografie' }), assessment());
  assert.deepEqual(wrong.points, { guess: 0, argument: 1, total: 1, available: 2 });
  assert.equal(wrong.guessCorrect, false);
});

test('tip napsaný ve zprávě funguje i bez vybraného tlačítka', () => {
  const result = buildResult(input({ guess: null, origin: 'ai', source: 'Vygenerováno v DALL·E' }), assessment());
  assert.equal(result.points.guess, 1);
  assert.throws(() => buildResult(input({ guess: null }), assessment({ student_guess: 'unclear' })), (error) => error.status === 422);
});

test('vymyšlené body a neúplný výstup modelu se nepřijímají', () => {
  const result = buildResult(input(), assessment({ argument_supported: false, points: 999 }));
  assert.equal(result.points.total, 0);
  assert.throws(() => buildResult(input(), assessment({ argument_supported: 'true' })), (error) => error.status === 502);
  assert.throws(() => buildResult(input(), assessment({ analysis: '' })), (error) => error.status === 502);
});

test('vstup odmítá neobrázky, SVG, chybějící zdroj a nepřiměřený obsah', () => {
  assert.equal(validateInput(input()).origin, 'unknown');
  for (const changes of [
    { image: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { image: 'data:image/jpeg;base64,SGVsbG8gd29ybGQhISEhIQ==' },
    { image: 'data:image/png;base64,a' },
    { origin: 'real', source: '' },
    { guess: 'whatever' },
    { answer: 'x'.repeat(801) },
    { caseId: '../.env' },
  ]) assert.throws(() => validateInput(input(changes)), GameError);
});

test('vision požadavek obsahuje obrázek, strukturovaný formát a instrukce; chyby API jsou srozumitelné', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(assessment()) } }] }));
  };
  const result = await evaluateImage(input(), { apiKey: 'test-only-secret', fetchImpl });
  assert.equal(result.points.argument, 1);
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, 'Bearer test-only-secret');
  assert.equal(captured.body.messages[1].content[1].image_url.url, image);
  assert.equal(captured.body.response_format.json_schema.strict, true);
  assert.match(captured.body.messages[0].content, /nedůvěryhodná data/);
  assert.equal(captured.body.messages.length, 2);
  await assert.rejects(evaluateImage(input(), { apiKey: 'x', fetchImpl: async () => new Response('provider-secret', { status: 401 }) }), (error) => error.status === 503 && !error.message.includes('provider-secret'));
  await assert.rejects(evaluateImage(input(), { apiKey: 'x', fetchImpl: async () => { throw new DOMException('timeout', 'TimeoutError'); } }), (error) => error.status === 504);
  await assert.rejects(evaluateImage(input(), { apiKey: 'x', fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'Cannot analyze' } }] })) }), (error) => error.status === 422);
});

async function withServer(options, run) {
  const server = createGameServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await run(url); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const post = (url, body, headers = {}) => fetch(`${url}/api/evaluate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('server nabízí stránku i assets, nikdy klíč, backendový kód nebo .env', async () => {
  await withServer({ apiKey: 'test-only-secret' }, async (url) => {
    const config = await (await fetch(`${url}/api/config`)).json();
    assert.deepEqual(config, { configured: true });
    for (const path of ['/', '/styles.css', '/app.js']) {
      const response = await fetch(url + path);
      assert.equal(response.status, 200);
      assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self'"));
      assert.ok(!(await response.text()).includes('test-only-secret'));
    }
    for (const path of ['/.env', '/.env.example', '/server.mjs', '/lib/evaluate.mjs', '/package.json', '/%2e%2e/.env']) {
      assert.equal((await fetch(url + path)).status, 404);
    }
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await post(url, input(), { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await fetch(`${url}/api/evaluate`)).status, 405);
  });
});

test('stejné souběžné odeslání vyhodnotí API jednou a bodování nelze změnit opakováním', async () => {
  let calls = 0;
  await withServer({ apiKey: 'test', evaluator: async (body) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return buildResult(body, assessment());
  } }, async (url) => {
    const responses = await Promise.all([post(url, input()), post(url, input())]);
    const results = await Promise.all(responses.map((response) => response.json()));
    assert.equal(calls, 1);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await post(url, input({ answer: 'Měním svůj tip a také celý svůj argument.' }))).status, 409);
  });
});

test('neúspěšný případ lze opakovat bez falešného skóre; chybějící klíč a limity mají vlastní stav', async () => {
  let calls = 0;
  await withServer({ apiKey: 'test', evaluator: async (body) => {
    if (++calls === 1) throw new GameError(502, 'Zkus to znovu.');
    return buildResult(body, assessment());
  } }, async (url) => {
    assert.equal((await post(url, input())).status, 502);
    const second = await post(url, input());
    assert.equal(second.status, 200);
    assert.equal((await second.json()).points.total, 1);
  });
  await withServer({ apiKey: '' }, async (url) => {
    assert.deepEqual(await (await fetch(`${url}/api/config`)).json(), { configured: false });
    assert.equal((await post(url, input())).status, 503);
  });
  await withServer({ apiKey: 'test', perMinuteLimit: 1, evaluator: async (body) => buildResult(body, assessment()) }, async (url) => {
    assert.equal((await post(url, input())).status, 200);
    const limited = await post(url, input());
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
  });
});
