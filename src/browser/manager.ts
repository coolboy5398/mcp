/**
 * 浏览器管理器模块
 * 实现浏览器启动、关闭和有头/无头模式切换
 * 需求: 7.1
 */

import { chromium, Browser, BrowserContext, Page, LaunchOptions } from 'playwright';

// Node.js globals
declare const setTimeout: (callback: (...args: unknown[]) => void, ms: number) => unknown;

/**
 * 浏览器管理器配置接口
 */
export interface BrowserManagerConfig {
    /** 是否使用无头模式，默认true */
    headless?: boolean;
    /** 浏览器启动超时（毫秒），默认30000 */
    launchTimeout?: number;
    /** 页面默认超时（毫秒），默认30000 */
    pageTimeout?: number;
    /** 视口宽度，默认1280 */
    viewportWidth?: number;
    /** 视口高度，默认720 */
    viewportHeight?: number;
    /** 自定义User-Agent */
    userAgent?: string;
    /** 是否启用JavaScript，默认true */
    javaScriptEnabled?: boolean;
    /** 代理服务器配置 */
    proxy?: {
        server: string;
        username?: string;
        password?: string;
    };
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<Omit<BrowserManagerConfig, 'proxy'>> = {
    headless: true,
    launchTimeout: 30000,
    pageTimeout: 30000,
    viewportWidth: 1280,
    viewportHeight: 720,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    javaScriptEnabled: true,
};

/**
 * 浏览器状态枚举
 */
export enum BrowserState {
    /** 未初始化 */
    UNINITIALIZED = 'uninitialized',
    /** 正在启动 */
    LAUNCHING = 'launching',
    /** 运行中 */
    RUNNING = 'running',
    /** 正在关闭 */
    CLOSING = 'closing',
    /** 已关闭 */
    CLOSED = 'closed',
}

/**
 * 浏览器管理器类
 * 负责管理Playwright浏览器实例的生命周期
 */
export class BrowserManager {
    private readonly config: Required<Omit<BrowserManagerConfig, 'proxy'>> & { proxy?: BrowserManagerConfig['proxy'] };
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private state: BrowserState = BrowserState.UNINITIALIZED;
    private currentHeadless: boolean;

    constructor(config?: BrowserManagerConfig) {
        this.config = {
            headless: config?.headless ?? DEFAULT_CONFIG.headless,
            launchTimeout: config?.launchTimeout ?? DEFAULT_CONFIG.launchTimeout,
            pageTimeout: config?.pageTimeout ?? DEFAULT_CONFIG.pageTimeout,
            viewportWidth: config?.viewportWidth ?? DEFAULT_CONFIG.viewportWidth,
            viewportHeight: config?.viewportHeight ?? DEFAULT_CONFIG.viewportHeight,
            userAgent: config?.userAgent ?? DEFAULT_CONFIG.userAgent,
            javaScriptEnabled: config?.javaScriptEnabled ?? DEFAULT_CONFIG.javaScriptEnabled,
            proxy: config?.proxy,
        };
        this.currentHeadless = this.config.headless;
    }

    /**
     * 获取当前浏览器状态
     */
    getState(): BrowserState {
        return this.state;
    }

    /**
     * 检查浏览器是否正在运行
     */
    isRunning(): boolean {
        return this.state === BrowserState.RUNNING && this.browser !== null;
    }

    /**
     * 获取当前是否为无头模式
     */
    isHeadless(): boolean {
        return this.currentHeadless;
    }

    /**
     * 启动浏览器
     * @param headless 可选，覆盖配置中的无头模式设置
     */
    async launch(headless?: boolean): Promise<void> {
        if (this.state === BrowserState.RUNNING) {
            // 如果需要切换模式，先关闭再重启
            const targetHeadless = headless ?? this.config.headless;
            if (targetHeadless !== this.currentHeadless) {
                await this.close();
            } else {
                return; // 已经在运行且模式相同
            }
        }

        if (this.state === BrowserState.LAUNCHING) {
            throw new Error('浏览器正在启动中，请稍候');
        }

        this.state = BrowserState.LAUNCHING;
        this.currentHeadless = headless ?? this.config.headless;

        try {
            const launchOptions: LaunchOptions = {
                headless: this.currentHeadless,
                timeout: this.config.launchTimeout,
            };

            // 添加代理配置
            if (this.config.proxy) {
                launchOptions.proxy = {
                    server: this.config.proxy.server,
                    username: this.config.proxy.username,
                    password: this.config.proxy.password,
                };
            }

            this.browser = await chromium.launch(launchOptions);

            // 创建浏览器上下文
            this.context = await this.browser.newContext({
                viewport: {
                    width: this.config.viewportWidth,
                    height: this.config.viewportHeight,
                },
                userAgent: this.config.userAgent,
                javaScriptEnabled: this.config.javaScriptEnabled,
            });

            this.state = BrowserState.RUNNING;
        } catch (error) {
            this.state = BrowserState.CLOSED;
            this.browser = null;
            this.context = null;
            throw error;
        }
    }

