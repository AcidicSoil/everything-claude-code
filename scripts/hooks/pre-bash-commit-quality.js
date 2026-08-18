#!/usr/bin/env node
/**
 * PreToolUse Hook: Pre-commit Quality Check
 *
 * Runs quality checks before git commit commands:
 * - Detects staged files
 * - Runs linter on staged files (if available)
 * - Checks for common issues (console.log, TODO, etc.)
 * - Validates commit message format (if provided)
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Exit codes:
 *   0 - Success (allow commit)
 *   2 - Block commit (quality issues found)
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MAX_STDIN = 1024 * 1024; // 1MB limit
const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'revert'];
const COMMIT_HEADER_MAX_LENGTH = 72;

/**
 * Detect staged files for commit
 * @returns {string[]} Array of staged file paths
 */
function getStagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.trim().split('\n').filter(f => f.length > 0);
}

function getStagedFileContent(filePath) {
  const result = spawnSync('git', ['show', `:${filePath}`], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

/**
 * Check if a file should be quality-checked
 * @param {string} filePath 
 * @returns {boolean}
 */
function shouldCheckFile(filePath) {
  const checkableExtensions = ['.js', '.jsx', '.ts', '.tsx', '.py', '.go', '.rs'];
  return checkableExtensions.some(ext => filePath.endsWith(ext));
}

/**
 * Decide whether a captured api-key value is an OBVIOUS non-secret placeholder so
 * the heuristic generic api-key rule does not emit a false positive. Deliberately
 * narrow: only suppresses whole-value env references / interpolations / angle-bracket
 * tokens and a short explicit whitelist of placeholder + env-var NAME tokens. It must
 * NOT suppress arbitrary high-entropy data (uppercase-hex, base32, digit-only, mixed
 * tokens), since the generic rule is the only net catching non-prefixed secrets and a
 * false-negative there is the safety-critical failure this hook exists to prevent.
 * @param {string} value
 * @returns {boolean}
 */
function isPlaceholderSecret(value) {
  const v = (value || '').trim();
  if (v.length === 0) return true;                                  // empty value
  if (/^process\.env\.[A-Za-z0-9_]+$/.test(v)) return true;          // entire value is a process.env.NAME reference
  if (/^\$\{[^}]*\}$/.test(v)) return true;                          // entire value is a ${...} interpolation
  if (/^<[^<>]*>$/.test(v)) return true;                             // entire value is a <PLACEHOLDER> token
  // Short explicit whitelist of placeholder + env-var NAME tokens (whole-value match only).
  // No general all-caps clause: real all-caps/hex/base32/digit secrets must still flag.
  if (/^(REPLACE_ME|CHANGE_?ME|YOUR[_-]?API[_-]?KEY|YOUR[_-]?KEY[_-]?HERE|API[_-]?KEY|SECRET|TOKEN|KEY|TODO|TBD|FIXME|XXX+)$/i.test(v)) return true;
  return false;
}

/**
 * Find issues in file content
 * @param {string} filePath
 * @returns {object[]} Array of issues found
 */
function findFileIssues(filePath) {
  const issues = [];
  
  try {
    const content = getStagedFileContent(filePath);
    if (content === null || content === undefined) {
      return issues;
    }
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      
      // Check for console.log
      if (line.includes('console.log') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        issues.push({
          type: 'console.log',
          message: `console.log found at line ${lineNum}`,
          line: lineNum,
          severity: 'warning'
        });
      }
      
      // Check for debugger statements
      if (/\bdebugger\b/.test(line) && !line.trim().startsWith('//')) {
        issues.push({
          type: 'debugger',
          message: `debugger statement at line ${lineNum}`,
          line: lineNum,
          severity: 'error'
        });
      }
      
      // Check for TODO/FIXME without issue reference
      const todoMatch = line.match(/\/\/\s*(TODO|FIXME):?\s*(.+)/);
      if (todoMatch && !todoMatch[2].match(/#\d+|issue/i)) {
        issues.push({
          type: 'todo',
          message: `TODO/FIXME without issue reference at line ${lineNum}: "${todoMatch[2].trim()}"`,
          line: lineNum,
          severity: 'info'
        });
      }
      
      // Check for hardcoded secrets (basic patterns)
      const secretPatterns = [
        { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, name: 'Anthropic API key' },
        { pattern: /sk-[a-zA-Z0-9]{20,}/, name: 'OpenAI API key' },
        { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub PAT' },
        { pattern: /AKIA[A-Z0-9]{16}/, name: 'AWS Access Key' },
        // Capture the quoted value so obvious non-secret placeholders can be excluded
        { pattern: /api[_-]?key\s*[=:]\s*['"]([^'"]+)['"]/i, name: 'API key', valueGroup: 1 },
        // Unquoted form (API_KEY=..., api_key: ... without quotes). Scoped to a
        // single alnum/underscore/hyphen token of 12+ chars containing at least
        // one digit — real secrets are near-always alphanumeric, whereas bare
        // identifiers/expressions common in this hook's checkable languages
        // (config.apiKey, getApiKey(), process.env.API_KEY) are pure-alpha or
        // contain '.'/'(' that fall outside the character class, so they don't
        // match. Kept deliberately narrow to avoid flagging ordinary code.
        { pattern: /api[_-]?key\s*[=:]\s*(?!['"])((?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{12,})/i, name: 'API key', valueGroup: 1 }
      ];
      
      for (const { pattern, name, valueGroup } of secretPatterns) {
        const secretMatch = line.match(pattern);
        if (secretMatch && !(valueGroup && isPlaceholderSecret(secretMatch[valueGroup]))) {
          issues.push({
            type: 'secret',
            message: `Potential ${name} exposed at line ${lineNum}`,
            line: lineNum,
            severity: 'error'
          });
        }
      }
    });
  } catch {
    // File not readable, skip
  }
  
  return issues;
}

function parseShellCommand(command) {
  const tokens = [];
  let value = '';
  let dynamic = false;
  let quote = null;
  let started = false;

  const pushWord = () => {
    if (started) {
      tokens.push({ value, dynamic, operator: false });
      value = '';
      dynamic = false;
      started = false;
    }
  };

  for (let index = 0; index < command.length; index++) {
    const char = command[index];

    if (quote === "'") {
      if (char === "'") quote = null;
      else value += char;
      started = true;
      continue;
    }

    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && index + 1 < command.length) value += command[++index];
      else {
        if (char === '$' || char === '`') dynamic = true;
        value += char;
      }
      started = true;
      continue;
    }

    if (char === '\n' || char === '\r') {
      pushWord();
      tokens.push({ value: ';', dynamic: false, operator: true });
      if (char === '\r' && command[index + 1] === '\n') index++;
      continue;
    }

    if (/\s/.test(char)) {
      pushWord();
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }

    if (char === '\\' && index + 1 < command.length) {
      value += command[++index];
      started = true;
      continue;
    }

    if (';&|'.includes(char)) {
      pushWord();
      const next = command[index + 1];
      const operator = (char === '&' && next === '&') || (char === '|' && next === '|')
        ? `${char}${next}`
        : char;
      tokens.push({ value: operator, dynamic: false, operator: true });
      if (operator.length === 2) index++;
      continue;
    }

    if (char === '$' || char === '`') dynamic = true;
    value += char;
    started = true;
  }

  if (quote) return null;
  pushWord();
  return tokens;
}

function isGitExecutable(value) {
  return value === 'git' || /[\\/]git(?:\.exe)?$/i.test(value);
}

function findGitExecutable(tokens, start, end) {
  let index = start;
  while (index < end && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index].value)) index++;

  const first = tokens[index]?.value;
  if (isGitExecutable(first)) return index;

  if (first === 'sudo') {
    index++;
    while (index < end && tokens[index].value.startsWith('-')) {
      const option = tokens[index++].value;
      if (['-u', '--user', '-g', '--group', '-C', '--chdir'].includes(option)) index++;
    }
  } else if (first === 'env') {
    index++;
    while (index < end) {
      const value = tokens[index].value;
      if (value.startsWith('-')) {
        index++;
      } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(value)) {
        index++;
      } else {
        break;
      }
    }
  } else if (first === 'command') {
    index++;
    while (index < end && tokens[index].value.startsWith('-')) index++;
  } else if (['nice', 'nohup', 'exec'].includes(first)) {
    index++;
    while (index < end && tokens[index].value.startsWith('-')) {
      const option = tokens[index++].value;
      if (option === '-a' || option === '-n') index++;
    }
  }

  return index < end && isGitExecutable(tokens[index].value) ? index : -1;
}

