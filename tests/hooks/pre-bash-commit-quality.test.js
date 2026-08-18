/**
 * Tests for scripts/hooks/pre-bash-commit-quality.js
 *
 * Run with: node tests/hooks/pre-bash-commit-quality.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const hook = require('../../scripts/hooks/pre-bash-commit-quality');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function inTempRepo(fn) {
  const prevCwd = process.cwd();
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-bash-commit-quality-'));

  try {
    spawnSync('git', ['init'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'ECC Test'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'ecc@example.com'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    process.chdir(repoDir);
    return fn(repoDir);
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function captureConsoleError(fn) {
  const previousError = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    const result = fn();
    return { result, stderr: lines.join('\n') };
  } finally {
    console.error = previousError;
  }
}

function writeAndStage(repoDir, relativePath, content) {
  const filePath = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  spawnSync('git', ['add', relativePath], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function writeFakeExecutable(filePath, output, exitCode) {
  const source = process.platform === 'win32'
    ? `@echo off\r\necho ${output}\r\nexit /b ${exitCode}\r\n`
    : `#!/bin/sh\necho "${output}"\nexit ${exitCode}\n`;

  fs.writeFileSync(filePath, source, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function pathEnvKey() {
  return Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = overrides[key];
  }

  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (typeof previous[key] === 'string') {
        process.env[key] = previous[key];
      } else {
        delete process.env[key];
      }
    }
  }
}

let passed = 0;
let failed = 0;

console.log('\nPre-Bash Commit Quality Hook Tests');
console.log('==================================\n');

if (test('evaluate blocks commits when staged snapshot contains debugger', () => {
  inTempRepo(repoDir => {
    const filePath = path.join(repoDir, 'index.js');
    fs.writeFileSync(filePath, 'function main() {\n  debugger;\n}\n', 'utf8');
    spawnSync('git', ['add', 'index.js'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: test debugger hook"' } });
    const result = hook.evaluate(input);

    assert.strictEqual(result.output, input, 'should preserve stdin payload');
    assert.strictEqual(result.exitCode, 2, 'should block commit when staged snapshot has debugger');
  });
})) passed++; else failed++;

if (test('evaluate inspects staged snapshot instead of newer working tree content', () => {
  inTempRepo(repoDir => {
    const filePath = path.join(repoDir, 'index.js');
    fs.writeFileSync(filePath, 'function main() {\n  return 1;\n}\n', 'utf8');
    spawnSync('git', ['add', 'index.js'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });

    // Working tree diverges after staging; hook should still inspect staged content.
    fs.writeFileSync(filePath, 'function main() {\n  debugger;\n  return 1;\n}\n', 'utf8');

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: staged snapshot only"' } });
    const result = hook.evaluate(input);

    assert.strictEqual(result.output, input, 'should preserve stdin payload');
    assert.strictEqual(result.exitCode, 0, 'should ignore unstaged debugger in working tree');
  });
})) passed++; else failed++;

if (test('passes through non-commit amend malformed JSON and run wrapper paths', () => {
  const readInput = JSON.stringify({ tool_input: { command: 'git status --short' } });
  assert.deepStrictEqual(hook.evaluate(readInput), { output: readInput, exitCode: 0 });

  const amendInput = JSON.stringify({ tool_input: { command: 'git commit --amend -m "fix: update"' } });
  assert.deepStrictEqual(hook.evaluate(amendInput), { output: amendInput, exitCode: 0 });

  const malformed = 'not json {{{';
  const malformedResult = captureConsoleError(() => hook.run(malformed));
  assert.deepStrictEqual(malformedResult.result, { stdout: malformed, exitCode: 0 });
  assert.ok(malformedResult.stderr.includes('[Hook] Error:'), 'should log JSON parse errors without blocking');
})) passed++; else failed++;

if (test('allows git commit when no files are staged', () => {
  inTempRepo(() => {
    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: no staged files"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(stderr.includes('No staged files found'), `expected no-staged warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('validates commit messages even when no files are staged', () => {
  inTempRepo(() => {
    const input = JSON.stringify({ tool_input: { command: 'git commit --allow-empty -m "Bad message"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('Commit message does not follow conventional commit format'), `expected message validation, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('allows non-critical file warnings while reporting a valid commit message', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      'console.log("debug only");',
      '// TODO: clean this up',
      '// TODO: tracked in issue #123',
      '// console.log("commented out");',
      '* console.log("doc comment");',
      'const ok = true;',
      ''
    ].join('\n'));

    const input = JSON.stringify({
      tool_input: {
        command: 'git commit -m "fix: report hook warnings"'
      }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0, 'warning-only issues should not block');
    assert.ok(stderr.includes('WARNING Line 1'), `expected console warning, got: ${stderr}`);
    assert.ok(stderr.includes('INFO Line 2'), `expected TODO info warning, got: ${stderr}`);
    assert.ok(stderr.includes('Warnings found'), `expected warning summary, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('blocks invalid and long commit messages when files are clean', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');

    const longMessage = `feat: ${'x'.repeat(67)}`;
    const input = JSON.stringify({
      tool_input: {
        command: `git commit --message="${longMessage}"`
      }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 2, 'invalid commit messages should block');
    assert.ok(stderr.includes('ERROR Commit message header too long'), `expected length error, got: ${stderr}`);
    assert.ok(stderr.includes('To bypass these checks, use: git commit --no-verify'), `expected bypass guidance, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('blocks commits with staged secret patterns across checkable files', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      "const openai = 'sk-abcdefghijklmnopqrstuvwxyz';",
      "const anthropic = 'sk-ant-api03-AbCdEf-GhIjKlMnOpQrStUvWx_Yz012345';",
      "const token = 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';",
      ''
    ].join('\n'));
    writeAndStage(repoDir, 'app.py', [
      'aws = "AKIAABCDEFGHIJKLMNOP"',
      'api_key = "secret-value"',
      ''
    ].join('\n'));

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: block secrets"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('Potential OpenAI API key'), `expected OpenAI secret warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential Anthropic API key'), `expected Anthropic key warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential GitHub PAT'), `expected GitHub PAT warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential AWS Access Key'), `expected AWS key warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential API key'), `expected generic API key warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('blocks commits with an unquoted API key assignment', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'config.py', [
      'API_KEY=sk_live_1234567890abcdef',
      ''
    ].join('\n'));

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: unquoted key"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('Potential API key'), `expected unquoted API key warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('does not flag ordinary unquoted apiKey code references', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      'const apiKey = getApiKeyFromVault();',
      'this.apiKey = options.apiKey;',
      'const apiKey2 = process.env.API_KEY;',
      ''
    ].join('\n'));

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: no secret here"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0, `expected exit 0 (no secrets), got ${result.exitCode}: ${stderr}`);
    assert.ok(!stderr.includes('Potential API key'), `should not flag ordinary code as a secret, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('reports eslint pylint and golint failures from staged files', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const lint = true;\n');
    writeAndStage(repoDir, 'app.py', 'print("lint")\n');
    writeAndStage(repoDir, 'main.go', 'package main\n');

    const eslintPath = path.join(repoDir, 'node_modules', '.bin', executableName('eslint'));
    fs.mkdirSync(path.dirname(eslintPath), { recursive: true });
    writeFakeExecutable(eslintPath, 'eslint failed', 1);

    const binDir = path.join(repoDir, 'fake-bin');
    fs.mkdirSync(binDir, { recursive: true });
    const pylintPath = path.join(binDir, executableName('pylint'));
    const golintPath = path.join(binDir, executableName('golint'));
    writeFakeExecutable(pylintPath, 'pylint failed', 1);
    writeFakeExecutable(golintPath, 'main.go:1: lint failed', 0);

    const pathKey = pathEnvKey();
    withEnv({ [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] || process.env.PATH || ''}` }, () => {
      const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: lint failures"' } });
      const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

      assert.strictEqual(result.output, input);
      assert.strictEqual(result.exitCode, 2);
      assert.ok(stderr.includes('ESLint Issues'), `expected ESLint output, got: ${stderr}`);
      assert.ok(stderr.includes('eslint failed'), `expected ESLint failure text, got: ${stderr}`);
      assert.ok(stderr.includes('Pylint Issues'), `expected Pylint output, got: ${stderr}`);
      assert.ok(stderr.includes('pylint failed'), `expected Pylint failure text, got: ${stderr}`);
      assert.ok(stderr.includes('golint Issues'), `expected golint output, got: ${stderr}`);
      assert.ok(stderr.includes('main.go:1: lint failed'), `expected golint failure text, got: ${stderr}`);
    });
  });
})) passed++; else failed++;

if (test('stdin entry point truncates oversized input and preserves pass-through output', () => {
  const oversized = JSON.stringify({
    tool_input: {
      command: 'git status',
      filler: 'x'.repeat(1024 * 1024 + 1024)
    }
  });
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-commit-quality.js')], {
    input: oversized,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: 2 * 1024 * 1024
  });

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.length > 0, 'expected truncated payload to pass through');
  assert.ok(result.stdout.length <= 1024 * 1024, 'expected stdout to stay within hook input limit');
  assert.strictEqual(result.stdout, oversized.slice(0, result.stdout.length));
  assert.ok(result.stderr.includes('[Hook] Error:'), 'truncated JSON should be logged and allowed');
})) passed++; else failed++;

// --- Secret-scanner placeholder exclusion (false-positive fix, no false-negative) ---

if (test('isPlaceholderSecret suppresses obvious non-secret placeholders', () => {
  for (const v of ['process.env.API_KEY', '${API_KEY}', '<YOUR_KEY>', 'REPLACE_ME', 'CHANGEME', 'YOUR_API_KEY', '']) {
    assert.strictEqual(hook.isPlaceholderSecret(v), true, `should suppress placeholder: ${JSON.stringify(v)}`);
  }
})) passed++; else failed++;

if (test('isPlaceholderSecret does NOT suppress real high-entropy secrets', () => {
  for (const v of [
    'sk-live-abcdef0123456789ABCDEF',          // prefixed
    '9F8A7B6C5D4E3F2A1B0C9D8E7F6A5B4C',          // uppercase hex
    'JBSWY3DPEHPK3PXP',                           // base32 TOTP/HMAC seed
    '1234567890123456',                          // digit-only token
    'PROD_7F3A9C2E_LIVE_8821',                    // uppercase-with-underscore token
    'AbCd1234EfGh5678'                            // mixed token
  ]) {
    assert.strictEqual(hook.isPlaceholderSecret(v), false, `must NOT suppress real secret: ${v}`);
  }
})) passed++; else failed++;

// --- Conventional Commit policy ---

if (test('accepts every supported type with optional scopes', () => {
  const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'revert'];
  for (const type of types) {
    assert.deepStrictEqual(hook.validateCommitMessage(`git commit -m "${type}: add change"`).issues, [], type);
    assert.deepStrictEqual(hook.validateCommitMessage(`git commit -m "${type}(core): add change"`).issues, [], `${type} scope`);
  }
})) passed++; else failed++;

if (test('accepts breaking-change markers and breaking-change footers', () => {
  for (const message of [
    'feat!: change api',
    'feat(ui)!: change api',
    'feat(ui): change api\n\nBREAKING CHANGE: update clients.'
  ]) {
    assert.deepStrictEqual(hook.validateCommitMessage(`git commit -m "${message}"`).issues, [], message);
  }
})) passed++; else failed++;

if (test('accepts valid bodies without applying header rules to body text', () => {
  const message = [
    'fix(parser): handle empty input',
    '',
    'This body explains the change and ends with a period.',
    `${'body '.repeat(30)}Closes #123.`
  ].join('\n');
  const result = hook.validateCommitMessage(`git commit -m "${message}"`);

  assert.strictEqual(result.message.split(/\r?\n/, 1)[0], 'fix(parser): handle empty input');
  assert.deepStrictEqual(result.issues, []);
})) passed++; else failed++;

if (test('rejects invalid formats, uppercase values, empty subjects, and trailing periods', () => {
  const invalidMessages = [
    'update parser',
    'feature: add parser',
    'feat(): add parser',
    'feat(parser: add parser',
    'feat add parser',
    'FEAT: add parser',
    'feat: Add parser',
    'feat: add parser.'
  ];

  for (const message of invalidMessages) {
    const result = hook.validateCommitMessage(`git commit -m "${message}"`);
    assert.ok(result.issues.length > 0, `expected invalid message: ${message}`);
  }

  assert.ok(hook.validateCommitMessage('git commit -m "feat:"').issues.some(i => i.type === 'format' || i.type === 'subject-empty'));
})) passed++; else failed++;

if (test('enforces the 72-character header limit, not total message length', () => {
  const exactHeader = `feat: ${'x'.repeat(66)}`;
  const longHeader = `feat: ${'x'.repeat(67)}`;

  assert.strictEqual(exactHeader.length, 72);
  assert.ok(!hook.validateCommitMessage(`git commit -m "${exactHeader}"`).issues.some(i => i.type === 'length'));
  assert.ok(hook.validateCommitMessage(`git commit -m "${longHeader}"`).issues.some(i => i.type === 'length'));
})) passed++; else failed++;

if (test('extracts only standalone message options and supports attached or repeated values', () => {
  const valid = hook.validateCommitMessage('git commit --author="Dev --message invalid" -m"feat: add parser" -m "body ends."');

  assert.ok(valid, 'expected a validation result');
  assert.strictEqual(valid.message, 'feat: add parser\n\nbody ends.');
  assert.deepStrictEqual(valid.issues, []);

  const longForm = hook.validateCommitMessage('git commit --message "feat: add parser"');
  assert.ok(longForm, 'expected a long-form message validation result');
  assert.strictEqual(longForm.message, 'feat: add parser');
  assert.deepStrictEqual(longForm.issues, []);

  const dynamic = hook.validateCommitMessage('git commit -m "$MSG"');
  assert.ok(dynamic && dynamic.issues.length > 0, 'dynamic messages should be rejected as unverifiable');

  const firstCommand = hook.validateCommitMessage('git commit -m "feat: good"\ngit commit -m "BAD"');
  assert.ok(firstCommand, 'expected the first command to be parsed');
  assert.strictEqual(firstCommand.message, 'feat: good');
  assert.deepStrictEqual(firstCommand.issues, []);
})) passed++; else failed++;

if (test('does not treat unrelated command text as a git commit', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'debugger;\n');

    const input = JSON.stringify({
      tool_input: { command: 'printf \'git commit -m "Bad message"\'' }
    });
    const result = hook.evaluate(input);

    assert.strictEqual(result.exitCode, 0, 'unrelated commands should pass through');
  });
})) passed++; else failed++;

if (test('validates common git wrappers instead of allowing a bypass', () => {
  for (const command of [
    'sudo git commit -m "fix: Bad subject"',
    'env ECC_TEST=1 git commit -m "fix: Bad subject"',
    'command git commit -m "fix: Bad subject"'
  ]) {
    const result = hook.validateCommitMessage(command);
    assert.ok(result && result.issues.length > 0, `expected wrapper command to be validated: ${command}`);
  }
})) passed++; else failed++;

if (test('validates git commits with global git options', () => {
  for (const command of [
    'git -C /tmp/repo commit -m "fix: Bad subject"',
    'git --git-dir=/tmp/repo/.git commit -m "fix: Bad subject"',
    'git --work-tree /tmp/repo commit -m "fix: Bad subject"',
    'git -c user.name=ecc commit -m "fix: Bad subject"'
  ]) {
    const result = hook.validateCommitMessage(command);
    assert.ok(result && result.issues.length > 0, `expected global-option command to be validated: ${command}`);
  }
})) passed++; else failed++;

if (test('blocks assignment-prefixed git commits from bypassing validation', () => {
  const result = hook.validateCommitMessage('ECC_TEST=1 git commit -m "fix: Bad subject"');
  assert.ok(result && result.issues.length > 0, 'expected assignment-prefixed command to be validated');
})) passed++; else failed++;

if (test('blocks compound commands instead of validating only the first commit', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');

    const input = JSON.stringify({
      tool_input: { command: 'git commit -m "fix: good"; git commit -m "fix: Bad subject"' }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('Run multiple git commit commands separately'), `expected compound-command error, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('blocks dynamic commit messages that cannot be validated', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');

    const input = JSON.stringify({
      tool_input: { command: 'git commit -m "$MSG"' }
    });
    const result = hook.evaluate(input);

    assert.strictEqual(result.exitCode, 2);
  });
})) passed++; else failed++;

if (test('validates amend messages instead of bypassing the policy', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');

    const input = JSON.stringify({
      tool_input: { command: 'git commit --amend -m "fix: Bad subject"' }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('ERROR Subject should be lowercase'), `expected amend validation error, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('validates combined short options that include -m', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');

    const input = JSON.stringify({
      tool_input: { command: 'git commit -am "fix: Bad subject"' }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('ERROR Subject should be lowercase'), `expected combined-option validation error, got: ${stderr}`);
  });
})) passed++; else failed++;

// --- Quote-aware commit-message extraction (truncation fix) ---

if (test('captures full double-quoted -m message containing an apostrophe', () => {
  const res = hook.validateCommitMessage(`git commit -m "fix: don't crash on empty input"`);
  assert.ok(res, 'expected a validation result');
  assert.strictEqual(res.message, "fix: don't crash on empty input");
})) passed++; else failed++;

if (test('captures full single-quoted -m message containing a double quote', () => {
  const res = hook.validateCommitMessage(`git commit -m 'fix: handle the "edge" case'`);
  assert.strictEqual(res.message, 'fix: handle the "edge" case');
})) passed++; else failed++;

if (test('captures full double-quoted -m message with escaped inner quotes (not truncated)', () => {
  const res = hook.validateCommitMessage('git commit -m "fix: say \\"hello\\" to the user"');
  assert.ok(res, 'expected a validation result');
  assert.strictEqual(res.message, 'fix: say "hello" to the user');
})) passed++; else failed++;

if (test('measures length of the full message past an apostrophe (not the truncated prefix)', () => {
  const subject = "fix: it's a deliberately long commit subject that comfortably exceeds seventy-two chars";
  const res = hook.validateCommitMessage(`git commit -m "${subject}"`);
  assert.strictEqual(res.message, subject);
  assert.ok(res.issues.some(i => i.type === 'length'), 'full (>72) message should trigger a length issue');
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
