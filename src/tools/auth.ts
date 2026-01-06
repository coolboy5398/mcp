/**
 * 认证相关MCP工具
 * 实现 login_status, login_qrcode, wait_login, login_with_browser 工具
 * 需求: 7.1, 7.2
 */

import { z } from 'zod';
import {
    AuthManager,
    getDefaultAuthManager,
    AuthStatus,
    QRCodeInfo,
    WaitLoginResult,
} from '../auth/index.js';
import { createErrorResponse, toMCPError } from '../errors/index.js';

/**
 * 登录状态输出接口
 */
export interface LoginStatusOutput {
    已登录: boolean;
    消息: string;
    剩余有效时间?: number;
}

/**
 * 登录二维码输出接口
 */
export interface LoginQRCodeOutput {
    二维码图片: string;
    说明: string;
    过期秒数: number;
}

/**
 * 等待登录输入Schema
 */
export const WaitLoginInputSchema = z.object({
    超时秒数: z.number().min(10).max(300).optional().default(120),
});

export type WaitLoginInput = z.infer<typeof WaitLoginInputSchema>;

/**
 * 等待登录输出接口
 */
export interface WaitLoginOutput {
    成功: boolean;
    消息: string;
}

/**
 * 浏览器登录输入Schema
 */
export const BrowserLoginInputSchema = z.object({
    超时秒数: z.number().min(10).max(300).optional().default(180),
});

export type BrowserLoginInput = z.infer<typeof BrowserLoginInputSchema>;

/**
 * 浏览器登录输出接口
 */
export interface BrowserLoginOutput {
    成功: boolean;
    消息: string;
}

/**
 * 认证工具类
 * 封装所有认证相关的MCP工具实现
 */
export class AuthTools {
    private authManager: AuthManager;

    constructor(authManager?: AuthManager) {
        this.authManager = authManager ?? getDefaultAuthManager();
    }

    /**
     * 检查登录状态工具
     * 需求 7.1: 文书服务器应提供检查当前登录状态的工具
     */
    async loginStatus(): Promise<LoginStatusOutput> {
        try {
            const status: AuthStatus = await this.authManager.checkLoginStatus();
            return {
                已登录: status.已登录,
                消息: status.消息,
                剩余有效时间: status.剩余有效时间,
            };
        } catch (error) {
            const mcpError = toMCPError(error);
            return {
                已登录: false,
                消息: `检查登录状态失败: ${mcpError.message}`,
            };
        }
    }

    /**
     * 获取登录二维码工具
     * 需求 7.2: 当用户未登录时，文书服务器应返回支付宝认证的二维码URL
     */
    async loginQRCode(): Promise<LoginQRCodeOutput> {
        const qrInfo: QRCodeInfo = await this.authManager.getLoginQRCode();
        return {
            二维码图片: qrInfo.二维码图片Base64,
            说明: qrInfo.说明,
            过期秒数: qrInfo.过期秒数,
        };
    }

    /**
     * 等待登录完成工具
     * 需求 7.3: 当用户扫码完成认证后，文书服务器应将认证Token存储到本地
     */
    async waitLogin(input: WaitLoginInput): Promise<WaitLoginOutput> {
        const result: WaitLoginResult = await this.authManager.waitForLogin(input.超时秒数);
        return {
            成功: result.成功,
            消息: result.消息,
        };
    }

    /**
     * 弹出浏览器登录工具（有头模式）
     * 用于本地开发和首次登录场景
     */
    async loginWithBrowser(input: BrowserLoginInput): Promise<BrowserLoginOutput> {
        const result: WaitLoginResult = await this.authManager.loginWithBrowser(input.超时秒数);
        return {
            成功: result.成功,
            消息: result.消息,
        };
    }

    /**
     * 关闭浏览器
     */
    async closeBrowser(): Promise<void> {
        await this.authManager.closeBrowser();
    }