function getDirectGitCommitCommandInfo(tokens) {
  const valueOptions = new Set([
    '-C', '--git-dir', '--work-tree', '--namespace', '-c', '--config-env',
    '--exec-path', '--super-prefix'
  ]);
  const commitInfos = [];
  let segmentStart = 0;

  for (let index = 0; index <= tokens.length; index++) {
    if (index < tokens.length && !tokens[index].operator) continue;

    const segmentEnd = index;
    const gitIndex = findGitExecutable(tokens, segmentStart, segmentEnd);
    if (gitIndex !== -1) {
      const gitOptions = [];
      let nextIndex = gitIndex + 1;
      while (nextIndex < segmentEnd) {
        const next = tokens[nextIndex].value;
        if (next === 'commit') {
          commitInfos.push({
            args: tokens.slice(nextIndex + 1, segmentEnd),
            gitOptions
          });
          break;
        }
        if (!next.startsWith('-')) break;
        gitOptions.push(next);
        nextIndex++;
        if (valueOptions.has(next)) {
          if (nextIndex < segmentEnd) gitOptions.push(tokens[nextIndex].value);
          nextIndex++;
        }
      }
    }

    segmentStart = index + 1;
  }

  return commitInfos;
}

function isShellExecutable(value) {
  return /(?:^|[\\/])(?:sh|bash|zsh|dash|ksh)(?:\.exe)?$/i.test(value);
}

