import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 120_000;
const LOG_PREFIX = '[freellmapi-git]';

export class GitPusherError extends Error {
    constructor(message, { log } = {}) {
        super(message);
        this.name = 'GitPusherError';
        this.log = log;
    }
}

function repoRoot() {
    return process.env.FREELLMAPI_REPO_ROOT || '/freellmapi-repo';
}

function scriptPath(root) {
    return path.join(root, 'push-to-git.sh');
}

function runScript(args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const root = repoRoot();
    const script = scriptPath(root);
    if (!fs.existsSync(script)) {
        throw new GitPusherError(`Не найден ${script}. Смонтируйте репозиторий в FREELLMAPI_REPO_ROOT.`);
    }
    return new Promise((resolve, reject) => {
        const child = spawn('bash', [script, ...args], {
            cwd: root,
            env: { ...process.env, FREELLMAPI_REPO_ROOT: root },
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new GitPusherError('Таймаут 120 с: git всё ещё выполняется', {
                log: `${stdout}\n${stderr}`.trim(),
            }));
        }, timeoutMs);
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', (err) => {
            clearTimeout(timer);
            reject(new GitPusherError(err.message, { log: stderr || stdout }));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            const raw = stdout.trim();
            if (!raw) {
                reject(new GitPusherError(
                    stderr.trim() || `push-to-git.sh завершился с кодом ${code}`,
                    { log: stderr.trim() },
                ));
                return;
            }
            try {
                const parsed = JSON.parse(raw);
                if (code !== 0 || parsed.ok === false) {
                    reject(new GitPusherError(parsed.message || 'git push не удался', { log: parsed.log }));
                    return;
                }
                resolve(parsed);
            }
            catch {
                reject(new GitPusherError(
                    'push-to-git.sh вернул не JSON',
                    { log: `${raw}\n${stderr}`.trim() },
                ));
            }
        });
    });
}

export async function runGitPush({ message } = {}) {
    const args = ['--json', '--no-wait'];
    if (message?.trim())
        args.push('--message', message.trim());
    console.log(`${LOG_PREFIX} start root=${repoRoot()}`);
    const result = await runScript(args);
    console.log(`${LOG_PREFIX} ${result.message}`);
    return result;
}