    /**
     * 登出
     */
    async logout(): Promise<{ 成功: boolean; 消息: string }> {
        try {
            await this.authManager.logout();
            return {
                成功: true,
                消息: '已成功登出',
            };
        } catch (error) {
            const mcpError = toMCPError(error);
            return {
                成功: false,
                消息: `登出失败: ${mcpError.message}`,
            };
        }
    }
}

/**
 * MCP工具定义 - login_status
 */
export const loginStatusToolDefinition = {
    name: 'login_status',
    description: '检查当前登录状态。返回是否已登录以及Session剩余有效时间。',
    inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] as string[],
    },
};

/**
 * MCP工具定义 - login_qrcode
 */
export const loginQRCodeToolDefinition = {
    name: 'login_qrcode',
    description: '获取支付宝扫码登录的二维码图片（首选登录方式）。返回Base64编码的二维码图片，用户需要使用支付宝扫码登录。',
    inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] as string[],
    },
};

/**
 * MCP工具定义 - wait_login
 */
export const waitLoginToolDefinition = {
    name: 'wait_login',
    description: '等待用户扫码登录完成。在获取二维码后调用此工具等待用户完成扫码认证。',
    inputSchema: {
        type: 'object' as const,
        properties: {
            超时秒数: {
                type: 'number',
                description: '等待超时时间（秒），默认120秒，范围10-300秒',
                default: 120,
            },
        },
        required: [] as string[],
    },
};

/**
 * MCP工具定义 - login_with_browser
 */
export const loginWithBrowserToolDefinition = {
    name: 'login_with_browser',
    description: '弹出浏览器窗口进行登录（备用方式，仅在无法使用 login_qrcode 时使用）。适用于本地开发环境，会弹出浏览器窗口让用户直接扫码登录。',
    inputSchema: {
        type: 'object' as const,
        properties: {
            超时秒数: {
                type: 'number',
                description: '等待超时时间（秒），默认180秒，范围10-300秒',
                default: 180,
            },
        },
        required: [] as string[],
    },
};

/**
 * 所有认证工具定义
 */
export const authToolDefinitions = [
    loginStatusToolDefinition,
    loginQRCodeToolDefinition,
    waitLoginToolDefinition,
    loginWithBrowserToolDefinition,
];

/**
 * 创建认证工具处理器
 */
export function createAuthToolHandlers(authManager?: AuthManager) {
    const tools = new AuthTools(authManager);

    return {
        login_status: async () => {
            try {
                const result = await tools.loginStatus();
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return createErrorResponse(error);
            }
        },

        login_qrcode: async () => {
            try {
                const result = await tools.loginQRCode();
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify({
                                说明: result.说明,
                                过期秒数: result.过期秒数,
                            }, null, 2),
                        },
                        {
                            type: 'image' as const,
                            data: result.二维码图片,
                            mimeType: 'image/png',
                        },
                    ],
                };
            } catch (error) {
                return createErrorResponse(error);
            }
        },

        wait_login: async (args: unknown) => {
            try {
                const input = WaitLoginInputSchema.parse(args);
                const result = await tools.waitLogin(input);
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return createErrorResponse(error);
            }
        },

        login_with_browser: async (args: unknown) => {
            try {
                const input = BrowserLoginInputSchema.parse(args);
                const result = await tools.loginWithBrowser(input);
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return createErrorResponse(error);
            }
        },
    };
}

/**
 * 默认认证工具实例
 */
let defaultAuthTools: AuthTools | null = null;

/**
 * 获取默认认证工具实例
 */
export function getDefaultAuthTools(): AuthTools {
    if (!defaultAuthTools) {
        defaultAuthTools = new AuthTools();
    }
    return defaultAuthTools;
}

/**
 * 重置默认认证工具实例
 */
export async function resetDefaultAuthTools(): Promise<void> {
    if (defaultAuthTools) {
        await defaultAuthTools.closeBrowser();
        defaultAuthTools = null;
    }
}