    /**
     * 关闭浏览器
     */
    async close(): Promise<void> {
        if (this.state === BrowserState.CLOSED || this.state === BrowserState.UNINITIALIZED) {
            return;
        }

        if (this.state === BrowserState.CLOSING) {
            // 等待关闭完成
            while (this.state === BrowserState.CLOSING) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }

        this.state = BrowserState.CLOSING;

        try {
            if (this.context) {
                await this.context.close().catch(() => { });
                this.context = null;
            }

            if (this.browser) {
                await this.browser.close().catch(() => { });
                this.browser = null;
            }
        } finally {
            this.state = BrowserState.CLOSED;
        }
    }

    /**
     * 切换有头/无头模式
     * 需要重启浏览器才能生效
     * @param headless 是否使用无头模式
     */
    async switchMode(headless: boolean): Promise<void> {
        if (this.currentHeadless === headless && this.isRunning()) {
            return; // 模式相同且正在运行，无需切换
        }

        await this.close();
        await this.launch(headless);
    }

    /**
     * 获取浏览器实例
     * 如果浏览器未启动，会自动启动
     */
    async getBrowser(): Promise<Browser> {
        if (!this.isRunning()) {
            await this.launch();
        }

        if (!this.browser) {
            throw new Error('浏览器启动失败');
        }

        return this.browser;
    }

    /**
     * 获取浏览器上下文
     * 如果浏览器未启动，会自动启动
     */
    async getContext(): Promise<BrowserContext> {
        if (!this.isRunning()) {
            await this.launch();
        }

        if (!this.context) {
            throw new Error('浏览器上下文创建失败');
        }

        return this.context;
    }

    /**
     * 创建新页面
     * @returns 新创建的页面实例
     */
    async newPage(): Promise<Page> {
        const context = await this.getContext();
        const page = await context.newPage();
        page.setDefaultTimeout(this.config.pageTimeout);
        return page;
    }

    /**
     * 向浏览器上下文添加Cookies
     * @param cookies Cookie数组
     */
    async addCookies(cookies: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: 'Strict' | 'Lax' | 'None';
    }>): Promise<void> {
        const context = await this.getContext();
        await context.addCookies(cookies);
    }

    /**
     * 获取浏览器上下文中的所有Cookies
     * @param urls 可选，指定URL过滤Cookies
     */
    async getCookies(urls?: string | string[]): Promise<Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'Strict' | 'Lax' | 'None';
    }>> {
        const context = await this.getContext();
        return context.cookies(urls);
    }

    /**
     * 清除浏览器上下文中的所有Cookies
     */
    async clearCookies(): Promise<void> {
        const context = await this.getContext();
        await context.clearCookies();
    }

    /**
     * 获取当前配置
     */
    getConfig(): Readonly<typeof this.config> {
        return { ...this.config };
    }
}

/**
 * 创建浏览器管理器实例
 */
export function createBrowserManager(config?: BrowserManagerConfig): BrowserManager {
    return new BrowserManager(config);
}

/**
 * 默认浏览器管理器实例（单例）
 */
let defaultBrowserManager: BrowserManager | null = null;

/**
 * 获取默认浏览器管理器实例
 */
export function getDefaultBrowserManager(): BrowserManager {
    if (!defaultBrowserManager) {
        defaultBrowserManager = new BrowserManager();
    }
    return defaultBrowserManager;
}

/**
 * 重置默认浏览器管理器
 */
export async function resetDefaultBrowserManager(): Promise<void> {
    if (defaultBrowserManager) {
        await defaultBrowserManager.close();
        defaultBrowserManager = null;
    }
}
