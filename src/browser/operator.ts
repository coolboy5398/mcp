/**
 * 页面操作器模块
 * 实现搜索操作、翻页操作和文书详情获取
 * 需求: 1.1, 2.1, 2.2, 2.3, 3.1, 5.1
 */

import { Page } from 'playwright';
import {
    DocumentDetail,
    SearchResponse,
    CaseType,
    CourtLevel,
} from '../models/index.js';
import {
    ServiceUnavailableError,
    NotFoundError,
    AuthRequiredError,
} from '../errors/index.js';
import {
    DEFAULT_OPERATOR_CONFIG,
    PAGE_SELECTORS,
} from './selectors.js';
import {
    parseSearchResults as parseSearchResultsFromPage,
    parseDocumentDetail as parseDocumentDetailFromPage,
} from './parsers.js';

/**
 * 搜索筛选参数接口
 * 需求 2.1, 2.2, 2.3: 支持案件类型、法院级别和日期范围筛选
 */
export interface SearchFilters {
    /** 案件类型筛选 */
    caseType?: CaseType;
    /** 法院级别筛选 */
    courtLevel?: CourtLevel;
    /** 裁判年份筛选 (YYYY)，通过结果页左侧树筛选 */
    judgmentYear?: string;
    /** 裁判日期范围起始 (YYYY-MM-DD)，通过高级检索实现 */
    startDate?: string;
    /** 裁判日期范围结束 (YYYY-MM-DD)，通过高级检索实现 */
    endDate?: string;
    /** 法院省份筛选 */
    province?: string;
    /** 审理法院名称筛选 */
    courtName?: string;
}

/**
 * 搜索参数接口
 * 需求 1.1: 通过关键词搜索裁判文书
 * 需求 5.1: 支持分页参数
 */
export interface SearchParams {
    /** 搜索关键词 */
    keyword: string;
    /** 筛选条件 */
    filters?: SearchFilters;
    /** 页码，默认1 */
    page?: number;
    /** 每页数量，默认20 */
    pageSize?: number;
}

/**
 * 页面操作器配置
 */
export interface OperatorConfig {
    /** 裁判文书网基础URL */
    baseUrl?: string;
    /** 搜索页面URL */
    searchUrl?: string;
    /** 页面加载超时（毫秒） */
    loadTimeout?: number;
    /** 元素等待超时（毫秒） */
    elementTimeout?: number;
}

/**
 * 页面操作器类
 * 封装对裁判文书网的页面操作
 */
export class PageOperator {
    private readonly page: Page;
    private readonly config: Required<OperatorConfig>;

    constructor(page: Page, config?: OperatorConfig) {
        this.page = page;
        this.config = {
            baseUrl: config?.baseUrl ?? DEFAULT_OPERATOR_CONFIG.baseUrl,
            searchUrl: config?.searchUrl ?? DEFAULT_OPERATOR_CONFIG.searchUrl,
            loadTimeout: config?.loadTimeout ?? DEFAULT_OPERATOR_CONFIG.loadTimeout,
            elementTimeout: config?.elementTimeout ?? DEFAULT_OPERATOR_CONFIG.elementTimeout,
        };
    }

