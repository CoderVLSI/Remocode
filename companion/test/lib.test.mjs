import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildArgs, chunkText, createBatcher, DEFAULT_AGENT_ARGS, parseArgsEnv, parseDotenv, safePrompt } from '../src/lib.mjs';

test('safePrompt neutralises flag-like prompts', () => {
  assert.equal(safePrompt('  fix the bug  '), 'fix the bug');
  assert.equal(safePrompt('--dangerously-skip-permissions'), 'Task: --dangerously-skip-permissions');
  assert.equal(safePrompt('-p rm -rf'), 'Task: -p rm -rf');
});

test('buildArgs substitutes into argv without shell interpretation', () => {
  const args = buildArgs(['-p', '--', '{prompt}'], 'echo $(whoami); rm -rf ~ && "quoted"');
  assert.deepEqual(args, ['-p', '--', 'echo $(whoami); rm -rf ~ && "quoted"']);
  assert.deepEqual(buildArgs(['--note=pre-{prompt}-post'], 'x'), ['--note=pre-x-post']);
});

test('parseArgsEnv validates', () => {
  assert.deepEqual(parseArgsEnv(undefined), DEFAULT_AGENT_ARGS);
  assert.deepEqual(parseArgsEnv('["-p","{prompt}"]'), ['-p', '{prompt}']);
  assert.throws(() => parseArgsEnv('not json'), /JSON array/);
  assert.throws(() => parseArgsEnv('[1,2]'), /JSON array/);
  assert.throws(() => parseArgsEnv('["-p"]'), /\{prompt\}/);
});

test('chunkText splits to the size limit and loses nothing', () => {
  const text = 'a'.repeat(70_000);
  const parts = chunkText(text, 32_000);
  assert.deepEqual(parts.map((p) => p.length), [32_000, 32_000, 6_000]);
  assert.equal(parts.join(''), text);
  assert.deepEqual(chunkText('short'), ['short']);
});

function harness(opts = {}) {
  const events = [];
  const timers = [];
  const b = createBatcher({
    onFlush: (kind, text) => events.push([kind, text]),
    setTimer: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => {},
    ...opts,
  });
  return { b, events, timers };
}

test('batcher merges same-kind output and flushes on kind change', () => {
  const { b, events } = harness();
  b.push('stdout', 'hello ');
  b.push('stdout', 'world');
  b.push('stderr', 'warn');
  b.flush();
  assert.deepEqual(events, [['stdout', 'hello world'], ['stderr', 'warn']]);
});

test('batcher flushes when the timer fires and when the buffer is large', () => {
  const { b, events, timers } = harness({ maxBytes: 10 });
  b.push('stdout', 'abc');
  assert.equal(events.length, 0);
  timers[0]();
  assert.deepEqual(events, [['stdout', 'abc']]);
  b.push('stdout', '0123456789');
  assert.equal(events.length, 2);
});

test('batcher truncates after maxTotal and says so once', () => {
  const { b, events } = harness({ maxTotal: 10 });
  b.push('stdout', '12345678');
  b.push('stdout', 'abcdefgh');
  b.push('stdout', 'ignored');
  b.flush();
  const text = events.map((e) => e.join(':')).join('|');
  assert.match(text, /stdout:12345678ab/);
  assert.equal(events.filter((e) => e[0] === 'info').length, 1);
  assert.equal(b.truncated, true);
});

test('parseDotenv reads quoted and plain values and ignores comments', () => {
  const env = parseDotenv('# c\nA=1\nB="two words"\nC=\'x\'\n  D = 4  \nbad line');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'x', D: '4' });
});
