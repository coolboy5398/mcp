/**
 * Session存储模块
 * 实现Cookie的保存、加载和过期检查
 * 需求: 7.3, 7.4, 7.5
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Cookie信息接口
 */
export interface CookieInfo {
    /** Cookie名称 */
    name: string;
    /** Cookie值 */
    value: string;
    /** 域名 */
    domain: string;
    /** 路径 */
    path: string;
    /** 过期时间戳（秒） */
    expires: number;
    /** 是否HttpOnly */
    httpOnly?: boolean;
    /** 是否Secure */
    secure?: boolean;
    /** SameSite属性 */
    sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Session存储格式接口
 * 需求 7.3: 认证Token存储到本地
 */
export interface SessionData {
    /** Cookie列表 */
    cookies: CookieInfo[];
    /** localStorage数据 */
    localStorage?: Record<string, string>;
    /** 创建时间 (ISO格式) */
    创建时间: string;
    /** 过期时间 (ISO格式) */
    过期时间: string;
}

/**
 * Session存储配置
 */
export interface SessionStoreConfig {
    /** Session存储目录路径 */
    sessionPath?: string;
    /** Session文件名 */
    sessionFileName?: string;
    /** Session有效期（小时），默认24小时 */
    sessionTTLHours?: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<SessionStoreConfig> = {
    sessionPath: './session-data',
    sessionFileName: 'session.json',
    sessionTTLHours: 24,
};

/**
 * Session存储类
 * 负责Session的持久化存储和管理
 */
export class SessionStore {
    private readonly sessionPath: string;
    private readonly sessionFileName: string;
    private readonly sessionTTLHours: number;
    private cachedSession: SessionData | null = null;

    constructor(config?: SessionStoreConfig) {
        this.sessionPath = config?.sessionPath ?? DEFAULT_CONFIG.sessionPath;
        this.sessionFileName = config?.sessionFileName ?? DEFAULT_CONFIG.sessionFileName;
        this.sessionTTLHours = config?.sessionTTLHours ?? DEFAULT_CONFIG.sessionTTLHours;
    }

    /**
     * 获取Session文件完整路径
     */
    private getSessionFilePath(): string {
        return path.join(this.sessionPath, this.sessionFileName);
    }

    /**
     * 确保Session存储目录存在
     */
    private async ensureSessionDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.sessionPath, { recursive: true });
        } catch (error) {
            // 目录已存在时忽略错误
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * 保存Session到本地文件
     * 需求 7.3: 用户扫码完成认证后，文书服务器应将认证Token存储到本地
     * @param cookies Cookie列表
     * @param localStorage localStorage数据（可选）
     */
    async saveSession(cookies: CookieInfo[], localStorage?: Record<string, string>): Promise<void> {
        await this.ensureSessionDirectory();

        const now = new Date();
        const expireTime = new Date(now.getTime() + this.sessionTTLHours * 60 * 60 * 1000);

        const sessionData: SessionData = {
            cookies,
            localStorage,
            创建时间: now.toISOString(),
            过期时间: expireTime.toISOString(),
        };

        const filePath = this.getSessionFilePath();
        await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), 'utf-8');

        // 更新缓存
        this.cachedSession = sessionData;
    }

    /**
     * 从本地文件加载Session
     * 需求 7.4: 当存储的Token存在且未过期时，文书服务器应将其用于后续请求
     * @returns Session数据，如果不存在或已过期则返回null
     */
    async loadSession(): Promise<SessionData | null> {
        // 如果有缓存且未过期，直接返回缓存
        if (this.cachedSession && !this.isSessionExpired(this.cachedSession)) {
            return this.cachedSession;
        }

        try {
            const filePath = this.getSessionFilePath();
            const content = await fs.readFile(filePath, 'utf-8');
            const sessionData: SessionData = JSON.parse(content);

            // 检查是否过期
            if (this.isSessionExpired(sessionData)) {
                // 过期则删除文件并返回null
                await this.clearSession();
                return null;
            }

            // 更新缓存
            this.cachedSession = sessionData;
            return sessionData;
        } catch (error) {
            // 文件不存在或解析失败
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return null;
            }
            // 其他错误（如JSON解析失败）也返回null
            console.error('加载Session失败:', error);
            return null;
        }
    }

    /**
     * 检查Session是否已过期
     * 需求 7.5: 如果存储的Token已过期，文书服务器应提示重新认证
     * @param sessionData Session数据
     * @returns 是否已过期
     */
    isSessionExpired(sessionData: SessionData): boolean {
        const expireTime = new Date(sessionData.过期时间);
        const now = new Date();
        return now >= expireTime;
    }

    /**
     * 检查Session是否存在且有效
     * @returns 是否存在有效Session
     */
    async hasValidSession(): Promise<boolean> {
        const session = await this.loadSession();
        return session !== null;
    }

    /**
     * 清除Session
     * 删除本地存储的Session文件
     */
    async clearSession(): Promise<void> {
        this.cachedSession = null;

        try {
            const filePath = this.getSessionFilePath();
            await fs.unlink(filePath);
        } catch (error) {
            // 文件不存在时忽略错误
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }

    /**
     * 获取Session剩余有效时间（秒）
     * @returns 剩余秒数，如果已过期或不存在则返回0
     */
    async getRemainingTTL(): Promise<number> {
        const session = await this.loadSession();
        if (!session) {
            return 0;
        }

        const expireTime = new Date(session.过期时间);
        const now = new Date();
        const remainingMs = expireTime.getTime() - now.getTime();

        return Math.max(0, Math.floor(remainingMs / 1000));
    }

    /**
     * 刷新Session过期时间
     * 延长当前Session的有效期
     */
    async refreshSession(): Promise<boolean> {
        const session = await this.loadSession();
        if (!session) {
            return false;
        }

        // 重新保存以更新过期时间
        await this.saveSession(session.cookies, session.localStorage);
        return true;
    }

    /**
     * 获取存储的Cookies
     * @returns Cookie列表，如果Session无效则返回空数组
     */
    async getCookies(): Promise<CookieInfo[]> {
        const session = await this.loadSession();
        return session?.cookies ?? [];
    }

    /**
     * 获取存储的localStorage数据
     * @returns localStorage数据，如果Session无效则返回undefined
     */
    async getLocalStorage(): Promise<Record<string, string> | undefined> {
        const session = await this.loadSession();
        return session?.localStorage;
    }

    /**
     * 检查特定Cookie是否存在
     * @param cookieName Cookie名称
     * @returns 是否存在
     */
    async hasCookie(cookieName: string): Promise<boolean> {
        const cookies = await this.getCookies();
        return cookies.some(cookie => cookie.name === cookieName);
    }

    /**
     * 获取特定Cookie的值
     * @param cookieName Cookie名称
     * @returns Cookie值，如果不存在则返回undefined
     */
    async getCookieValue(cookieName: string): Promise<string | undefined> {
        const cookies = await this.getCookies();
        const cookie = cookies.find(c => c.name === cookieName);
        return cookie?.value;
    }
}

/**
 * 创建默认的SessionStore实例
 */
export function createSessionStore(config?: SessionStoreConfig): SessionStore {
    return new SessionStore(config);
}

/**
 * 将Playwright的Cookie格式转换为SessionStore的Cookie格式
 */
export function convertPlaywrightCookies(playwrightCookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
}>): CookieInfo[] {
    return playwrightCookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
    }));
}

/**
 * 将SessionStore的Cookie格式转换为Playwright的Cookie格式
 */
export function convertToPlaywrightCookies(cookies: CookieInfo[]): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}> {
    return cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
    }));
}