    /**
     * 检查页面是否仍然有效可用
     * 在执行任何操作前调用，防止 "Target page, context or browser has been closed" 错误
     */
    private async ensurePageValid(): Promise<void> {
        try {
            this.page.url();

            if (this.page.isClosed()) {
                throw new ServiceUnavailableError(
                    '浏览器页面已关闭，请重新登录后再试。'
                    + '提示：如果刚刚执行了登录操作，请稍等片刻后重试。',
                );
            }
        } catch (error) {
            if (error instanceof ServiceUnavailableError) {
                throw error;
            }

            throw new ServiceUnavailableError(
                '浏览器页面已失效，请重新登录后再试。'
                + `原因：${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * 判断当前URL是否为登录页
     */
    private isLoginPageUrl(url: string): boolean {
        return url.includes('181010CARHS5BS3C');
    }

    /**
     * 检查是否需要登录
     */
    async checkLoginRequired(): Promise<boolean> {
        try {
            const currentUrl = this.page.url();
            if (this.isLoginPageUrl(currentUrl)) {
                return true;
            }

            const hasVisibleUserInfo = await this.page.locator(PAGE_SELECTORS.loginUserInfo).first().isVisible().catch(() => false);
            if (hasVisibleUserInfo) {
                return false;
            }

            const hasVisibleLoginContainer = await this.page.locator(PAGE_SELECTORS.loginContainer).first().isVisible().catch(() => false);
            const hasVisibleQRCode = await this.page.locator(PAGE_SELECTORS.loginQRCode).first().isVisible().catch(() => false);
            const hasVisibleLoginButton = await this.page.locator(PAGE_SELECTORS.loginButton).first().isVisible().catch(() => false);
            const hasVisibleAlipayEntry = await this.page.locator(PAGE_SELECTORS.loginAlipayEntry).first().isVisible().catch(() => false);

            if (hasVisibleQRCode) {
                return true;
            }

            if (hasVisibleLoginContainer && (hasVisibleLoginButton || hasVisibleAlipayEntry)) {
                return true;
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * 等待页面加载完成
     */
    private async waitForPageLoad(): Promise<void> {
        await this.page.waitForLoadState('domcontentloaded', { timeout: this.config.loadTimeout });
        await this.page.waitForLoadState('networkidle', { timeout: this.config.loadTimeout }).catch(() => { });
    }

    /**
     * 搜索文书
     * 需求 1.1: 通过关键词搜索裁判文书
     * 需求 2.1, 2.2, 2.3, 2.4: 支持筛选条件
     * 需求 5.1: 支持分页
     */
    async searchDocuments(params: SearchParams): Promise<SearchResponse> {
        const { keyword, filters, page = 1, pageSize = 20 } = params;

        console.error(`[DEBUG] searchDocuments: 开始搜索 keyword="${keyword}", page=${page}, pageSize=${pageSize}`);
        console.error('[DEBUG] searchDocuments: 检查页面有效性');
        await this.ensurePageValid();

        console.error(`[DEBUG] searchDocuments: 导航到 ${this.config.searchUrl}`);
        try {
            await this.page.goto(this.config.searchUrl, { waitUntil: 'domcontentloaded' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('Target page')
                || errorMessage.includes('closed')
                || errorMessage.includes('target closed')
                || errorMessage.includes('browser has been closed')) {
                throw new ServiceUnavailableError(
                    '浏览器页面已失效，请稍后重试搜索操作。'
                    + '提示：如果刚刚执行了登录操作，请等待几秒后再尝试搜索。',
                );
            }
            throw error;
        }
        await this.waitForPageLoad();
        console.error('[DEBUG] searchDocuments: 页面加载完成');

        if (await this.checkLoginRequired()) {
            console.error('[DEBUG] searchDocuments: 需要登录');
            throw new AuthRequiredError('需要登录才能搜索文书');
        }
        console.error('[DEBUG] searchDocuments: 已登录，继续搜索');

        console.error('[DEBUG] searchDocuments: 输入关键词');
        await this.inputSearchKeyword(keyword);
        await this.page.keyboard.press('Escape');

        if (filters?.courtName) {
            console.error('[DEBUG] searchDocuments: 打开高级检索面板');
            await this.openAdvancedSearch();

            console.error(`[DEBUG] searchDocuments: 输入法院名称 "${filters.courtName}"`);
            await this.inputCourtName(filters.courtName);
        }

        if (filters) {
            console.error('[DEBUG] searchDocuments: 应用筛选条件');
            await this.applyFilters(filters);
        }

        if (filters?.startDate || filters?.endDate) {
            console.error('[DEBUG] searchDocuments: 应用日期范围筛选（高级检索）');
            await this.applyDateRangeFilter(filters.startDate, filters.endDate);
        }

        console.error('[DEBUG] searchDocuments: 点击搜索按钮');
        await this.clickSearchButton();

        console.error('[DEBUG] searchDocuments: 等待搜索结果');
        await this.waitForSearchResults();

        if (filters?.province) {
            console.error(`[DEBUG] searchDocuments: 应用省份筛选 "${filters.province}"`);
            await this.applyProvinceFilter(filters.province);
            console.error('[DEBUG] searchDocuments: 等待省份筛选结果刷新');
            await this.waitForSearchResults();
        }

        if (filters?.judgmentYear && !filters?.startDate && !filters?.endDate) {
            console.error(`[DEBUG] searchDocuments: 应用裁判年份筛选 "${filters.judgmentYear}"`);
            await this.applyJudgmentYearFilter(filters.judgmentYear);
            console.error('[DEBUG] searchDocuments: 等待年份筛选结果刷新');
            await this.waitForSearchResults();
        }

        if (page > 1) {
            console.error(`[DEBUG] searchDocuments: 翻到第 ${page} 页`);
            await this.goToPage(page);
        }

        console.error('[DEBUG] searchDocuments: 解析搜索结果');
        const documents = await this.parseSearchResults();
        const total = await this.getTotalCount();

        console.error(`[DEBUG] searchDocuments: 完成！total=${total}, documents.length=${documents.length}`);

        return {
            total,
            page,
            pageSize,
            documents: documents.slice(0, pageSize),
        };
    }

    /**
     * 输入搜索关键词
     * 使用多层备选策略定位搜索框
     */
    private async inputSearchKeyword(keyword: string): Promise<void> {
        const searchInput = this.page.getByPlaceholder(PAGE_SELECTORS.searchInputPlaceholder);

        try {
            await searchInput.waitFor({
                state: 'visible',
                timeout: 5000,
            });
            await searchInput.clear();
            await searchInput.fill(keyword);
            return;
        } catch {
            // 精确匹配失败，继续尝试备选方案
        }

        const fallbackSelectors = [
            PAGE_SELECTORS.searchInputFallback,
            PAGE_SELECTORS.searchInputGeneric,
        ];

        for (const selector of fallbackSelectors) {
            const selectors = selector.split(',').map((s) => s.trim());
            for (const sel of selectors) {
                try {
                    const element = await this.page.waitForSelector(sel, {
                        state: 'visible',
                        timeout: 2000,
                    });
                    if (element) {
                        await element.fill(keyword);
                        return;
                    }
                } catch {
                    // 继续尝试下一个选择器
                }
            }
        }

        const allInputs = await this.page.$$('input[type="text"]:visible, input:not([type]):visible');
        for (const input of allInputs) {
            const isVisible = await input.isVisible();
            if (isVisible) {
                const placeholder = await input.getAttribute('placeholder');
                const id = await input.getAttribute('id');
                if (placeholder?.includes('搜索')
                    || placeholder?.includes('关键词')
                    || placeholder?.includes('案由')
                    || id?.includes('search')
                    || id?.includes('keyword')) {
                    await input.fill(keyword);
                    return;
                }
            }
        }

        if (allInputs.length > 0) {
            for (const input of allInputs) {
                const isVisible = await input.isVisible();
                if (isVisible) {
                    await input.fill(keyword);
                    return;
                }
            }
        }

        throw new ServiceUnavailableError('找不到搜索输入框，请确认页面已正确加载');
    }

    /**
     * 点击搜索按钮
     * 裁判文书网的搜索按钮是一个div元素，需要特殊处理
     */
    private async clickSearchButton(): Promise<void> {
        try {
            const searchBtn = this.page.locator('#searchBtn');
            if (await searchBtn.count() > 0 && await searchBtn.isVisible()) {
                await searchBtn.click();
                return;
            }
        } catch {
            // 继续尝试其他方法
        }

        try {
            const searchBtn = this.page.locator('div').filter({ hasText: /^搜索$/ }).first();
            await searchBtn.waitFor({ state: 'visible', timeout: 3000 });
            await searchBtn.click();
            return;
        } catch {
            // 继续尝试其他方法
        }

        try {
            const searchButton = this.page.getByText(PAGE_SELECTORS.searchButtonText, { exact: true }).first();
            await searchButton.waitFor({ state: 'visible', timeout: 3000 });
            await searchButton.click();
            return;
        } catch {
            // 继续尝试其他方法
        }

        const fallbackSelectors = [
            'div:text-is("搜索")',
            '.search-btn',
            'div.search-button',
            '[class*="search"] div:text("搜索")',
        ];

        for (const selector of fallbackSelectors) {
            try {
                const btn = await this.page.waitForSelector(selector, {
                    state: 'visible',
                    timeout: 1000,
                });
                if (btn) {
                    await btn.click();
                    return;
                }
            } catch {
                // 继续尝试下一个
            }
        }

        await this.page.keyboard.press('Enter');
    }

    /**
     * 应用筛选条件
     * 需求 2.4: 组合多个筛选条件时使用AND逻辑
     */
    private async applyFilters(filters: SearchFilters): Promise<void> {
        if (filters.caseType) {
            await this.applyCaseTypeFilter(filters.caseType);
        }

        if (filters.courtLevel) {
            await this.applyCourtLevelFilter(filters.courtLevel);
        }
    }

    /**
     * 应用案件类型筛选
     */
    private async applyCaseTypeFilter(caseType: CaseType): Promise<void> {
        const CASE_TYPE_MAP: Record<string, string> = {
            xingshi: '02',
            minshi: '03',
            xingzheng: '04',
            peichang: '05',
            zhixing: '10',
        };

        try {
            await this.openAdvancedSearch();

            const dropdownTrigger = await this.page.$('#s8');
            if (dropdownTrigger) {
                console.error('[DEBUG] applyCaseTypeFilter: 点击案件类型下拉框 #s8');
                await dropdownTrigger.click();
                await this.page.waitForTimeout(500);
            } else {
                console.error('[DEBUG] applyCaseTypeFilter: 未找到案件类型下拉框 #s8');
                return;
            }

            const targetVal = CASE_TYPE_MAP[caseType] || caseType;
            const selector = `#gjjs_ajlx li[data-val="${targetVal}"]`;
            try {
                await this.page.waitForSelector(selector, { state: 'visible', timeout: 2000 });
                const option = await this.page.$(selector);

                if (option) {
                    console.error(`[DEBUG] applyCaseTypeFilter: 点击选项 val=${targetVal}`);
                    await option.click();
                    await this.page.waitForTimeout(300);
                } else {
                    console.error(`[DEBUG] applyCaseTypeFilter: 未找到案件类型选项 "${caseType}" (val=${targetVal})`);
                }
            } catch (error) {
                console.error(`[DEBUG] applyCaseTypeFilter: 等待选项超时或失败 - ${error}`);
            }
        } catch (error) {
            console.error(`[DEBUG] applyCaseTypeFilter: 筛选出错 - ${error}`);
        }
    }

    /**
     * 应用法院级别筛选
     */
    private async applyCourtLevelFilter(courtLevel: CourtLevel): Promise<void> {
        const COURT_LEVEL_MAP: Record<string, string> = {
            zuigao: '1',
            gaoji: '2',
            zhongji: '3',
            jiceng: '4',
        };

        try {
            await this.openAdvancedSearch();

            const dropdownTrigger = await this.page.$('#s4');
            if (dropdownTrigger) {
                console.error('[DEBUG] applyCourtLevelFilter: 点击法院层级下拉框 #s4');
                await dropdownTrigger.click();
                await this.page.waitForTimeout(500);
            } else {
                console.error('[DEBUG] applyCourtLevelFilter: 未找到法院层级下拉框 #s4');
                return;
            }

            const targetVal = COURT_LEVEL_MAP[courtLevel] || courtLevel;
            const selector = `#gjjs_fycj li[data-val="${targetVal}"]`;
            try {
                await this.page.waitForSelector(selector, { state: 'visible', timeout: 2000 });
                const option = await this.page.$(selector);

                if (option) {
                    console.error(`[DEBUG] applyCourtLevelFilter: 点击选项 val=${targetVal}`);
                    await option.click();
                    await this.page.waitForTimeout(300);
                } else {
                    console.error(`[DEBUG] applyCourtLevelFilter: 未找到法院层级选项 "${courtLevel}" (val=${targetVal})`);
                }
            } catch (error) {
                console.error(`[DEBUG] applyCourtLevelFilter: 等待选项超时或失败 - ${error}`);
            }
        } catch (error) {
            console.error(`[DEBUG] applyCourtLevelFilter: 筛选出错 - ${error}`);
        }
    }

    /**
     * 打开高级检索面板
     */
    private async openAdvancedSearch(): Promise<void> {
        try {
            const s2Input = await this.page.$('#s2');
            if (s2Input && await s2Input.isVisible()) {
                console.error('[DEBUG] openAdvancedSearch: 高级检索面板已展开');
                return;
            }

            const advancedBtn = this.page.locator('.advenced-search').first();

            if (await advancedBtn.count() > 0 && await advancedBtn.isVisible()) {
                console.error('[DEBUG] openAdvancedSearch: 点击高级检索按钮');
                await advancedBtn.click();
                await this.page.waitForTimeout(1000);
            } else {
                console.error('[DEBUG] openAdvancedSearch: 未找到高级检索按钮 (.advenced-search)');
            }
        } catch (error) {
            console.error(`[DEBUG] openAdvancedSearch: 打开面板失败 - ${error}`);
        }
    }

    /**
     * 输入法院名称 (高级检索)
     */
    private async inputCourtName(courtName: string): Promise<void> {
        const selector = '#s2';
        try {
            await this.page.waitForSelector(selector, { state: 'visible', timeout: 3000 });
            await this.page.fill(selector, courtName);
            await this.page.keyboard.press('Tab');
        } catch {
            console.error(`[DEBUG] inputCourtName: 无法找到法院输入框 ${selector}`);
            const inputs = await this.page.$$('input[type="text"]');
            for (const input of inputs) {
                const placeholder = await input.getAttribute('placeholder');
                if (placeholder && placeholder.includes('法院')) {
                    await input.fill(courtName);
                    break;
                }
            }
        }
    }

    /**
     * 应用省份筛选 (后置筛选)
     */
    private async applyProvinceFilter(province: string): Promise<void> {
        console.error(`[DEBUG] applyProvinceFilter: 尝试筛选省份 "${province}"`);
        try {
            const provinceNode = this.page.locator('.jstree-anchor').filter({ hasText: new RegExp(`^${province}$`) }).first();

            if (await provinceNode.count() > 0) {
                await provinceNode.scrollIntoViewIfNeeded();
                await provinceNode.click();
                await this.waitForFilterTag(`法院省份：${province}`);
                return;
            }

            const roughNode = this.page.locator(`.jstree-anchor:has-text("${province}")`).first();
            if (await roughNode.count() > 0) {
                await roughNode.scrollIntoViewIfNeeded();
                await roughNode.click();
                await this.waitForFilterTag(`法院省份：${province}`);
                return;
            }

            console.error(`[DEBUG] applyProvinceFilter: 未找到省份节点 "${province}"`);
        } catch (error) {
            console.error(`[DEBUG] applyProvinceFilter: 筛选出错 - ${error}`);
        }
    }

    /**
     * 应用裁判年份筛选 (后置筛选)
     */
    private async applyJudgmentYearFilter(year: string): Promise<void> {
        console.error(`[DEBUG] applyJudgmentYearFilter: 尝试筛选年份 "${year}"`);
        try {
            const yearNode = this.page.locator('.jstree-anchor').filter({ hasText: new RegExp(`^${year}\(`) }).first();

            if (await yearNode.count() > 0) {
                console.error('[DEBUG] applyJudgmentYearFilter: 找到年份节点，点击中...');
                await yearNode.scrollIntoViewIfNeeded();
                await yearNode.click();
                await this.waitForFilterTag(`裁判年份：${year}`);
                return;
            }

            const exactNode = this.page.locator(`.jstree-anchor:has-text("${year}")`).first();
            if (await exactNode.count() > 0) {
                console.error('[DEBUG] applyJudgmentYearFilter: 使用备选选择器找到年份节点');
                await exactNode.scrollIntoViewIfNeeded();
                await exactNode.click();
                await this.waitForFilterTag(`裁判年份：${year}`);
                return;
            }

            console.error(`[DEBUG] applyJudgmentYearFilter: 未找到年份节点 "${year}"`);
        } catch (error) {
            console.error(`[DEBUG] applyJudgmentYearFilter: 筛选出错 - ${error}`);
        }
    }

    /**
     * 应用日期范围筛选 (前置筛选)
     */
    private async applyDateRangeFilter(startDate?: string, endDate?: string): Promise<void> {
        if (!startDate && !endDate) {
            return;
        }

        console.error(`[DEBUG] applyDateRangeFilter: 应用日期范围 ${startDate || ''} ~ ${endDate || ''}`);

        try {
            const wrapper = this.page.locator('.advencedWrapper');
            if (await wrapper.count() > 0) {
                await wrapper.evaluate((el) => {
                    (el as { style: { display: string } }).style.display = 'block';
                });
            }
            await this.page.waitForTimeout(500);

            if (startDate) {
                const startInput = this.page.locator('#cprqStart');
                if (await startInput.count() > 0) {
                    await startInput.fill(startDate);
                    console.error(`[DEBUG] applyDateRangeFilter: 已设置开始日期 ${startDate}`);
                }
            }

            if (endDate) {
                const endInput = this.page.locator('#cprqEnd');
                if (await endInput.count() > 0) {
                    await endInput.fill(endDate);
                    console.error(`[DEBUG] applyDateRangeFilter: 已设置结束日期 ${endDate}`);
                }
            }
        } catch (error) {
            console.error(`[DEBUG] applyDateRangeFilter: 设置日期范围出错 - ${error}`);
        }
    }

    /**
     * 等待筛选标签出现
     */
    private async waitForFilterTag(tagText: string): Promise<void> {
        console.error(`[DEBUG] waitForFilterTag: 等待筛选标签 "${tagText}"`);
        try {
            await this.page.waitForSelector(`:text("${tagText}")`, {
                timeout: 8000,
                state: 'visible',
            });
            console.error(`[DEBUG] waitForFilterTag: 筛选标签 "${tagText}" 已出现`);
            await this.page.waitForTimeout(500);
        } catch (error) {
            console.error(`[DEBUG] waitForFilterTag: 等待筛选标签超时 - ${error}`);
        }
    }

    /**
     * 等待搜索结果加载
     */
    private async waitForSearchResults(): Promise<void> {
        await this.page.waitForLoadState('domcontentloaded', { timeout: this.config.loadTimeout });
        console.error('[DEBUG] waitForSearchResults: domcontentloaded 完成');

        await this.page.waitForLoadState('networkidle', { timeout: this.config.loadTimeout }).catch(() => { });
        console.error('[DEBUG] waitForSearchResults: networkidle 完成');

        const currentUrl = this.page.url();
        console.error(`[DEBUG] waitForSearchResults: 当前URL = ${currentUrl}`);

        if (this.isLoginPageUrl(currentUrl)) {
            throw new AuthRequiredError('搜索需要登录，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        try {
            console.error(`[DEBUG] waitForSearchResults: 等待选择器 "${PAGE_SELECTORS.resultList}"`);
            await this.page.waitForSelector(PAGE_SELECTORS.resultList, {
                timeout: this.config.elementTimeout,
            });
            console.error('[DEBUG] waitForSearchResults: 找到结果容器');
        } catch (error) {
            console.error(`[DEBUG] waitForSearchResults: 等待结果容器失败 - ${error}`);
            try {
                await this.page.waitForSelector(':text("共检索到")', {
                    timeout: 3000,
                });
                console.error('[DEBUG] waitForSearchResults: 找到总数文本');
            } catch {
                console.error('[DEBUG] waitForSearchResults: 未找到总数文本');
            }
        }
    }

    /**
     * 解析搜索结果
     */
    private async parseSearchResults() {
        return parseSearchResultsFromPage(this.page);
    }

    /**
     * 获取搜索结果总数
     */
    private async getTotalCount(): Promise<number> {
        try {
            const pageContent = await this.page.content();
            const match = pageContent.match(/共检索到\s*(\d+)/);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }

            const totalLocator = this.page.locator(':text("共检索到")');
            const count = await totalLocator.count();
            if (count > 0) {
                const text = await totalLocator.first().textContent();
                const numMatch = text?.match(/\d+/);
                if (numMatch) {
                    return parseInt(numMatch[0], 10);
                }
            }
        } catch {
            // 获取总数失败
        }

        const items = await this.page.$$(PAGE_SELECTORS.resultList);
        return items.length;
    }

    /**
     * 翻页操作
     */
    async goToPage(pageNumber: number): Promise<void> {
        if (pageNumber < 1) {
            throw new Error('页码必须大于0');
        }

        const pageSelector = `${PAGE_SELECTORS.pageNumber}:has-text("${pageNumber}"), [data-page="${pageNumber}"]`;
        const pageButton = await this.page.$(pageSelector);

        if (pageButton) {
            await pageButton.click();
            await this.waitForSearchResults();
            return;
        }

        const currentPage = await this.getCurrentPage();
        const pagesToGo = pageNumber - currentPage;

        if (pagesToGo > 0) {
            for (let i = 0; i < pagesToGo; i++) {
                await this.nextPage();
            }
        } else if (pagesToGo < 0) {
            for (let i = 0; i < Math.abs(pagesToGo); i++) {
                await this.prevPage();
            }
        }
    }

    /**
     * 获取当前页码
     */
    private async getCurrentPage(): Promise<number> {
        try {
            const activePageElement = await this.page.$('.page-active, .current, [aria-current="page"]');
            if (activePageElement) {
                const text = await activePageElement.textContent();
                const match = text?.match(/\d+/);
                if (match) {
                    return parseInt(match[0], 10);
                }
            }
        } catch {
            // 获取当前页码失败
        }
        return 1;
    }

    /**
     * 下一页
     */
    async nextPage(): Promise<boolean> {
        const nextButton = await this.page.$(PAGE_SELECTORS.nextPage);
        if (nextButton && await nextButton.isEnabled()) {
            await nextButton.click();
            await this.waitForSearchResults();
            return true;
        }
        return false;
    }

    /**
     * 上一页
     */
    async prevPage(): Promise<boolean> {
        const prevButton = await this.page.$(PAGE_SELECTORS.prevPage);
        if (prevButton && await prevButton.isEnabled()) {
            await prevButton.click();
            await this.waitForSearchResults();
            return true;
        }
        return false;
    }

    /**
     * 验证 docId 格式
     */
    private validateDocId(docId: string): void {
        if (!docId || docId.trim() === '') {
            throw new NotFoundError('docId 不能为空，请提供有效的文书ID');
        }

        if (docId.startsWith('temp_')) {
            throw new NotFoundError(
                '无效的临时 docId，请使用 search_documents 获取有效的文书ID。\n'
                + '提示：临时ID表示搜索结果解析时未能获取到真实的文书ID',
            );
        }

        if (docId.length < 50) {
            console.error(`[WARN] validateDocId: docId 长度异常短 (${docId.length} 字符)，可能无效`);
            console.error('[WARN] validateDocId: 有效的 docId 通常是 Base64 编码的长字符串（80-120字符）');
        }
    }

    /**
     * 获取文书详情
     */
    async getDocumentDetail(docId: string): Promise<DocumentDetail> {
        console.error('[DEBUG] getDocumentDetail: 开始获取文书详情');
        console.error(`[DEBUG] getDocumentDetail: docId = ${docId.substring(0, 50)}...（长度: ${docId.length}）`);

        this.validateDocId(docId);
        await this.ensurePageValid();

        const detailUrl = `${this.config.baseUrl}/website/wenshu/181107ANFZ0BXSK4/index.html?docId=${encodeURIComponent(docId)}`;
        console.error(`[DEBUG] getDocumentDetail: 访问URL = ${detailUrl}`);

        try {
            await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('Target page')
                || errorMessage.includes('closed')
                || errorMessage.includes('target closed')
                || errorMessage.includes('browser has been closed')) {
                throw new ServiceUnavailableError(
                    '浏览器页面已失效，请稍后重试获取文书详情操作。'
                    + '提示：如果刚刚执行了登录操作，请等待几秒后再尝试。',
                );
            }
            throw error;
        }
        await this.waitForPageLoad();

        const currentUrl = this.page.url();
        const pageTitle = await this.page.title();
        console.error('[DEBUG] getDocumentDetail: 页面加载完成');
        console.error(`[DEBUG] getDocumentDetail: 当前URL = ${currentUrl}`);
        console.error(`[DEBUG] getDocumentDetail: 页面标题 = ${pageTitle}`);

        if (this.isLoginPageUrl(currentUrl)) {
            console.error('[DEBUG] getDocumentDetail: 检测到登录页重定向');
            throw new AuthRequiredError('获取文书详情需要登录，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        const loginRequired = await this.checkLoginRequired();
        console.error(`[DEBUG] getDocumentDetail: 登录检测结果 = ${loginRequired}`);
        if (loginRequired) {
            throw new AuthRequiredError('需要登录才能查看文书详情');
        }

        console.error(`[DEBUG] getDocumentDetail: 等待文书内容选择器 = ${PAGE_SELECTORS.documentContent}`);
        try {
            await this.page.waitForSelector(PAGE_SELECTORS.documentContent, {
                timeout: this.config.elementTimeout,
            });
            console.error('[DEBUG] getDocumentDetail: 文书内容选择器找到');
        } catch {
            console.error('[DEBUG] getDocumentDetail: 文书内容选择器未找到，打印页面诊断信息');
            try {
                const bodyText = await this.page.$eval('body', (el) => el.innerText.substring(0, 500));
                console.error(`[DEBUG] getDocumentDetail: 页面body内容（前500字符）= ${bodyText}`);
            } catch (error) {
                console.error(`[DEBUG] getDocumentDetail: 无法获取页面body内容: ${error}`);
            }
            throw new NotFoundError(`未找到文书: ${docId}，请检查文书ID是否正确`);
        }

        return parseDocumentDetailFromPage(this.page, docId);
    }

    /**
     * 获取页面截图
     * 用于调试和二维码获取
     */
    async takeScreenshot(): Promise<Uint8Array> {
        return this.page.screenshot({ type: 'png' });
    }

    /**
     * 获取当前页面URL
     */
    getCurrentUrl(): string {
        return this.page.url();
    }

    /**
     * 等待指定时间
     */
    async wait(ms: number): Promise<void> {
        await this.page.waitForTimeout(ms);
    }
}

/**
 * 创建页面操作器实例
 */
export function createPageOperator(page: Page, config?: OperatorConfig): PageOperator {
    return new PageOperator(page, config);
}
