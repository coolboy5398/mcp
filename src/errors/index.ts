/**
 * 错误处理模块
 * 定义裁判文书网MCP服务器的错误类型和错误处理
 * 需求: 6.1, 6.2, 6.3
 */

/**
 * 错误代码枚举
 */
export enum ErrorCode {
    /** 参数无效 */
    INVALID_PARAMS = "INVALID_PARAMS",
    /** 未找到 */
    NOT_FOUND = "NOT_FOUND",
    /** 服务不可用 */
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
    /** 请求限流 */
    RATE_LIMITED = "RATE_LIMITED",
    /** 内部错误 */
    INTERNAL_ERROR = "INTERNAL_ERROR",
    /** 需要登录 */
    AUTH_REQUIRED = "AUTH_REQUIRED",
    /** 登录过期 */
    AUTH_EXPIRED = "AUTH_EXPIRED",
}

/**
 * MCP错误接口
 */
export interface MCPErrorInfo {
    /** 错误代码 */
    code: ErrorCode;
    /** 错误消息 */
    message: string;
    /** 错误详情 */
    details?: Record<string, unknown>;
    /** 重试等待时间（秒），用于限流错误 */
    retryAfter?: number;
    /** 二维码URL，用于需要登录错误 */
    qrCodeUrl?: string;
}

/**
 * 基础MCP错误类
 */
export class MCPError extends Error {
    public readonly code: ErrorCode;
    public readonly details?: Record<string, unknown>;
    public readonly retryAfter?: number;

    constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, retryAfter?: number) {
        super(message);
        this.name = "MCPError";
        this.code = code;
        this.details = details;
        this.retryAfter = retryAfter;
    }

    /**
     * 转换为MCP错误信息对象
     */
    toErrorInfo(): MCPErrorInfo {
        return {
            code: this.code,
            message: this.message,
            details: this.details,
            retryAfter: this.retryAfter,
        };
    }

    /**
     * 转换为MCP响应格式
     */
    toMCPResponse(): { isError: true; content: Array<{ type: "text"; text: string }> } {
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: JSON.stringify(this.toErrorInfo()),
                },
            ],
        };
    }
}

/**
 * 参数无效错误
 * 需求 6.3: 如果提供了无效参数，文书服务器应返回验证错误详情
 */
export class InvalidParamsError extends MCPError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(ErrorCode.INVALID_PARAMS, message, details);
        this.name = "InvalidParamsError";
    }
}

/**
 * 未找到错误
 */
export class NotFoundError extends MCPError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(ErrorCode.NOT_FOUND, message, details);
        this.name = "NotFoundError";
    }
}

/**
 * 服务不可用错误
 * 需求 6.1: 如果外部API不可用，文书服务器应返回服务不可用错误并提供重试指导
 */
export class ServiceUnavailableError extends MCPError {
    constructor(message: string, retryAfter?: number, details?: Record<string, unknown>) {
        super(ErrorCode.SERVICE_UNAVAILABLE, message, details, retryAfter);
        this.name = "ServiceUnavailableError";
    }
}

/**
 * 请求限流错误
 * 需求 6.2: 如果遇到请求限流，文书服务器应返回适当的限流信息
 */
export class RateLimitedError extends MCPError {
    constructor(message: string, retryAfter: number, details?: Record<string, unknown>) {
        super(ErrorCode.RATE_LIMITED, message, details, retryAfter);
        this.name = "RateLimitedError";
    }
}

/**
 * 内部错误
 */
export class InternalError extends MCPError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(ErrorCode.INTERNAL_ERROR, message, details);
        this.name = "InternalError";
    }
}

/**
 * 需要登录错误
 */
export class AuthRequiredError extends MCPError {
    public readonly qrCodeUrl?: string;

    constructor(message: string, qrCodeUrl?: string, details?: Record<string, unknown>) {
        super(ErrorCode.AUTH_REQUIRED, message, details);
        this.name = "AuthRequiredError";
        this.qrCodeUrl = qrCodeUrl;
    }

    override toErrorInfo(): MCPErrorInfo {
        return {
            ...super.toErrorInfo(),
            qrCodeUrl: this.qrCodeUrl,
        };
    }
}

/**
 * 登录过期错误
 */
export class AuthExpiredError extends MCPError {
    public readonly qrCodeUrl?: string;

    constructor(message: string, qrCodeUrl?: string, details?: Record<string, unknown>) {
        super(ErrorCode.AUTH_EXPIRED, message, details);
        this.name = "AuthExpiredError";
        this.qrCodeUrl = qrCodeUrl;
    }

    override toErrorInfo(): MCPErrorInfo {
        return {
            ...super.toErrorInfo(),
            qrCodeUrl: this.qrCodeUrl,
        };
    }
}

/**
 * 重试配置
 */
export const RETRY_CONFIG = {
    /** 最大重试次数 */
    maxRetries: 3,
    /** 基础延迟（毫秒） */
    baseDelay: 1000,
    /** 最大延迟（毫秒） */
    maxDelay: 10000,
    /** 退避乘数 */
    backoffMultiplier: 2,
} as const;

/**
 * 计算重试延迟时间
 * @param attempt 当前重试次数（从0开始）
 * @returns 延迟时间（毫秒）
 */
export function calculateRetryDelay(attempt: number): number {
    const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
    return Math.min(delay, RETRY_CONFIG.maxDelay);
}

/**
 * 判断错误是否可重试
 * @param error 错误对象
 * @returns 是否可重试
 */
export function isRetryableError(error: unknown): boolean {
    if (error instanceof MCPError) {
        return (
            error.code === ErrorCode.SERVICE_UNAVAILABLE ||
            error.code === ErrorCode.RATE_LIMITED
        );
    }
    return false;
}

/**
 * 将未知错误转换为MCPError
 * @param error 未知错误
 * @returns MCPError实例
 */
export function toMCPError(error: unknown): MCPError {
    if (error instanceof MCPError) {
        return error;
    }

    if (error instanceof Error) {
        return new InternalError(error.message, {
            originalError: error.name,
            stack: error.stack,
        });
    }

    return new InternalError("发生未知错误", {
        originalError: String(error),
    });
}

/**
 * 创建错误响应的辅助函数
 * @param error 错误对象
 * @returns MCP格式的错误响应
 */
export function createErrorResponse(error: unknown): {
    isError: true;
    content: Array<{ type: "text"; text: string }>;
} {
    const mcpError = toMCPError(error);
    return mcpError.toMCPResponse();
}
