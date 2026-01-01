/**
 * SessionStore 单元测试
 * 验证Session存储模块的核心功能
 * 需求: 7.3, 7.4, 7.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    SessionStore,
    CookieInfo,
    convertPlaywrightCookies,
    convertToPlaywrightCookies,
} from '../../src/auth/session-store.js';

const TEST_SESSION_PATH = './test-session-data';
const TEST_SESSION_FILE = 'test-session.json';

describe('SessionStore', () => {
    let sessionStore: SessionStore;

    beforeEach(async () => {
        // 创建测试用的SessionStore
        sessionStore = new SessionStore({
            sessionPath: TEST_SESSION_PATH,
            sessionFileName: TEST_SESSION_FILE,
            sessionTTLHours: 1, // 1小时有效期用于测试
        });
    });

    afterEach(async () => {
        // 清理测试文件
        try {
            await fs.rm(TEST_SESSION_PATH, { recursive: true, force: true });
        } catch {
            // 忽略清理错误
        }
    });

    describe('saveSession', () => {
        it('应该成功保存Session到文件', async () => {
            const cookies: CookieInfo[] = [
                {
                    name: 'test_cookie',
                    value: 'test_value',
                    domain: '.example.com',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
            ];

            await sessionStore.saveSession(cookies);

            // 验证文件已创建
            const filePath = path.join(TEST_SESSION_PATH, TEST_SESSION_FILE);
            const content = await fs.readFile(filePath, 'utf-8');
            const savedData = JSON.parse(content);

            expect(savedData.cookies).toHaveLength(1);
            expect(savedData.cookies[0].name).toBe('test_cookie');
            expect(savedData.创建时间).toBeDefined();
            expect(savedData.过期时间).toBeDefined();
        });

        it('应该保存localStorage数据', async () => {
            const cookies: CookieInfo[] = [];
            const localStorage = { key1: 'value1', key2: 'value2' };

            await sessionStore.saveSession(cookies, localStorage);

            const session = await sessionStore.loadSession();
            expect(session?.localStorage).toEqual(localStorage);
        });
    });

    describe('loadSession', () => {
        it('当Session不存在时应返回null', async () => {
            const session = await sessionStore.loadSession();
            expect(session).toBeNull();
        });

        it('应该成功加载已保存的Session', async () => {
            const cookies: CookieInfo[] = [
                {
                    name: 'auth_token',
                    value: 'abc123',
                    domain: '.court.gov.cn',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
            ];

            await sessionStore.saveSession(cookies);
            const session = await sessionStore.loadSession();

            expect(session).not.toBeNull();
            expect(session?.cookies).toHaveLength(1);
            expect(session?.cookies[0].name).toBe('auth_token');
        });
    });

    describe('isSessionExpired', () => {
        it('未过期的Session应返回false', () => {
            const futureTime = new Date(Date.now() + 3600000).toISOString();
            const sessionData = {
                cookies: [],
                创建时间: new Date().toISOString(),
                过期时间: futureTime,
            };

            expect(sessionStore.isSessionExpired(sessionData)).toBe(false);
        });

        it('已过期的Session应返回true', () => {
            const pastTime = new Date(Date.now() - 1000).toISOString();
            const sessionData = {
                cookies: [],
                创建时间: new Date(Date.now() - 3600000).toISOString(),
                过期时间: pastTime,
            };

            expect(sessionStore.isSessionExpired(sessionData)).toBe(true);
        });
    });

    describe('hasValidSession', () => {
        it('当没有Session时应返回false', async () => {
            const hasValid = await sessionStore.hasValidSession();
            expect(hasValid).toBe(false);
        });

        it('当有有效Session时应返回true', async () => {
            await sessionStore.saveSession([
                {
                    name: 'test',
                    value: 'value',
                    domain: '.example.com',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
            ]);

            const hasValid = await sessionStore.hasValidSession();
            expect(hasValid).toBe(true);
        });
    });

    describe('clearSession', () => {
        it('应该成功清除Session', async () => {
            await sessionStore.saveSession([
                {
                    name: 'test',
                    value: 'value',
                    domain: '.example.com',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
            ]);

            await sessionStore.clearSession();

            const session = await sessionStore.loadSession();
            expect(session).toBeNull();
        });

        it('清除不存在的Session不应报错', async () => {
            await expect(sessionStore.clearSession()).resolves.not.toThrow();
        });
    });

    describe('getRemainingTTL', () => {
        it('当Session不存在时应返回0', async () => {
            const ttl = await sessionStore.getRemainingTTL();
            expect(ttl).toBe(0);
        });

        it('应返回正确的剩余时间', async () => {
            await sessionStore.saveSession([]);

            const ttl = await sessionStore.getRemainingTTL();
            // 1小时 = 3600秒，允许一些误差
            expect(ttl).toBeGreaterThan(3500);
            expect(ttl).toBeLessThanOrEqual(3600);
        });
    });

    describe('getCookies', () => {
        it('当Session无效时应返回空数组', async () => {
            const cookies = await sessionStore.getCookies();
            expect(cookies).toEqual([]);
        });

        it('应返回存储的Cookies', async () => {
            const testCookies: CookieInfo[] = [
                {
                    name: 'cookie1',
                    value: 'value1',
                    domain: '.example.com',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
                {
                    name: 'cookie2',
                    value: 'value2',
                    domain: '.example.com',
                    path: '/path',
                    expires: Date.now() / 1000 + 3600,
                },
            ];

            await sessionStore.saveSession(testCookies);
            const cookies = await sessionStore.getCookies();

            expect(cookies).toHaveLength(2);
            expect(cookies[0].name).toBe('cookie1');
            expect(cookies[1].name).toBe('cookie2');
        });
    });

    describe('hasCookie / getCookieValue', () => {
        beforeEach(async () => {
            await sessionStore.saveSession([
                {
                    name: 'auth_token',
                    value: 'secret123',
                    domain: '.court.gov.cn',
                    path: '/',
                    expires: Date.now() / 1000 + 3600,
                },
            ]);
        });

        it('hasCookie应正确检测Cookie存在', async () => {
            expect(await sessionStore.hasCookie('auth_token')).toBe(true);
            expect(await sessionStore.hasCookie('nonexistent')).toBe(false);
        });

        it('getCookieValue应返回正确的值', async () => {
            expect(await sessionStore.getCookieValue('auth_token')).toBe('secret123');
            expect(await sessionStore.getCookieValue('nonexistent')).toBeUndefined();
        });
    });
});

describe('Cookie转换函数', () => {
    describe('convertPlaywrightCookies', () => {
        it('应正确转换Playwright Cookie格式', () => {
            const playwrightCookies = [
                {
                    name: 'test',
                    value: 'value',
                    domain: '.example.com',
                    path: '/',
                    expires: 1234567890,
                    httpOnly: true,
                    secure: true,
                    sameSite: 'Lax' as const,
                },
            ];

            const result = convertPlaywrightCookies(playwrightCookies);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                name: 'test',
                value: 'value',
                domain: '.example.com',
                path: '/',
                expires: 1234567890,
                httpOnly: true,
                secure: true,
                sameSite: 'Lax',
            });
        });
    });

    describe('convertToPlaywrightCookies', () => {
        it('应正确转换为Playwright Cookie格式', () => {
            const cookies: CookieInfo[] = [
                {
                    name: 'test',
                    value: 'value',
                    domain: '.example.com',
                    path: '/',
                    expires: 1234567890,
                    httpOnly: true,
                    secure: false,
                    sameSite: 'Strict',
                },
            ];

            const result = convertToPlaywrightCookies(cookies);

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('test');
            expect(result[0].httpOnly).toBe(true);
            expect(result[0].secure).toBe(false);
            expect(result[0].sameSite).toBe('Strict');
        });
    });
});
