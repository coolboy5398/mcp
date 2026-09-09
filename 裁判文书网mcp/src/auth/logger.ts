/**
 * AuthManager 日志工具
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDebugEnabled } from '../utils/debug.js';
import { sanitizeLogMessage } from '../utils/sanitize.js';

/**
 * AuthManager 专用日志器
 */
export class AuthLogger {
    private readonly logFilePath: string;

    constructor(sessionPath: string) {
        this.logFilePath = path.join(sessionPath, 'debug.log');
    }

    /**
     * 调试日志，仅在 DEBUG 开启时输出
     */
    debug(message: string): void {
        if (!isDebugEnabled()) {
            return;
        }
        this.write('DEBUG', message);
    }

    /**
     * 写入调试日志（兼容旧调用，等同 debug）
     */
    log(message: string): void {
        this.debug(message);
    }

    /**
     * 输出警告日志（始终输出，消息经脱敏）
     */
    warn(message: string): void {
        this.write('WARN', sanitizeLogMessage(message));
    }

    /**
     * 输出错误日志（始终输出，消息经脱敏）
     */
    error(message: string): void {
        this.write('ERROR', sanitizeLogMessage(message));
    }

    private write(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] [${level}] ${message}\n`;

        try {
            const dir = path.dirname(this.logFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.appendFileSync(this.logFilePath, logLine, 'utf-8');
        } catch (error) {
            console.error(`写入日志文件失败: ${sanitizeLogMessage(String(error))}`);
        }

        console.error(`[${level}] ${message}`);
    }
}

/**
 * 创建 AuthManager 日志器
 */
export function createAuthLogger(sessionPath: string): AuthLogger {
    return new AuthLogger(sessionPath);
}
