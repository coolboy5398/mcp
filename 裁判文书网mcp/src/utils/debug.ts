/**
 * 调试日志开关
 * 由 server 启动时根据 DEBUG 环境变量初始化
 */

let debugEnabled = false;

export function setDebugEnabled(enabled: boolean): void {
    debugEnabled = enabled;
}

export function isDebugEnabled(): boolean {
    return debugEnabled;
}

/**
 * 仅在 DEBUG 开启时输出到 stderr
 */
export function debugLog(message: string): void {
    if (!debugEnabled) {
        return;
    }
    console.error(message);
}

/**
 * 从环境变量解析 DEBUG 开关
 */
export function parseDebugEnv(value?: string): boolean {
    if (value === undefined) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}
