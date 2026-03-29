/**
 * 认证管理器模块
 * 实现浏览器初始化、登录状态检查、二维码获取和等待登录完成
 * 需求: 7.1, 7.2, 7.3
 */

import { chromium, Browser, BrowserContext, Page, Frame } from 'playwright';
import {
    SessionStore,
    CookieInfo,
    SessionStoreConfig,
    convertPlaywrightCookies,
    convertToPlaywrightCookies,
} from './session-store.js';
import { AuthLogger, createAuthLogger } from './logger.js';
import { PagePoolManager, createPagePoolManager } from './page-pool.js';

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
    /** 最大并发页面数（页面池大小），默认5 */
    maxConcurrentPages?: number;
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
    maxConcurrentPages: 10,
};

/**
 * 二维码选择器（支付宝扫码登录）
 */
const QR_CODE_SELECTORS = {
    /** 二维码图片选择器 */
    qrCodeImage: '#alipay-qrcode, img[src*="alipay.com"], img[id*="qrcode"], img[class*="qrcode"]',
    /** 二维码容器选择器 */
    qrCodeContainer: '.qrcode-container, .login-qrcode',
    /** 支付宝二维码精确选择器 */
    alipayQRCode: '#alipay-qrcode',
    /** 登录成功后的用户信息选择器 */
    userInfo: '.user-info, .username, [class*="user-name"], .login-user',
    /** 登录容器选择器 */
    loginContainer: 'iframe#contentIframe, .login-box, .login-content, .login-panel, .login-container, .login-dialog, .qrcode-container, .login-qrcode',
    /** 登录按钮选择器 */
    loginButton: '.login-btn, button.login-btn, a.login-btn, button:has-text("登录"), a:has-text("登录"), button:has-text("扫码登录"), a:has-text("扫码登录")',
    /** 支付宝登录图标选择器（点击后显示二维码） */
    alipayIcon: '.login-type-item.alipay, img[alt*="支付宝"], img[src*="alipay"], img[src*="zhifubao"], .alipay-icon, .alipay-login, [title*="支付宝"], a:has(img[alt*="支付宝"])',
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
    private readonly logger: AuthLogger;
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private readonly pagePoolManager: PagePoolManager;

    constructor(config?: AuthManagerConfig) {
        this.sessionStore = new SessionStore(config?.sessionConfig);
        this.config = {
            headless: config?.headless ?? DEFAULT_CONFIG.headless,
            wenshuUrl: config?.wenshuUrl ?? DEFAULT_CONFIG.wenshuUrl,
            loginUrl: config?.loginUrl ?? DEFAULT_CONFIG.loginUrl,
            browserTimeout: config?.browserTimeout ?? DEFAULT_CONFIG.browserTimeout,
            pageTimeout: config?.pageTimeout ?? DEFAULT_CONFIG.pageTimeout,
            maxConcurrentPages: config?.maxConcurrentPages ?? DEFAULT_CONFIG.maxConcurrentPages,
        };

        const sessionPath = config?.sessionConfig?.sessionPath ?? './session-data';
        this.logger = createAuthLogger(sessionPath);
        this.pagePoolManager = createPagePoolManager(
            async () => this.getContext(),
            this.config.pageTimeout,
            this.config.maxConcurrentPages,
            this.logger,
        );

        this.logger.log('[DEBUG] AuthManager 初始化完成');
    }

    /**
     * 初始化浏览器
     * 需求 7.1: 文书服务器应提供检查当前登录状态的工具
     */
    async initBrowser(headless?: boolean): Promise<void> {
        const useHeadless = headless ?? this.config.headless;

        if (this.browser) {
            try {
                if (!this.browser.isConnected()) {
                    this.logger.log('[DEBUG] initBrowser: 浏览器连接已断开，准备重新初始化');
                    this.browser = null;
                    this.context = null;
                    this.page = null;
                }
            } catch (error) {
                this.logger.log(`[DEBUG] initBrowser: 检查浏览器连接失败，准备重新初始化: ${error}`);
                this.browser = null;
                this.context = null;
                this.page = null;
            }
        }

        if (this.context) {
            try {
                await this.context.cookies();
            } catch (error) {
                this.logger.log(`[DEBUG] initBrowser: 浏览器上下文已失效，准备重新创建: ${error}`);
                this.context = null;
                this.page = null;
            }
        }

        if (this.page?.isClosed()) {
            this.logger.log('[DEBUG] initBrowser: 页面已关闭，准备重新创建');
            this.page = null;
        }

        if (!this.browser) {
            this.browser = await chromium.launch({
                headless: useHeadless,
                timeout: this.config.browserTimeout,
            });
        }

        const browser = this.browser;
        if (!browser) {
            throw new Error('浏览器实例初始化失败');
        }

        if (!this.context) {
            this.context = await browser.newContext({
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            });

            await this.loadSavedSession();
        }

        const context = this.context;
        if (!context) {
            throw new Error('浏览器上下文初始化失败');
        }

        if (!this.page) {
            this.page = await context.newPage();
            this.page.setDefaultTimeout(this.config.pageTimeout);
        }
    }

    /**
     * 加载已保存的Session到浏览器上下文
     */
    private async loadSavedSession(): Promise<boolean> {
        if (!this.context) {
            this.logger.log('[DEBUG] loadSavedSession: context 为空');
            return false;
        }

        const cookies = await this.sessionStore.getCookies();
        this.logger.log(`[DEBUG] loadSavedSession: 从session文件读取到 ${cookies.length} 个cookies`);

        if (cookies.length === 0) {
            this.logger.log('[DEBUG] loadSavedSession: 没有保存的cookies，需要重新登录');
            return false;
        }

        try {
            const playwrightCookies = convertToPlaywrightCookies(cookies);
            await this.context.addCookies(playwrightCookies);
            this.logger.log(`[DEBUG] loadSavedSession: 成功添加 ${playwrightCookies.length} 个cookies到浏览器`);
            return true;
        } catch (error) {
            this.logger.log(`加载Session到浏览器失败: ${error}`);
            return false;
        }
    }

    /**
     * 检查登录状态
     * 需求 7.1: 文书服务器应提供检查当前登录状态的工具
     * 需求 7.4: 当存储的Token存在且未过期时，文书服务器应将其用于后续请求
     */
    async checkLoginStatus(): Promise<AuthStatus> {
        let hasValidSession = await this.sessionStore.hasValidSession();

        if (!hasValidSession) {
            const recovered = await this.tryRecoverSessionFromBrowser();
            if (recovered) {
                this.logger.log('[DEBUG] checkLoginStatus: 从浏览器恢复session成功');
                hasValidSession = true;
            }
        }

        if (!hasValidSession) {
            return {
                已登录: false,
                消息: '未登录或Session已过期，请扫码登录',
            };
        }

        const cookies = await this.sessionStore.getCookies();
        const hasSessionCookie = cookies.some(c => c.name === 'SESSION' || c.name === 'HOLDONKEY');

        if (!hasSessionCookie) {
            this.logger.log('[DEBUG] checkLoginStatus: 没有关键cookie，session无效');
            await this.sessionStore.clearSession();
            return {
                已登录: false,
                消息: '未登录或Session已过期，请扫码登录',
            };
        }

        this.logger.log(`[DEBUG] checkLoginStatus: 发现 ${cookies.length} 个cookies，包含关键cookie，认为已登录`);

        const remainingTTL = await this.sessionStore.getRemainingTTL();
        return {
            已登录: true,
            消息: '已登录',
            剩余有效时间: remainingTTL,
        };
    }

    /**
     * 尝试从运行中的浏览器恢复Session到本地文件
     */
    private async tryRecoverSessionFromBrowser(): Promise<boolean> {
        if (!this.context) {
            this.logger.log('[DEBUG] tryRecoverSessionFromBrowser: 浏览器context不存在，无法恢复');
            return false;
        }

        try {
            const browserCookies = await this.context.cookies('https://wenshu.court.gov.cn');
            this.logger.log(`[DEBUG] tryRecoverSessionFromBrowser: 从浏览器获取到 ${browserCookies.length} 个cookies`);

            if (browserCookies.length === 0) {
                const allCookies = await this.context.cookies();
                this.logger.log(`[DEBUG] tryRecoverSessionFromBrowser: 获取所有cookies共 ${allCookies.length} 个`);

                if (allCookies.length === 0) {
                    return false;
                }

                const hasKeySessionCookie = allCookies.some(c => c.name === 'SESSION' || c.name === 'HOLDONKEY');
                if (!hasKeySessionCookie) {
                    this.logger.log('[DEBUG] tryRecoverSessionFromBrowser: 浏览器中没有关键cookie，无法恢复');
                    return false;
                }

                const cookieInfos: CookieInfo[] = convertPlaywrightCookies(allCookies);
                await this.sessionStore.saveSession(cookieInfos);
                this.logger.log(`[DEBUG] tryRecoverSessionFromBrowser: 已从浏览器恢复 ${cookieInfos.length} 个cookies到session文件`);
                return true;
            }

            const hasKeySessionCookie = browserCookies.some(c => c.name === 'SESSION' || c.name === 'HOLDONKEY');
            if (!hasKeySessionCookie) {
                this.logger.log('[DEBUG] tryRecoverSessionFromBrowser: 浏览器中没有关键cookie，无法恢复');
                return false;
            }

            const cookieInfos: CookieInfo[] = convertPlaywrightCookies(browserCookies);
            await this.sessionStore.saveSession(cookieInfos);
            this.logger.log(`[DEBUG] tryRecoverSessionFromBrowser: 已从浏览器恢复 ${cookieInfos.length} 个cookies到session文件`);
            return true;
        } catch (error) {
            this.logger.log(`[DEBUG] tryRecoverSessionFromBrowser: 恢复失败: ${error}`);
            return false;
        }
    }

    /**
     * 判断指定URL是否为登录页
     */
    private isLoginPageUrl(url: string): boolean {
        return url.includes('181010CARHS5BS3C') || url.includes('login') || url.includes('auth');
    }

    /**
     * 检查指定页面是否已登录
     */
    async isLoggedInOnPage(page?: Page): Promise<boolean> {
        const targetPage = page ?? this.page;
        if (!targetPage) {
            return false;
        }

        try {
            const url = targetPage.url();
            if (!url || url === 'about:blank') {
                this.logger.log('[DEBUG] isLoggedInOnPage: 页面为空白页，暂不判定为已登录');
                return false;
            }

            if (this.isLoginPageUrl(url)) {
                this.logger.log(`[DEBUG] isLoggedInOnPage: URL包含登录页特征，判定为未登录: ${url}`);
                return false;
            }

            const frame = await this.getLoginFrame(targetPage);

            const userInfoElement = await targetPage.$(QR_CODE_SELECTORS.userInfo)
                || await frame.$(QR_CODE_SELECTORS.userInfo);
            if (userInfoElement) {
                const isVisible = await userInfoElement.isVisible().catch(() => false);
                if (isVisible) {
                    this.logger.log('[DEBUG] isLoggedInOnPage: 检测到用户信息元素，判定为已登录');
                    return true;
                }
            }

            const qrCodeElement = await frame.$(QR_CODE_SELECTORS.qrCodeImage)
                || await frame.$(QR_CODE_SELECTORS.qrCodeContainer);
            const hasVisibleQrCode = qrCodeElement
                ? await qrCodeElement.isVisible().catch(() => false)
                : false;

            const loginContainerElement = await targetPage.$(QR_CODE_SELECTORS.loginContainer)
                || await frame.$(QR_CODE_SELECTORS.loginContainer);
            const hasVisibleLoginContainer = loginContainerElement
                ? await loginContainerElement.isVisible().catch(() => false)
                : false;

            const loginButtonElement = await targetPage.$(QR_CODE_SELECTORS.loginButton)
                || await frame.$(QR_CODE_SELECTORS.loginButton);
            const hasVisibleLoginButton = loginButtonElement
                ? await loginButtonElement.isVisible().catch(() => false)
                : false;

            const alipayIconElement = await targetPage.$(QR_CODE_SELECTORS.alipayIcon)
                || await frame.$(QR_CODE_SELECTORS.alipayIcon);
            const hasVisibleAlipayIcon = alipayIconElement
                ? await alipayIconElement.isVisible().catch(() => false)
                : false;

            if (hasVisibleQrCode) {
                this.logger.log('[DEBUG] isLoggedInOnPage: 检测到二维码元素，判定为未登录');
                return false;
            }

            if (hasVisibleLoginContainer && (hasVisibleLoginButton || hasVisibleAlipayIcon)) {
                this.logger.log(
                    `[DEBUG] isLoggedInOnPage: 检测到登录容器与入口 container=${hasVisibleLoginContainer}, button=${hasVisibleLoginButton}, alipay=${hasVisibleAlipayIcon}，判定为未登录`,
                );
                return false;
            }

            this.logger.log('[DEBUG] isLoggedInOnPage: 未检测到登录入口，当前页面视为已登录');
            return true;
        } catch (error) {
            this.logger.log(`[DEBUG] isLoggedInOnPage: 检查过程出错: ${error}`);
            return false;
        }
    }

    /**
     * 将本地保存的Session同步到当前浏览器上下文
     */
    private async syncSavedSessionToContext(): Promise<boolean> {
        const cookies = await this.sessionStore.getCookies();
        if (cookies.length === 0) {
            this.logger.log('[DEBUG] syncSavedSessionToContext: session文件中没有cookies');
            return false;
        }

        const hasKeySessionCookie = cookies.some(c => c.name === 'SESSION' || c.name === 'HOLDONKEY');
        if (!hasKeySessionCookie) {
            this.logger.log('[DEBUG] syncSavedSessionToContext: session文件缺少关键cookie');
            return false;
        }

        try {
            const context = await this.getContext();
            const playwrightCookies = convertToPlaywrightCookies(cookies);
            await context.addCookies(playwrightCookies);
            this.logger.log(`[DEBUG] syncSavedSessionToContext: 已同步 ${playwrightCookies.length} 个cookies到浏览器上下文`);
            return true;
        } catch (error) {
            this.logger.log(`[DEBUG] syncSavedSessionToContext: 同步失败: ${error}`);
            return false;
        }
    }

    /**
     * 尝试恢复业务页登录态
     */
    async recoverPageLogin(page: Page, targetUrl?: string): Promise<boolean> {
        if (await this.isLoggedInOnPage(page)) {
            this.logger.log('[DEBUG] recoverPageLogin: 页面已处于登录态');
            return true;
        }

        const synced = await this.syncSavedSessionToContext();
        if (!synced) {
            this.logger.log('[DEBUG] recoverPageLogin: 无法从本地session恢复浏览器上下文');
            return false;
        }

        let currentUrl = '';
        try {
            currentUrl = page.url();
        } catch (error) {
            this.logger.log(`[DEBUG] recoverPageLogin: 读取当前页面URL失败: ${error}`);
        }

        const reloadUrl = targetUrl
            ?? (!currentUrl || currentUrl === 'about:blank' || this.isLoginPageUrl(currentUrl)
                ? this.config.wenshuUrl
                : currentUrl);

        try {
            await page.goto(reloadUrl, { waitUntil: 'domcontentloaded' });
            await page.waitForLoadState('networkidle', { timeout: this.config.pageTimeout }).catch(() => { });
        } catch (error) {
            this.logger.log(`[DEBUG] recoverPageLogin: 重新打开业务页失败: ${error}`);
        }

        const isLoggedIn = await this.isLoggedInOnPage(page);
        this.logger.log(`[DEBUG] recoverPageLogin: 页面恢复后登录态=${isLoggedIn}`);

        if (isLoggedIn) {
            await this.saveCurrentSession().catch((error) => {
                this.logger.log(`[DEBUG] recoverPageLogin: 保存恢复后的session失败: ${error}`);
            });
        }

        return isLoggedIn;
    }

    /**
     * 获取登录frame
     */
    private async getLoginFrame(page?: Page): Promise<Page | Frame> {
        const targetPage = page ?? this.page;
        if (!targetPage) {
            throw new Error('页面未初始化');
        }

        try {
            const iframeElement = await targetPage.$('iframe#contentIframe');
            if (iframeElement) {
                const frame = await iframeElement.contentFrame();
                if (frame) {
                    return frame as unknown as Page;
                }
            }
        } catch (error) {
            this.logger.log(`获取iframe失败，使用当前页面: ${error}`);
        }

        return targetPage;
    }

    /**
     * 获取登录二维码
     */
    async getLoginQRCode(): Promise<QRCodeInfo> {
        const maxRetries = 3;
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.log(`[DEBUG] getLoginQRCode: 第 ${attempt}/${maxRetries} 次尝试获取二维码`);
                return await this.tryGetLoginQRCode();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                this.logger.log(`[DEBUG] getLoginQRCode: 第 ${attempt} 次尝试失败: ${lastError.message}`);

                if (attempt < maxRetries) {
                    this.logger.log('[DEBUG] getLoginQRCode: 等待2秒后重试...');

                    const page = await this.getPage();
                    await page.waitForTimeout(2000).catch(() => { });

                    try {
                        await page.reload({ waitUntil: 'domcontentloaded' });
                    } catch (reloadError) {
                        this.logger.log(`[DEBUG] getLoginQRCode: reload失败，改为重新打开登录页: ${reloadError}`);
                        const recoveredPage = await this.getPage();
                        await recoveredPage.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' });
                    }
                }
            }
        }

        throw new Error(`获取二维码失败（已重试${maxRetries}次）: ${lastError?.message || '未知错误'}`);
    }

    /**
     * 尝试获取二维码的内部实现
     */
    private async tryGetLoginQRCode(): Promise<QRCodeInfo> {
        const page = await this.getPage();

        await page.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });

        try {
            await page.waitForSelector('iframe#contentIframe', { timeout: 10000, state: 'attached' });
            this.logger.log('[DEBUG] tryGetLoginQRCode: iframe已加载');
        } catch (error) {
            this.logger.log(`[DEBUG] tryGetLoginQRCode: 等待iframe超时: ${error}`);
        }

        await this.clickAlipayIcon(page);

        const frame = await this.getLoginFrame(page);
        try {
            this.logger.log('[DEBUG] tryGetLoginQRCode: 等待支付宝二维码元素出现...');
            await frame.waitForSelector(QR_CODE_SELECTORS.alipayQRCode, { timeout: 5000, state: 'visible' });
            this.logger.log('[DEBUG] tryGetLoginQRCode: 支付宝二维码元素已出现 (alipayQRCode)');
        } catch (error) {
            this.logger.log(`[DEBUG] tryGetLoginQRCode: 等待精确二维码超时: ${error}`);
            try {
                await frame.waitForSelector(QR_CODE_SELECTORS.qrCodeImage, { timeout: 5000, state: 'visible' });
                this.logger.log('[DEBUG] tryGetLoginQRCode: 通用二维码元素已出现 (qrCodeImage)');
            } catch (fallbackError) {
                this.logger.log(`[DEBUG] tryGetLoginQRCode: 等待通用二维码也超时了: ${fallbackError}`);
            }
        }

        await page.waitForTimeout(1000);

        let qrCodeElement = await frame.$(QR_CODE_SELECTORS.alipayQRCode);
        if (!qrCodeElement) {
            qrCodeElement = await frame.$(QR_CODE_SELECTORS.qrCodeImage)
                || await frame.$(QR_CODE_SELECTORS.qrCodeContainer);
        }

        if (!qrCodeElement) {
            this.logger.log('[DEBUG] tryGetLoginQRCode: 未找到任何二维码元素');
            throw new Error('未找到二维码元素，请检查页面是否正常加载');
        }

        const isVisible = await qrCodeElement.isVisible().catch(() => false);
        if (!isVisible) {
            this.logger.log('[DEBUG] tryGetLoginQRCode: 二维码元素存在但不可见');
            throw new Error('二维码元素不可见，可能页面未完全加载');
        }

        const boundingBox = await qrCodeElement.boundingBox();
        if (!boundingBox || boundingBox.width < 50 || boundingBox.height < 50) {
            this.logger.log(`[DEBUG] tryGetLoginQRCode: 二维码元素尺寸异常: ${JSON.stringify(boundingBox)}`);
            throw new Error('二维码元素尺寸异常（太小或无尺寸），可能未正确加载');
        }

        this.logger.log(`[DEBUG] tryGetLoginQRCode: 二维码元素验证通过，尺寸: ${boundingBox.width}x${boundingBox.height}`);

        const screenshot = await qrCodeElement.screenshot({ type: 'png' });
        const qrCodeBase64 = screenshot.toString('base64');
        this.logger.log('[DEBUG] tryGetLoginQRCode: 成功截取二维码元素');

        return {
            二维码图片Base64: qrCodeBase64,
            说明: '请使用支付宝扫描二维码登录裁判文书网',
            过期秒数: 120,
        };
    }

    /**
     * 点击支付宝图标触发二维码显示
     */
    private async clickAlipayIcon(page?: Page): Promise<void> {
        const targetPage = page ?? this.page;
        if (!targetPage) {
            return;
        }

        const frame = await this.getLoginFrame(targetPage);
        const alipaySelectors = QR_CODE_SELECTORS.alipayIcon.split(', ');

        for (const selector of alipaySelectors) {
            try {
                const element = await frame.$(selector);
                if (element && await element.isVisible()) {
                    await element.click();
                    this.logger.log(`成功点击支付宝图标: ${selector}`);
                    await targetPage.waitForTimeout(2000);
                    return;
                }
            } catch {
                // 继续尝试下一个选择器
            }
        }

        try {
            const alipayText = frame.getByText('支付宝', { exact: false });
            const count = await alipayText.count();
            if (count > 0) {
                await alipayText.first().click();
                this.logger.log('成功点击包含"支付宝"文字的元素');
                await targetPage.waitForTimeout(2000);
                return;
            }
        } catch {
            // 继续尝试其他方法
        }

        try {
            const allImages = await frame.$$('img');
            for (const img of allImages) {
                const alt = await img.getAttribute('alt') || '';
                const src = await img.getAttribute('src') || '';
                const title = await img.getAttribute('title') || '';

                if (alt.includes('支付宝') || alt.toLowerCase().includes('alipay')
                    || src.includes('alipay') || src.includes('zhifubao')
                    || title.includes('支付宝')) {
                    if (await img.isVisible()) {
                        await img.click();
                        this.logger.log('通过图片属性识别并点击支付宝图标');
                        await targetPage.waitForTimeout(2000);
                        return;
                    }
                }
            }
        } catch {
            // 继续尝试其他方法
        }

        try {
            const loginBtn = await frame.$(QR_CODE_SELECTORS.loginButton);
            if (loginBtn && await loginBtn.isVisible()) {
                await loginBtn.click();
                this.logger.log('点击了通用登录按钮');
                await targetPage.waitForTimeout(2000);
            }
        } catch {
            // 忽略点击失败
        }

        this.logger.warn('未能找到支付宝登录图标，请检查页面结构');
    }

    /**
     * 等待登录完成
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
            const isLoggedIn = await this.isLoggedInOnPage();
            if (isLoggedIn) {
                await this.saveCurrentSession();
                return {
                    成功: true,
                    消息: '登录成功，Session已保存',
                };
            }

            const currentUrl = this.page.url();
            if (!this.isLoginPageUrl(currentUrl)) {
                await this.saveCurrentSession();
                return {
                    成功: true,
                    消息: '登录成功，Session已保存',
                };
            }

            await this.page.waitForTimeout(2000);
        }

        return {
            成功: false,
            消息: `登录超时（${timeoutSeconds}秒），请重新获取二维码`,
        };
    }

    /**
     * 弹出浏览器窗口登录（有头模式）
     */
    async loginWithBrowser(timeoutSeconds: number = 180): Promise<WaitLoginResult> {
        await this.closeBrowser();
        await this.initBrowser(false);

        if (!this.page) {
            return {
                成功: false,
                消息: '浏览器初始化失败',
            };
        }

        await this.page.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' });
        const result = await this.waitForLogin(timeoutSeconds);

        if (result.成功) {
            this.logger.log('[DEBUG] loginWithBrowser: 登录成功，切换到无头模式');
            await this.saveCurrentSession();
            await this.closeBrowser();
            await this.initBrowser(true);
            this.logger.log('[DEBUG] loginWithBrowser: 已切换到无头模式');
        }

        return result;
    }

    /**
     * 保存当前浏览器Session
     */
    private async saveCurrentSession(): Promise<void> {
        if (!this.context) {
            this.logger.log('[DEBUG] saveCurrentSession: context 为空，无法保存');
            return;
        }

        try {
            const cookies = await this.context.cookies('https://wenshu.court.gov.cn');
            this.logger.log(`[DEBUG] saveCurrentSession: 从wenshu.court.gov.cn获取到 ${cookies.length} 个cookies`);

            let allCookies = cookies;
            if (cookies.length === 0) {
                this.logger.log('[DEBUG] saveCurrentSession: 指定URL未获取到cookies，尝试获取所有cookies');
                allCookies = await this.context.cookies();
                this.logger.log(`[DEBUG] saveCurrentSession: 获取到所有cookies共 ${allCookies.length} 个`);
            }

            for (const cookie of allCookies) {
                this.logger.log(`[DEBUG] saveCurrentSession: cookie "${cookie.name}" domain="${cookie.domain}" value="${cookie.value.substring(0, 20)}..."`);
            }

            if (allCookies.length === 0) {
                this.logger.warn('saveCurrentSession: 没有获取到任何cookies！');
                return;
            }

            const cookieInfos: CookieInfo[] = convertPlaywrightCookies(allCookies);
            await this.sessionStore.saveSession(cookieInfos);
            this.logger.log(`[DEBUG] saveCurrentSession: 已保存 ${cookieInfos.length} 个cookies到session文件`);

            const savedCookies = await this.sessionStore.getCookies();
            this.logger.log(`[DEBUG] saveCurrentSession: 验证保存结果，读取到 ${savedCookies.length} 个cookies`);
        } catch (error) {
            this.logger.log(`保存Session失败: ${error}`);
            throw error;
        }
    }

    /**
     * 获取当前浏览器页面（供其他模块使用）
     */
    async getPage(): Promise<Page> {
        if (this.page) {
            try {
                await this.page.url();
            } catch (error) {
                this.logger.log(`[DEBUG] getPage: 页面已失效，需要重新初始化: ${error}`);
                this.page = null;
                this.context = null;
                this.browser = null;
            }
        }

        if (this.browser) {
            try {
                if (!this.browser.isConnected()) {
                    this.logger.log('[DEBUG] getPage: 浏览器已断开连接，需要重新初始化');
                    this.page = null;
                    this.context = null;
                    this.browser = null;
                }
            } catch (error) {
                this.logger.log(`[DEBUG] getPage: 检查浏览器连接失败: ${error}`);
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
     * 从页面池获取一个可用页面（用于并发搜索）
     */
    async acquirePage(): Promise<Page> {
        return this.pagePoolManager.acquirePage();
    }

    /**
     * 将页面归还到池中
     */
    releasePage(page: Page): void {
        this.pagePoolManager.releasePage(page);
    }

    /**
     * 获取页面池统计信息
     */
    getPoolStats(): { total: number; inUse: number; available: number; maxSize: number } {
        return this.pagePoolManager.getStats();
    }

    /**
     * 关闭浏览器
     */
    async closeBrowser(): Promise<void> {
        await this.pagePoolManager.closeAll();

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
