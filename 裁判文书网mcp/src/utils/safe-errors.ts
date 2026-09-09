/**
 * 生产环境安全错误响应开关
 * 开启后 INTERNAL_ERROR 不向客户端返回原始错误详情
 */

import { sanitizeErrorMessage } from './sanitize.js';

const SAFE_INTERNAL_MESSAGE = '内部服务异常，请稍后重试';

let safeErrorsEnabled = false;

export function setSafeErrorsEnabled(enabled: boolean): void {
    safeErrorsEnabled = enabled;
}

export function isSafeErrorsEnabled(): boolean {
    return safeErrorsEnabled;
}

/**
 * 从环境变量解析安全错误模式
 * MCP_SAFE_ERRORS 显式设置优先于 NODE_ENV
 */
export function parseSafeErrorsEnv(nodeEnv?: string, explicit?: string): boolean {
    if (explicit !== undefined && explicit.trim() !== '') {
        const normalized = explicit.trim().toLowerCase();
        if (normalized === 'false' || normalized === '0' || normalized === 'no') {
            return false;
        }
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }

    return nodeEnv?.trim().toLowerCase() === 'production';
}

/**
 * 获取可返回给客户端的错误消息
 */
export function getClientErrorMessage(message: string, isInternal = false): string {
    if (safeErrorsEnabled && isInternal) {
        return SAFE_INTERNAL_MESSAGE;
    }
    return sanitizeErrorMessage(message);
}

/**
 * 将内部错误写入服务端日志（stderr）
 */
export function logInternalError(error: unknown): void {
    if (error instanceof Error) {
        console.error(`[INTERNAL] ${error.name}: ${sanitizeErrorMessage(error.message)}`);
        return;
    }

    console.error(`[INTERNAL] ${sanitizeErrorMessage(String(error))}`);
}

export { SAFE_INTERNAL_MESSAGE };