function getShellWrapperCommands(tokens) {
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index].value)) index++;

  const first = tokens[index]?.value;
  if (!['sudo', 'env', 'command', 'exec', 'nice', 'nohup'].includes(first) && !isShellExecutable(first)) {
    return [];
  }

  const commands = [];
  for (; index < tokens.length; index++) {
    if (!isShellExecutable(tokens[index].value)) continue;
    const option = tokens[index + 1]?.value || '';
    if (option !== '-c' && !(/^-[^-]*c/.test(option))) continue;
    const script = tokens[index + 2];
    if (script && !script.operator) commands.push(script.value);
  }
  return commands;
}

function getCommandSubstitutions(command) {
  const substitutions = [];
  let quote = null;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') index++;
      else if (char === '"') quote = null;
      else if (char === '`') {
        const end = findBacktickSubstitutionEnd(command, index + 1);
        if (end !== -1) {
          substitutions.push(command.slice(index + 1, end));
          index = end;
        }
      } else if (char === '$' && command[index + 1] === '(') {
        const end = findCommandSubstitutionEnd(command, index + 2);
        if (end !== -1) {
          substitutions.push(command.slice(index + 2, end));
          index = end;
        }
      }
      continue;
    }
    if (char === "'") {
      quote = char;
    } else if (char === '"') {
      quote = char;
    } else if (char === '`') {
      const end = findBacktickSubstitutionEnd(command, index + 1);
      if (end !== -1) {
        substitutions.push(command.slice(index + 1, end));
        index = end;
      }
    } else if (char === '$' && command[index + 1] === '(') {
      const end = findCommandSubstitutionEnd(command, index + 2);
      if (end !== -1) {
        substitutions.push(command.slice(index + 2, end));
        index = end;
      }
    }
  }

  return substitutions;
}

function findBacktickSubstitutionEnd(command, start) {
  for (let index = start; index < command.length; index++) {
    if (command[index] === '\\') {
      index++;
    } else if (command[index] === '`') {
      return index;
    }
  }
  return -1;
}

