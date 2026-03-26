/**
 * AuthManager 单元测试
 * 验证认证管理器的核心功能（不涉及实际浏览器操作）
 * 需求: 7.1, 7.2, 7.3, 7.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
    AuthManager,
    createAuthManager,
    getDefaultAuthManager,
    resetDefaultAuthManager,
} from '../../src/auth/manager.js';

const TEST_SESSION_PATH = './test-auth-session-data';

describe('AuthManager', () => {
    let authManager: AuthManager;

    beforeEach(async () => {
        authManager = new AuthManager({
            sessionConfig: {
                sessionPath: TEST_SESSION_PATH,
                sessionTTLHours: 1,
            },
            headless: true,
        });
    });

    afterEach(async () => {
        // 关闭浏览器
        await authManager.closeBrowser();
        // 清理测试文件
        try {
            await fs.rm(TEST_SESSION_PATH, { recursive: true, force: true });
        } catch {
            // 忽略清理错误
        }
    });

    describe('构造函数和配置', () => {
        it('应该使用默认配置创建实例', () => {
            const manager = new AuthManager();
            expect(manager).toBeInstanceOf(AuthManager);
        });

        it('应该接受自定义配置', () => {
            const manager = new AuthManager({
                headless: false,
                browserTimeout: 60000,
                pageTimeout: 60000,
            });
            expect(manager).toBeInstanceOf(AuthManager);
        });
    });

    describe('getSessionStore', () => {
        it('应该返回SessionStore实例', () => {
            const sessionStore = authManager.getSessionStore();
            expect(sessionStore).toBeDefined();
            expect(typeof sessionStore.saveSession).toBe('function');
            expect(typeof sessionStore.loadSession).toBe('function');
        });
    });

    describe('checkLoginStatus - 无Session情况', () => {
        it('当没有Session时应返回未登录状态', async () => {
            const status = await authManager.checkLoginStatus();

            expect(status.已登录).toBe(false);
            expect(status.消息).toContain('未登录');
        });
    });

    describe('closeBrowser', () => {
        it('关闭未初始化的浏览器不应报错', async () => {
            await expect(authManager.closeBrowser()).resolves.not.toThrow();
        });
    });

    describe('logout', () => {
        it('应该清除Session并关闭浏览器', async () => {
            // 先保存一个Session
            const sessionStore = authManager.getSessionStore();
            await sessionStore.saveSession([
                {
                    name: 'test',
                    value: 'value',
                    domain: '.example.com',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
            ]);

            // 验证Session存在
            expect(await sessionStore.hasValidSession()).toBe(true);

            // 执行logout
            await authManager.logout();

            // 验证Session已清除
            expect(await sessionStore.hasValidSession()).toBe(false);
        });
    });

    describe('refreshSession', () => {
        it('当没有Session时应返回false', async () => {
            const result = await authManager.refreshSession();
            expect(result).toBe(false);
        });

        it('当有Session时应返回true并刷新', async () => {
            const sessionStore = authManager.getSessionStore();
            await sessionStore.saveSession([
                {
                    name: 'test',
                    value: 'value',
                    domain: '.example.com',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
            ]);

            const result = await authManager.refreshSession();
            expect(result).toBe(true);
        });
    });
});

describe('工厂函数', () => {
    afterEach(async () => {
        await resetDefaultAuthManager();
    });

    describe('createAuthManager', () => {
        it('应该创建新的AuthManager实例', () => {
            const manager = createAuthManager();
            expect(manager).toBeInstanceOf(AuthManager);
        });

        it('应该接受配置参数', () => {
            const manager = createAuthManager({
                headless: false,
            });
            expect(manager).toBeInstanceOf(AuthManager);
        });
    });

    describe('getDefaultAuthManager', () => {
        it('应该返回单例实例', () => {
            const manager1 = getDefaultAuthManager();
            const manager2 = getDefaultAuthManager();
            expect(manager1).toBe(manager2);
        });
    });

    describe('resetDefaultAuthManager', () => {
        it('应该重置单例实例', async () => {
            const manager1 = getDefaultAuthManager();
            await resetDefaultAuthManager();
            const manager2 = getDefaultAuthManager();
            expect(manager1).not.toBe(manager2);
        });
    });
});
