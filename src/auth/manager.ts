/**
 * 认证管理器模块
 * 实现浏览器初始化、登录状态检查、二维码获取和等待登录完成
 * 需求: 7.1, 7.2, 7.3
 */

import { chromium, Browser, BrowserContext, Page, Frame } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    SessionStore,
    CookieInfo,
    SessionStoreConfig,
    convertPlaywrightCookies,
    convertToPlaywrightCookies,
} from './session-store.js';

// Node.js console
declare const console: Console;

/**
 * 全局日志文件路径（由AuthManager初始化时设置）
 */
let globalLogFilePath: string | null = null;

/**
 * 设置日志文件路径
 */
function setLogFilePath(sessionPath: string): void {
    globalLogFilePath = path.join(sessionPath, 'debug.log');
}

/**
 * 写入调试日志到文件
 */
function logToFile(message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    
    // 如果设置了日志路径，写入文件
    if (globalLogFilePath) {
        try {
            // 确保目录存在
            const dir = path.dirname(globalLogFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // 追加写入日志文件
            fs.appendFileSync(globalLogFilePath, logLine, 'utf-8');
        } catch (error) {
            // 写入失败时只输出到stderr
            console.error(`写入日志文件失败: ${error}`);
        }
    }
    
    // 同时输出到stderr
    console.error(message);
}

/**
 * 认证状态接口
 */
export interface AuthStatus {
    /** 是否已登录 */
    已登录: boolean;
    /** 状态消息 */
    消息: string;
    /** Session剩余有效时间（秒） */
    剩余有效时间?: number;
}

/**
 * 二维码信息接口
 */
export interface QRCodeInfo {
    /** Base64编码的二维码图片 */
    二维码图片Base64: string;
    /** 说明文字 */
    说明: string;
    /** 二维码过期时间（秒） */
    过期秒数: number;
}

/**
 * 等待登录结果接口
 */
export interface WaitLoginResult {
    /** 是否登录成功 */
    成功: boolean;
    /** 结果消息 */
    消息: string;
}

/**
 * 认证管理器配置
 */
export interface AuthManagerConfig {
    /** Session存储配置 */
    sessionConfig?: SessionStoreConfig;
    /** 是否使用无头模式，默认true */
    headless?: boolean;
    /** 裁判文书网URL */
    wenshuUrl?: string;
    /** 登录页面URL */
    loginUrl?: string;
    /** 浏览器启动超时（毫秒） */
    browserTimeout?: number;
    /** 页面加载超时（毫秒） */
    pageTimeout?: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<Omit<AuthManagerConfig, 'sessionConfig'>> = {
    headless: true,
    wenshuUrl: 'https://wenshu.court.gov.cn/',
    loginUrl: 'https://wenshu.court.gov.cn/website/wenshu/181010CARHS5BS3C/index.html',
    browserTimeout: 30000,
    pageTimeout: 30000,
};

/**
 * 二维码选择器（支付宝扫码登录）
 */
const QR_CODE_SELECTORS = {
    /** 二维码图片选择器 */
    qrCodeImage: '#alipay-qrcode, img[src*="alipay.com"], img[id*="qrcode"], img[class*="qrcode"]',
    /** 二维码容器选择器 */
    qrCodeContainer: '.qrcode-container, .login-qrcode, [class*="qrcode"]',
    /** 支付宝二维码精确选择器 */
    alipayQRCode: '#alipay-qrcode',
    /** 登录成功后的用户信息选择器 */
    userInfo: '.user-info, .username, [class*="user-name"], .login-user',
    /** 登录按钮选择器 */
    loginButton: '.login-btn, [class*="login"], button:has-text("登录")',
    /** 支付宝登录图标选择器（点击后显示二维码） */
    alipayIcon: '.login-type-item.alipay, img[alt*="支付宝"], img[src*="alipay"], img[src*="zhifubao"], .alipay-icon, .alipay-login, [class*="alipay"], [title*="支付宝"], a:has(img[alt*="支付宝"])',
    /** 支付宝二维码iframe选择器（二维码可能在iframe中） */
    alipayQRCodeIframe: 'iframe[src*="alipay"], iframe[id*="alipay"]',
};

/**
 * 认证管理器类
 * 负责管理浏览器实例和用户认证状态
 */
export class AuthManager {
    private readonly sessionStore: SessionStore;
    private readonly config: Required<Omit<AuthManagerConfig, 'sessionConfig'>>;
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    constructor(config?: AuthManagerConfig) {
        this.sessionStore = new SessionStore(config?.sessionConfig);
        this.config = {
            headless: config?.headless ?? DEFAULT_CONFIG.headless,
            wenshuUrl: config?.wenshuUrl ?? DEFAULT_CONFIG.wenshuUrl,
            loginUrl: config?.loginUrl ?? DEFAULT_CONFIG.loginUrl,
            browserTimeout: config?.browserTimeout ?? DEFAULT_CONFIG.browserTimeout,
            pageTimeout: config?.pageTimeout ?? DEFAULT_CONFIG.pageTimeout,
        };
        
        // 初始化日志文件路径
        const sessionPath = config?.sessionConfig?.sessionPath ?? './session-data';
        setLogFilePath(sessionPath);
        logToFile('[DEBUG] AuthManager 初始化完成');
    }

    /**
     * 初始化浏览器
     * 需求 7.1: 文书服务器应提供检查当前登录状态的工具
     */
    async initBrowser(headless?: boolean): Promise<void> {
        if (this.browser) {
            return; // 浏览器已初始化
        }

        const useHeadless = headless ?? this.config.headless;

        this.browser = await chromium.launch({
            headless: useHeadless,
            timeout: this.config.browserTimeout,
        });

        this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        // 尝试加载已保存的Session
        await this.loadSavedSession();

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(this.config.pageTimeout);
    }

    /**
     * 加载已保存的Session到浏览器上下文
     */
    private async loadSavedSession(): Promise<boolean> {
        if (!this.context) {
            logToFile('[DEBUG] loadSavedSession: context 为空');
            return false;
        }

        const cookies = await this.sessionStore.getCookies();
        logToFile(`[DEBUG] loadSavedSession: 从session文件读取到 ${cookies.length} 个cookies`);
        
        if (cookies.length === 0) {
            logToFile('[DEBUG] loadSavedSession: 没有保存的cookies，需要重新登录');
            return false;
        }

        try {
            const playwrightCookies = convertToPlaywrightCookies(cookies);
            await this.context.addCookies(playwrightCookies);
            logToFile(`[DEBUG] loadSavedSession: 成功添加 ${playwrightCookies.length} 个cookies到浏览器`);
            return true;
        } catch (error) {
            logToFile(`加载Session到浏览器失败: ${error}`);
            return false;
        }
    }

    /**
     * 检查登录状态
     * 需求 7.1: 文书服务器应提供检查当前登录状态的工具
     * 需求 7.4: 当存储的Token存在且未过期时，文书服务器应将其用于后续请求
     */
    async checkLoginStatus(): Promise<AuthStatus> {
        // 首先检查本地Session是否有效
        let hasValidSession = await this.sessionStore.hasValidSession();

        // 如果本地session无效，尝试从运行中的浏览器恢复
        if (!hasValidSession) {
            const recovered = await this.tryRecoverSessionFromBrowser();
            if (recovered) {
                logToFile('[DEBUG] checkLoginStatus: 从浏览器恢复session成功');
                hasValidSession = true;
            }
        }

        if (!hasValidSession) {
            return {
                已登录: false,
                消息: '未登录或Session已过期，请扫码登录',
            };
        }

        // 检查cookies中是否包含关键cookie（SESSION或HOLDONKEY）
        const cookies = await this.sessionStore.getCookies();
        const hasSessionCookie = cookies.some(c =>
            c.name === 'SESSION' || c.name === 'HOLDONKEY'
        );
        
        if (!hasSessionCookie) {
            logToFile('[DEBUG] checkLoginStatus: 没有关键cookie，session无效');
            await this.sessionStore.clearSession();
            return {
                已登录: false,
                消息: '未登录或Session已过期，请扫码登录',
            };
        }

        // 有关键cookie，认为session可能有效
        // 不再通过页面检测来删除session，避免误删
        logToFile(`[DEBUG] checkLoginStatus: 发现 ${cookies.length} 个cookies，包含关键cookie，认为已登录`);
        
        const remainingTTL = await this.sessionStore.getRemainingTTL();
        return {
            已登录: true,
            消息: '已登录',
            剩余有效时间: remainingTTL,
        };
    }

    /**
     * 尝试从运行中的浏览器恢复Session到本地文件
     * 当本地session文件被删除但浏览器仍处于登录状态时使用
     * @returns 是否成功恢复
     */
    private async tryRecoverSessionFromBrowser(): Promise<boolean> {
        // 检查浏览器context是否存在
        if (!this.context) {
            logToFile('[DEBUG] tryRecoverSessionFromBrowser: 浏览器context不存在，无法恢复');
            return false;
        }

        try {
            // 从浏览器获取cookies
            const browserCookies = await this.context.cookies('https://wenshu.court.gov.cn');
            logToFile(`[DEBUG] tryRecoverSessionFromBrowser: 从浏览器获取到 ${browserCookies.length} 个cookies`);
            
            if (browserCookies.length === 0) {
                // 尝试获取所有cookies
                const allCookies = await this.context.cookies();
                logToFile(`[DEBUG] tryRecoverSessionFromBrowser: 获取所有cookies共 ${allCookies.length} 个`);
                
                if (allCookies.length === 0) {
                    return false;
                }
                
                // 检查是否包含关键cookie
                const hasKeySessionCookie = allCookies.some(c =>
                    c.name === 'SESSION' || c.name === 'HOLDONKEY'
                );
                
                if (!hasKeySessionCookie) {
                    logToFile('[DEBUG] tryRecoverSessionFromBrowser: 浏览器中没有关键cookie，无法恢复');
                    return false;
                }
                
                // 恢复session到文件
                const cookieInfos: CookieInfo[] = convertPlaywrightCookies(allCookies);
                await this.sessionStore.saveSession(cookieInfos);
                logToFile(`[DEBUG] tryRecoverSessionFromBrowser: 已从浏览器恢复 ${cookieInfos.length} 个cookies到session文件`);
                return true;
            }
            
            // 检查是否包含关键cookie
            const hasKeySessionCookie = browserCookies.some(c =>
                c.name === 'SESSION' || c.name === 'HOLDONKEY'
            );
            
            if (!hasKeySessionCookie) {
                logToFile('[DEBUG] tryRecoverSessionFromBrowser: 浏览器中没有关键cookie，无法恢复');
                return false;
            }
            
            // 恢复session到文件
            const cookieInfos: CookieInfo[] = convertPlaywrightCookies(browserCookies);
            await this.sessionStore.saveSession(cookieInfos);
            logToFile(`[DEBUG] tryRecoverSessionFromBrowser: 已从浏览器恢复 ${cookieInfos.length} 个cookies到session文件`);
            return true;
        } catch (error) {
            logToFile(`[DEBUG] tryRecoverSessionFromBrowser: 恢复失败: ${error}`);
            return false;
        }
    }

    /**
     * 检查当前页面是否已登录
     * 采用保守策略：只有明确检测到已登录标志才返回true
     */
    private async isLoggedInOnPage(): Promise<boolean> {
        if (!this.page) {
            return false;
        }

        try {
            // 首先检查URL：如果还在登录页面，肯定未登录
            const url = this.page.url();
            if (url.includes('181010CARHS5BS3C') ||
                url.includes('login') ||
                url.includes('auth')) {
                logToFile(`[DEBUG] isLoggedInOnPage: URL包含登录页特征，判定为未登录: ${url}`);
                return false;
            }

            const frame = await this.getLoginFrame();

            // 检查是否存在二维码元素（存在则未登录）
            const qrCodeElement = await frame.$(QR_CODE_SELECTORS.qrCodeImage) ||
                                  await frame.$(QR_CODE_SELECTORS.qrCodeContainer);
            if (qrCodeElement) {
                const isVisible = await qrCodeElement.isVisible().catch(() => false);
                if (isVisible) {
                    logToFile('[DEBUG] isLoggedInOnPage: 检测到二维码元素，判定为未登录');
                    return false;
                }
            }

            // 检查是否存在用户信息元素（通常在顶层页面或iframe中都可能出现）
            const userInfoElement = await this.page.$(QR_CODE_SELECTORS.userInfo) ||
                                  await frame.$(QR_CODE_SELECTORS.userInfo);
            if (userInfoElement) {
                const isVisible = await userInfoElement.isVisible().catch(() => false);
                if (isVisible) {
                    logToFile('[DEBUG] isLoggedInOnPage: 检测到用户信息元素，判定为已登录');
                    return true;
                }
            }

            // 检查是否存在支付宝登录图标（存在则未登录）
            const alipayIcon = await frame.$('img[alt*="支付宝"], img[src*="alipay"]');
            if (alipayIcon) {
                const isVisible = await alipayIcon.isVisible().catch(() => false);
                if (isVisible) {
                    logToFile('[DEBUG] isLoggedInOnPage: 检测到支付宝登录图标，判定为未登录');
                    return false;
                }
            }

            // 默认返回false（保守策略：未明确检测到已登录就认为未登录）
            logToFile('[DEBUG] isLoggedInOnPage: 未检测到明确的登录状态标志，默认判定为未登录');
            return false;
        } catch (error) {
            logToFile(`[DEBUG] isLoggedInOnPage: 检查过程出错: ${error}`);
            return false;
        }
    }

    /**
     * 获取登录frame
     * 裁判文书网登录框嵌套在iframe中
     */
    private async getLoginFrame(): Promise<Page | Frame> {
        if (!this.page) {
            throw new Error('页面未初始化');
        }

        try {
            const iframeElement = await this.page.$('iframe#contentIframe');
            if (iframeElement) {
                const frame = await iframeElement.contentFrame();
                if (frame) {
                    return frame as unknown as Page; //甚至可以直接用Frame，它们有类似的API接口
                }
            }
        } catch (error) {
            console.log('获取iframe失败，使用主页面:', error);
        }

        return this.page;
    }

    /**
     * 获取登录二维码
     * 需求 7.2: 当用户未登录时，文书服务器应返回支付宝认证的二维码URL
     */
    async getLoginQRCode(): Promise<QRCodeInfo> {
        await this.initBrowser();

        if (!this.page) {
            throw new Error('浏览器页面初始化失败');
        }

        // 导航到登录页面
        await this.page.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' });

        // 等待页面加载
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
        
        // 等待iframe加载
        try {
            await this.page.waitForSelector('iframe#contentIframe', { timeout: 10000, state: 'attached' });
        } catch (e) {
            console.log('等待iframe超时，尝试继续');
        }

        // 点击支付宝图标触发二维码显示
        await this.clickAlipayIcon();

        // 获取frame
        const frame = await this.getLoginFrame();

        // 显式等待支付宝二维码出现（最多等待10秒）
        try {
            logToFile('[DEBUG] 等待支付宝二维码元素出现...');
            // 优先等待精确的ID
            await frame.waitForSelector(QR_CODE_SELECTORS.alipayQRCode, { timeout: 5000, state: 'visible' });
            logToFile('[DEBUG] 支付宝二维码元素已出现');
        } catch (e) {
            logToFile(`[DEBUG] 等待精确二维码超时，尝试等待通用二维码: ${e}`);
            // 降级：等待通用二维码
            try {
                await frame.waitForSelector(QR_CODE_SELECTORS.qrCodeImage, { timeout: 5000, state: 'visible' });
            } catch (e2) {
                logToFile(`[DEBUG] 等待通用二维码也超时了: ${e2}`);
            }
        }

        // 稍微等待渲染完成
        await this.page.waitForTimeout(1000);

        // 截取二维码区域或整个页面
        let qrCodeBase64: string;

        try {
            // 尝试找到二维码元素并截图
            // 优先尝试精确选择器
            let qrCodeElement = await frame.$(QR_CODE_SELECTORS.alipayQRCode);
            
            if (!qrCodeElement) {
                // 尝试通用选择器
                qrCodeElement = await frame.$(QR_CODE_SELECTORS.qrCodeImage)
                    || await frame.$(QR_CODE_SELECTORS.qrCodeContainer);
            }

            if (qrCodeElement && await qrCodeElement.isVisible()) {
                const screenshot = await qrCodeElement.screenshot({ type: 'png' });
                qrCodeBase64 = screenshot.toString('base64');
                logToFile('[DEBUG] 成功截取二维码元素');
            } else {
                // 如果找不到二维码元素，截取整个页面
                const screenshot = await this.page.screenshot({ type: 'png' });
                qrCodeBase64 = screenshot.toString('base64');
            }
        } catch {
            // 截取整个页面作为备选
            const screenshot = await this.page.screenshot({ type: 'png' });
            qrCodeBase64 = screenshot.toString('base64');
        }

        return {
            二维码图片Base64: qrCodeBase64,
            说明: '请使用支付宝扫描二维码登录裁判文书网',
            过期秒数: 120, // 二维码通常2分钟过期
        };
    }

    /**
     * 点击支付宝图标触发二维码显示
     * 裁判文书网登录页面需要先点击支付宝图标才会显示二维码
     */
    private async clickAlipayIcon(): Promise<void> {
        if (!this.page) {
            return;
        }

        const frame = await this.getLoginFrame();

        // 策略1: 使用选择器直接查找支付宝图标
        const alipaySelectors = QR_CODE_SELECTORS.alipayIcon.split(', ');
        for (const selector of alipaySelectors) {
            try {
                const element = await frame.$(selector);
                if (element && await element.isVisible()) {
                    await element.click();
                    console.log(`成功点击支付宝图标: ${selector}`);
                    await this.page.waitForTimeout(2000); // 等待二维码加载
                    return;
                }
            } catch {
                // 继续尝试下一个选择器
            }
        }

        // 策略2: 查找包含"支付宝"文字的可点击元素
        try {
            const alipayText = frame.getByText('支付宝', { exact: false });
            const count = await alipayText.count();
            if (count > 0) {
                await alipayText.first().click();
                console.log('成功点击包含"支付宝"文字的元素');
                await this.page.waitForTimeout(2000);
                return;
            }
        } catch {
            // 继续尝试其他方法
        }

        // 策略3: 查找所有图片元素，通过alt或src属性识别支付宝图标
        try {
            const allImages = await frame.$$('img');
            for (const img of allImages) {
                const alt = await img.getAttribute('alt') || '';
                const src = await img.getAttribute('src') || '';
                const title = await img.getAttribute('title') || '';
                
                if (alt.includes('支付宝') || alt.toLowerCase().includes('alipay') ||
                    src.includes('alipay') || src.includes('zhifubao') ||
                    title.includes('支付宝')) {
                    if (await img.isVisible()) {
                        await img.click();
                        console.log('通过图片属性识别并点击支付宝图标');
                        await this.page.waitForTimeout(2000);
                        return;
                    }
                }
            }
        } catch {
            // 继续尝试其他方法
        }

        // 策略4: 尝试点击登录按钮（作为备选）
        try {
            const loginBtn = await frame.$(QR_CODE_SELECTORS.loginButton);
            if (loginBtn && await loginBtn.isVisible()) {
                await loginBtn.click();
                console.log('点击了通用登录按钮');
                await this.page.waitForTimeout(2000);
            }
        } catch {
            // 忽略点击失败
        }

        console.log('警告: 未能找到支付宝登录图标，请检查页面结构');
    }

    /**
     * 等待登录完成
     * 需求 7.3: 当用户扫码完成认证后，文书服务器应将认证Token存储到本地
     */
    async waitForLogin(timeoutSeconds: number = 120): Promise<WaitLoginResult> {
        if (!this.page) {
            return {
                成功: false,
                消息: '浏览器未初始化，请先获取二维码',
            };
        }

        const startTime = Date.now();
        const timeoutMs = timeoutSeconds * 1000;

        while (Date.now() - startTime < timeoutMs) {
            // 检查是否已登录
            const isLoggedIn = await this.isLoggedInOnPage();

            if (isLoggedIn) {
                // 登录成功，保存Session
                await this.saveCurrentSession();

                return {
                    成功: true,
                    消息: '登录成功，Session已保存',
                };
            }

            // 检查页面URL变化（登录成功后通常会跳转）
            const currentUrl = this.page.url();
            // 181010CARHS5BS3C 是登录页面的特征路径
            if (!currentUrl.includes('181010CARHS5BS3C') &&
                !currentUrl.includes('login') &&
                !currentUrl.includes('auth')) {
                // 确实已经跳转离开登录页
                await this.saveCurrentSession();
                return {
                    成功: true,
                    消息: '登录成功，Session已保存',
                };
            }

            // 等待一段时间后再检查
            await this.page.waitForTimeout(2000);
        }

        return {
            成功: false,
            消息: `登录超时（${timeoutSeconds}秒），请重新获取二维码`,
        };
    }

    /**
     * 弹出浏览器窗口登录（有头模式）
     * 用于本地开发和首次登录场景
     */
    async loginWithBrowser(timeoutSeconds: number = 180): Promise<WaitLoginResult> {
        // 强制使用有头模式
        await this.closeBrowser();
        await this.initBrowser(false); // headless = false

        if (!this.page) {
            return {
                成功: false,
                消息: '浏览器初始化失败',
            };
        }

        // 导航到登录页面
        await this.page.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' });

        // 等待用户手动扫码登录
        const result = await this.waitForLogin(timeoutSeconds);

        // 登录成功后切换到无头模式重新初始化浏览器
        // 不再直接关闭浏览器，而是保持session并重新初始化
        if (result.成功) {
            logToFile('[DEBUG] loginWithBrowser: 登录成功，切换到无头模式');
            // 保存当前session后再关闭有头浏览器
            await this.saveCurrentSession();
            await this.closeBrowser();
            // 重新以无头模式初始化，这样后续操作可以正常进行
            await this.initBrowser(true);
            logToFile('[DEBUG] loginWithBrowser: 已切换到无头模式');
        }

        return result;
    }

    /**
     * 保存当前浏览器Session
     */
    private async saveCurrentSession(): Promise<void> {
        if (!this.context) {
            logToFile('[DEBUG] saveCurrentSession: context 为空，无法保存');
            return;
        }

        try {
            // 获取裁判文书网相关的Cookies（指定URL以确保获取正确域的cookies）
            const cookies = await this.context.cookies('https://wenshu.court.gov.cn');
            logToFile(`[DEBUG] saveCurrentSession: 从wenshu.court.gov.cn获取到 ${cookies.length} 个cookies`);
            
            // 如果没有获取到cookies，尝试获取所有cookies
            let allCookies = cookies;
            if (cookies.length === 0) {
                logToFile('[DEBUG] saveCurrentSession: 指定URL未获取到cookies，尝试获取所有cookies');
                allCookies = await this.context.cookies();
                logToFile(`[DEBUG] saveCurrentSession: 获取到所有cookies共 ${allCookies.length} 个`);
            }
            
            // 打印关键cookie信息（用于调试）
            for (const cookie of allCookies) {
                logToFile(`[DEBUG] saveCurrentSession: cookie "${cookie.name}" domain="${cookie.domain}" value="${cookie.value.substring(0, 20)}..."`);
            }
            
            if (allCookies.length === 0) {
                logToFile('[WARNING] saveCurrentSession: 没有获取到任何cookies！');
                return;
            }
            
            const cookieInfos: CookieInfo[] = convertPlaywrightCookies(allCookies);

            // 保存到SessionStore
            await this.sessionStore.saveSession(cookieInfos);
            logToFile(`[DEBUG] saveCurrentSession: 已保存 ${cookieInfos.length} 个cookies到session文件`);
            
            // 验证保存是否成功
            const savedCookies = await this.sessionStore.getCookies();
            logToFile(`[DEBUG] saveCurrentSession: 验证保存结果，读取到 ${savedCookies.length} 个cookies`);
        } catch (error) {
            logToFile(`保存Session失败: ${error}`);
            throw error;
        }
    }

    /**
     * 获取当前浏览器页面（供其他模块使用）
     * 包含页面状态检测和自动恢复逻辑
     */
    async getPage(): Promise<Page> {
        // 检查浏览器和页面是否仍然有效
        if (this.page) {
            try {
                // 尝试执行一个简单操作来验证页面是否仍然有效
                await this.page.url();
            } catch (error) {
                // 页面已失效，需要重新初始化
                logToFile(`[DEBUG] getPage: 页面已失效，需要重新初始化: ${error}`);
                this.page = null;
                this.context = null;
                this.browser = null;
            }
        }

        // 检查浏览器是否仍然连接
        if (this.browser) {
            try {
                if (!this.browser.isConnected()) {
                    logToFile('[DEBUG] getPage: 浏览器已断开连接，需要重新初始化');
                    this.page = null;
                    this.context = null;
                    this.browser = null;
                }
            } catch (error) {
                logToFile(`[DEBUG] getPage: 检查浏览器连接失败: ${error}`);
                this.page = null;
                this.context = null;
                this.browser = null;
            }
        }

        await this.initBrowser();

        if (!this.page) {
            throw new Error('浏览器页面初始化失败');
        }

        return this.page;
    }

    /**
     * 获取浏览器上下文（供其他模块使用）
     */
    async getContext(): Promise<BrowserContext> {
        await this.initBrowser();

        if (!this.context) {
            throw new Error('浏览器上下文初始化失败');
        }

        return this.context;
    }

    /**
     * 获取SessionStore实例
     */
    getSessionStore(): SessionStore {
        return this.sessionStore;
    }

    /**
     * 关闭浏览器
     */
    async closeBrowser(): Promise<void> {
        if (this.page) {
            await this.page.close().catch(() => { });
            this.page = null;
        }

        if (this.context) {
            await this.context.close().catch(() => { });
            this.context = null;
        }

        if (this.browser) {
            await this.browser.close().catch(() => { });
            this.browser = null;
        }
    }

    /**
     * 清除Session并关闭浏览器
     */
    async logout(): Promise<void> {
        await this.sessionStore.clearSession();
        await this.closeBrowser();
    }

    /**
     * 刷新Session有效期
     */
    async refreshSession(): Promise<boolean> {
        return this.sessionStore.refreshSession();
    }
}

/**
 * 创建认证管理器实例
 */
export function createAuthManager(config?: AuthManagerConfig): AuthManager {
    return new AuthManager(config);
}

/**
 * 默认认证管理器实例（单例）
 */
let defaultAuthManager: AuthManager | null = null;

/**
 * 获取默认认证管理器实例
 */
export function getDefaultAuthManager(): AuthManager {
    if (!defaultAuthManager) {
        defaultAuthManager = new AuthManager();
    }
    return defaultAuthManager;
}

/**
 * 重置默认认证管理器
 */
export async function resetDefaultAuthManager(): Promise<void> {
    if (defaultAuthManager) {
        await defaultAuthManager.closeBrowser();
        defaultAuthManager = null;
    }
}