function findCommandSubstitutionEnd(command, start) {
  let depth = 1;
  let quote = null;

  for (let index = start; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\') index++;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'") quote = char;
    else if (char === '"') quote = char;
    else if (char === '$' && command[index + 1] === '(') {
      depth++;
      index++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function getCommitCommandTokenLists(command, seen = new Set()) {
  if (seen.has(command)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(command);

  const tokens = parseShellCommand(command);
  if (!tokens) return [];

  const commitInfos = getDirectGitCommitCommandInfo(tokens);
  for (const wrappedCommand of getShellWrapperCommands(tokens)) {
    commitInfos.push(...getCommitCommandTokenLists(wrappedCommand, nextSeen));
  }
  for (const substitution of getCommandSubstitutions(command)) {
    commitInfos.push(...getCommitCommandTokenLists(substitution, nextSeen));
  }
  return commitInfos;
}

function getCommitCommandInfo(command) {
  return getCommitCommandTokenLists(command)[0] ?? null;
}

function readOptionArgument(args, index, attachedValue = '') {
  if (attachedValue) {
    return args[index].dynamic
      ? { value: '', nextIndex: index }
      : { value: attachedValue, nextIndex: index };
  }

  const next = args[index + 1];
  if (!next || next.operator || next.dynamic) return { value: '', nextIndex: index };
  return { value: next.value, nextIndex: index + 1 };
}

function getInheritedCommitMessage(revision, gitOptions = []) {
  const result = spawnSync('git', [...gitOptions, 'show', '-s', '--format=%B', '--', revision], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
    maxBuffer: MAX_STDIN
  });
  return result.status === 0 ? result.stdout : '';
}

function extractCommitMessage(command) {
  const commitInfo = getCommitCommandInfo(command);
  const args = commitInfo?.args ?? null;
  if (!args) return null;

  const messages = [];
  let inheritedRevision = null;
  let inheritedMessage = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.operator || arg.value === '--') break;

    if (arg.value === '-m' || arg.value === '--message') {
      const parsed = readOptionArgument(args, index);
      if (!parsed.value && parsed.nextIndex === index) return '';
      messages.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }

    if (arg.value.startsWith('--message=')) {
      if (arg.value === '--message=') {
        messages.push('');
        continue;
      }
      const parsed = readOptionArgument(args, index, arg.value.slice('--message='.length));
      if (!parsed.value) return '';
      messages.push(parsed.value);
      continue;
    }

    if (arg.value === '--no-edit') {
      inheritedMessage = true;
      continue;
    }

    if (arg.value === '-C' || arg.value === '-c' || arg.value === '--reuse-message' || arg.value === '--reedit-message') {
      const parsed = readOptionArgument(args, index);
      if (!parsed.value && parsed.nextIndex === index) return '';
      inheritedMessage = true;
      inheritedRevision = parsed.value;
      index = parsed.nextIndex;
      continue;
    }

    if (arg.value.startsWith('--reuse-message=') || arg.value.startsWith('--reedit-message=')) {
      const revision = arg.value.slice(arg.value.indexOf('=') + 1);
      if (!revision || arg.dynamic) return '';
      inheritedMessage = true;
      inheritedRevision = revision;
      continue;
    }

    if (arg.value.startsWith('-') && !arg.value.startsWith('--')) {
      const shortOptions = arg.value.slice(1);
      for (let optionIndex = 0; optionIndex < shortOptions.length; optionIndex++) {
        const option = shortOptions[optionIndex];
        if (option === 'm') {
          const attachedMessage = shortOptions.slice(optionIndex + 1);
          const parsed = readOptionArgument(args, index, attachedMessage);
          if (!parsed.value && parsed.nextIndex === index) return '';
          messages.push(parsed.value);
          index = parsed.nextIndex;
          break;
        }
        if (option === 'c' || option === 'C') {
          const revision = shortOptions.slice(optionIndex + 1);
          const parsed = readOptionArgument(args, index, revision);
          if (!parsed.value && parsed.nextIndex === index) return '';
          inheritedMessage = true;
          inheritedRevision = parsed.value;
          index = parsed.nextIndex;
          break;
        }
        if (option === 'F') return '';
        if (option === 'S') break;
      }
      continue;
    }

    if (arg.value.startsWith('--file') || arg.value === '--template' || arg.value.startsWith('--fixup') || arg.value.startsWith('--squash')) {
      return '';
    }

    const longOption = arg.value.split('=', 1)[0];
    if (['--author', '--date', '--cleanup', '--encoding', '--trailer'].includes(longOption) && !arg.value.includes('=')) {
      const parsed = readOptionArgument(args, index);
      if (parsed.nextIndex !== index) index = parsed.nextIndex;
    }
  }

  if (messages.length > 0) return messages.join('\n\n');
  if (inheritedMessage) return getInheritedCommitMessage(inheritedRevision || 'HEAD', commitInfo.gitOptions);
  return null;
}

/**
 * Validate commit message format
 * @param {string} command
 * @returns {object|null} Validation result or null if no message to validate
 */
function validateCommitMessage(command) {
  const message = extractCommitMessage(command);
  if (message === null) return null;
  const header = message.split(/\r?\n/, 1)[0];
  const issues = [];
  const conventionalCommit = /^([A-Za-z][A-Za-z0-9-]*)(?:\(([^()\r\n]*)\))?(!?):([^\r\n]*)$/;
  const match = header.match(conventionalCommit);

  if (!match) {
    issues.push({
      type: 'format',
      message: 'Commit message does not follow conventional commit format',
      suggestion: 'Use format: type(scope)!: description (e.g., "feat(auth): add login flow")'
    });
  } else {
    const [, type, scope, , rawSubject] = match;
    const subject = rawSubject.trimStart();

    if (!COMMIT_TYPES.includes(type)) {
      issues.push({
        type: 'type',
        message: `Commit type must be one of: ${COMMIT_TYPES.join(', ')}`,
        suggestion: 'Use a lowercase Conventional Commit type'
      });
    }

    if (scope !== undefined && scope.trim().length === 0) {
      issues.push({
        type: 'scope',
        message: 'Commit scope must not be empty',
        suggestion: 'Remove the empty scope or provide a scope name'
      });
    }

    if (subject.trim().length > 0 && !/^\s+/.test(rawSubject)) {
      issues.push({
        type: 'format',
        message: 'Commit header must include a space after the colon',
        suggestion: 'Use format: type(scope)!: description'
      });
    }

    if (subject.trim().length === 0) {
      issues.push({
        type: 'subject-empty',
        message: 'Commit subject must not be empty',
        suggestion: 'Add a lowercase subject after the colon'
      });
    } else if (subject !== subject.toLowerCase()) {
      issues.push({
        type: 'capitalization',
        message: 'Subject should be lowercase',
        suggestion: 'Use lowercase for the entire subject'
      });
    }

    if (subject.trimEnd().endsWith('.')) {
      issues.push({
        type: 'punctuation',
        message: 'Commit message should not end with a period',
        suggestion: 'Remove the trailing period from the subject'
      });
    }
  }

  if (header.length > COMMIT_HEADER_MAX_LENGTH) {
    issues.push({
      type: 'length',
      message: `Commit message header too long (${header.length} chars, max ${COMMIT_HEADER_MAX_LENGTH})`,
      suggestion: `Keep the first line at most ${COMMIT_HEADER_MAX_LENGTH} characters`
    });
  }

  return { message, issues };
}

function getPathEnv() {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
  return process.env[pathKey] || '';
}

function isPathLike(command) {
  return command.includes(path.sep) || (process.platform === 'win32' && /[\\/]/.test(command));
}

function getExecutableCandidates(command) {
  if (process.platform !== 'win32' || path.extname(command)) {
    return [command];
  }

  const pathExt = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return [command, ...pathExt.split(';').filter(Boolean).map(ext => `${command}${ext.toLowerCase()}`)];
}

function resolveCommand(command) {
  if (isPathLike(command)) {
    return getExecutableCandidates(command).find(candidate => fs.existsSync(candidate)) || null;
  }

  for (const dir of getPathEnv().split(path.delimiter).filter(Boolean)) {
    for (const candidate of getExecutableCandidates(path.join(dir, command))) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function runLinterCommand(command, args) {
  const useShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
  if (useShell && args.some(arg => /[&|<>()[\]^%!`"'\r\n]/.test(arg))) {
    return {
      status: 1,
      stdout: '',
      stderr: 'Unsafe linter argument rejected on Windows'
    };
  }

  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
    shell: useShell
  });
}

function commandOutput(result) {
  return result.stdout || result.stderr || result.error?.message || '';
}

/**
 * Run linter on staged files
 * @param {string[]} files 
 * @returns {object} Lint results
 */
function runLinter(files) {
  const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx)$/.test(f));
  const pyFiles = files.filter(f => f.endsWith('.py'));
  const goFiles = files.filter(f => f.endsWith('.go'));
  
  const results = {
    eslint: null,
    pylint: null,
    golint: null
  };
  
  // Run ESLint if available
  if (jsFiles.length > 0) {
    const eslintBin = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    const eslintPath = path.join(process.cwd(), 'node_modules', '.bin', eslintBin);
    if (fs.existsSync(eslintPath)) {
      const result = runLinterCommand(eslintPath, ['--format', 'compact', ...jsFiles]);
      results.eslint = {
        success: result.status === 0,
        output: commandOutput(result)
      };
    }
  }
  
  // Run Pylint if available
  if (pyFiles.length > 0) {
    try {
      const pylintPath = resolveCommand('pylint');
      if (!pylintPath) {
        results.pylint = null;
      } else {
        const result = runLinterCommand(pylintPath, ['--output-format=text', ...pyFiles]);
        results.pylint = {
          success: result.status === 0,
          output: commandOutput(result)
        };
      }
    } catch {
      // Pylint not available
    }
  }
  
  // Run golint if available
  if (goFiles.length > 0) {
    try {
      const golintPath = resolveCommand('golint');
      if (!golintPath) {
        results.golint = null;
      } else {
        const result = runLinterCommand(golintPath, goFiles);
        results.golint = {
          success: !result.stdout || result.stdout.trim() === '',
          output: commandOutput(result)
        };
      }
    } catch {
      // golint not available
    }
  }
  
  return results;
}

/**
 * Core logic — exported for direct invocation
 * @param {string} rawInput - Raw JSON string from stdin
 * @returns {{output:string, exitCode:number}} Pass-through output and exit code
 */
function evaluate(rawInput) {
  try {
    const input = JSON.parse(rawInput);
    const command = input.tool_input?.command || '';
    
    // Only run for actual git commit commands
    const commitCommands = getCommitCommandTokenLists(command);
    if (commitCommands.length === 0) {
      return { output: rawInput, exitCode: 0 };
    }
    if (commitCommands.length > 1) {
      console.error('[Hook] ERROR: Run multiple git commit commands separately so each message can be validated.');
      console.error('[Hook] To bypass these checks, use: git commit --no-verify');
      return { output: rawInput, exitCode: 2 };
    }
    // Get staged files
    const stagedFiles = getStagedFiles();
    
    if (stagedFiles.length === 0) {
      console.error('[Hook] No staged files found. Use "git add" to stage files first.');
    } else {
      console.error(`[Hook] Checking ${stagedFiles.length} staged file(s)...`);
    }

    // Check each staged file
    const filesToCheck = stagedFiles.filter(shouldCheckFile);
    let totalIssues = 0;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    
    for (const file of filesToCheck) {
      const fileIssues = findFileIssues(file);
      if (fileIssues.length > 0) {
        console.error(`\n[FILE] ${file}`);
        for (const issue of fileIssues) {
          const label = issue.severity === 'error' ? 'ERROR' : issue.severity === 'warning' ? 'WARNING' : 'INFO';
          console.error(`  ${label} Line ${issue.line}: ${issue.message}`);
          totalIssues++;
          if (issue.severity === 'error') errorCount++;
          if (issue.severity === 'warning') warningCount++;
          if (issue.severity === 'info') infoCount++;
        }
      }
    }
    
    // Validate commit message if provided
    const messageValidation = validateCommitMessage(command);
    if (messageValidation && messageValidation.issues.length > 0) {
      console.error('\nCommit Message Issues:');
      for (const issue of messageValidation.issues) {
        console.error(`  ERROR ${issue.message}`);
        if (issue.suggestion) {
          console.error(`     TIP ${issue.suggestion}`);
        }
        totalIssues++;
        errorCount++;
      }
    }
    
    // Run linter
    const lintResults = runLinter(filesToCheck);
    
    if (lintResults.eslint && !lintResults.eslint.success) {
      console.error('\nESLint Issues:');
      console.error(lintResults.eslint.output);
      totalIssues++;
      errorCount++;
    }
    
    if (lintResults.pylint && !lintResults.pylint.success) {
      console.error('\nPylint Issues:');
      console.error(lintResults.pylint.output);
      totalIssues++;
      errorCount++;
    }
    
    if (lintResults.golint && !lintResults.golint.success) {
      console.error('\ngolint Issues:');
      console.error(lintResults.golint.output);
      totalIssues++;
      errorCount++;
    }
    
    // Summary
    if (totalIssues > 0) {
      console.error(`\nSummary: ${totalIssues} issue(s) found (${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info)`);
      
      if (errorCount > 0) {
        console.error('\n[Hook] ERROR: Commit blocked due to critical issues. Fix them before committing.');
        console.error('[Hook] To bypass these checks, use: git commit --no-verify');
        return { output: rawInput, exitCode: 2 };
      } else {
        console.error('\n[Hook] WARNING: Warnings found. Consider fixing them, but commit is allowed.');
        console.error('[Hook] To bypass these checks, use: git commit --no-verify');
      }
    } else {
      console.error('\n[Hook] PASS: All checks passed!');
    }
    
  } catch (error) {
    console.error(`[Hook] Error: ${error.message}`);
    // Non-blocking on error
  }
  
  return { output: rawInput, exitCode: 0 };
}

function run(rawInput) {
  const result = evaluate(rawInput);
  return {
    stdout: result.output,
    exitCode: result.exitCode,
  };
}

// ── stdin entry point ────────────────────────────────────────────
if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += chunk.substring(0, remaining);
    }
  });
  
  process.stdin.on('end', () => {
    const result = evaluate(data);
    process.stdout.write(result.output);
    process.exit(result.exitCode);
  });
}

module.exports = { run, evaluate, validateCommitMessage, findFileIssues, isPlaceholderSecret };
