/**
 * 日志与错误消息脱敏工具
 * 剥离可能泄露本地环境信息的绝对路径
 */

const WINDOWS_PATH_BACKSLASH_RE = /[A-Za-z]:\\(?:[^\\:\s*?"<>|\n]+\\)*[^\\:\s*?"<>|\n]*/g;
const WINDOWS_PATH_SLASH_RE = /[A-Za-z]:\/(?:[^/:\s*?"<>|\n]+\/)*[^/:\s*?"<>|\n]*/g;
const UNIX_ABSOLUTE_PATH_RE = /\/(?:Users|home|var|tmp|opt|etc|usr|mcp|data|app|srv|root)(?:\/[^\s:*?"<>|)]+)+/gi;
const FILE_URI_RE = /file:\/\/\/[^\s)]+/gi;

/**
 * 脱敏日志消息中的本地路径
 */
export function sanitizeLogMessage(message: string): string {
    return message
        .replace(FILE_URI_RE, '[path]')
        .replace(WINDOWS_PATH_BACKSLASH_RE, '[path]')
        .replace(WINDOWS_PATH_SLASH_RE, '[path]')
        .replace(UNIX_ABSOLUTE_PATH_RE, '[path]');
}

/**
 * 脱敏错误消息中的本地路径
 */
export function sanitizeErrorMessage(message: string): string {
    return sanitizeLogMessage(message);
}

function sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string') {
        return sanitizeErrorMessage(value);
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeValue);
    }
    if (value && typeof value === 'object') {
        const sanitized: Record<string, unknown> = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            sanitized[key] = sanitizeValue(nestedValue);
        }
        return sanitized;
    }
    return value;
}

/**
 * 脱敏错误详情中的字符串字段（支持嵌套对象）
 */
export function sanitizeDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!details) {
        return undefined;
    }

    return sanitizeValue(details) as Record<string, unknown>;
}
