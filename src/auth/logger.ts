/**
 * AuthManager 日志工具
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * AuthManager 专用日志器
 */
export class AuthLogger {
    private readonly logFilePath: string;

    constructor(sessionPath: string) {
        this.logFilePath = path.join(sessionPath, 'debug.log');
    }

    /**
     * 写入调试日志到文件并输出到 stderr
     */
    log(message: string): void {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;

        try {
            const dir = path.dirname(this.logFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.appendFileSync(this.logFilePath, logLine, 'utf-8');
        } catch (error) {
            console.error(`写入日志文件失败: ${error}`);
        }

        console.error(message);
    }

    /**
     * 输出警告日志
     */
    warn(message: string): void {
        this.log(`[WARN] ${message}`);
    }

    /**
     * 输出错误日志
     */
    error(message: string): void {
        this.log(`[ERROR] ${message}`);
    }
}

/**
 * 创建 AuthManager 日志器
 */
export function createAuthLogger(sessionPath: string): AuthLogger {
    return new AuthLogger(sessionPath);
}
