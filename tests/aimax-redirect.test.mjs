import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const source = readFileSync(new URL('../app/aimax/route.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require, URL });
test('AIMAX redirects to condition entry with fixed partner attribution and no arbitrary data', () => {
  for (const query of ['', '?utm_source=other&next=https://example.com&email=private-value', '?utm_source=aimax&utm_source=other']) {
    const response = exports.GET(new NextRequest('https://ddakfit.bccconsulting.kr/aimax' + query));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://bccconsulting.kr/ddakfit/?utm_source=aimax&utm_medium=partner&utm_campaign=launch');
  }
});
test('explicit QA flags survive the domain change', () => {
  const response = exports.GET(new NextRequest('https://ddakfit.bccconsulting.kr/aimax?qa=1&bcc_analytics_debug=1'));
  const url = new URL(response.headers.get('location'));
  assert.equal(url.searchParams.get('qa'), '1');
  assert.equal(url.searchParams.get('bcc_analytics_debug'), '1');
});
