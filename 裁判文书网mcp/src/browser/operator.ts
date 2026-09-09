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
import { debugLog } from '../utils/debug.js';
import { sanitizeErrorMessage } from '../utils/sanitize.js';

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
     * 判断当前页面是否展示已登录用户信息
     */
    private async hasLoggedInUserInfo(): Promise<boolean> {
        return this.page.locator(PAGE_SELECTORS.loginUserInfo).first().isVisible().catch(() => false);
    }

    /**
     * 判断当前页面是否已经呈现搜索页特征，避免误判为登录页
     */
    private async detectSearchSurface(): Promise<{
        hasSearchInput: boolean;
        hasSearchButton: boolean;
        hasResultList: boolean;
        hasPagination: boolean;
        hasTotalCount: boolean;
        hasAdvancedSearch: boolean;
        hasFilterTree: boolean;
    }> {
        const hasSearchInput = await this.page.getByPlaceholder(PAGE_SELECTORS.searchInputPlaceholder).first().isVisible().catch(() => false)
            || await this.page.locator(PAGE_SELECTORS.searchInputFallback).first().isVisible().catch(() => false)
            || await this.page.locator(PAGE_SELECTORS.searchInputGeneric).first().isVisible().catch(() => false);

        const hasSearchButton = await this.page.locator('#searchBtn').first().isVisible().catch(() => false)
            || await this.page.locator(PAGE_SELECTORS.searchButtonFallback).first().isVisible().catch(() => false);

        const hasResultList = await this.page.locator(PAGE_SELECTORS.resultList).first().isVisible().catch(() => false);
        const hasPagination = await this.page.locator(PAGE_SELECTORS.pagination).first().isVisible().catch(() => false);
        const hasTotalCount = await this.page.locator(PAGE_SELECTORS.totalCount).first().isVisible().catch(() => false);
        const hasAdvancedSearch = await this.page.locator('.advenced-search, .advencedWrapper, #s2, #searchBtn').first().isVisible().catch(() => false);
        const hasFilterTree = await this.page.locator('.jstree-anchor').first().isVisible().catch(() => false);

        return {
            hasSearchInput,
            hasSearchButton,
            hasResultList,
            hasPagination,
            hasTotalCount,
            hasAdvancedSearch,
            hasFilterTree,
        };
    }

    /**
     * 判断当前页面是否存在明显的登录入口或二维码
     */
    private async detectLoginSurface(): Promise<{
        hasVisibleLoginContainer: boolean;
        hasVisibleQRCode: boolean;
        hasVisibleLoginButton: boolean;
        hasVisibleAlipayEntry: boolean;
    }> {
        const hasVisibleLoginContainer = await this.page.locator(PAGE_SELECTORS.loginContainer).first().isVisible().catch(() => false);
        const hasVisibleQRCode = await this.page.locator(PAGE_SELECTORS.loginQRCode).first().isVisible().catch(() => false);
        const hasVisibleLoginButton = await this.page.locator(PAGE_SELECTORS.loginButton).first().isVisible().catch(() => false);
        const hasVisibleAlipayEntry = await this.page.locator(PAGE_SELECTORS.loginAlipayEntry).first().isVisible().catch(() => false);

        return {
            hasVisibleLoginContainer,
            hasVisibleQRCode,
            hasVisibleLoginButton,
            hasVisibleAlipayEntry,
        };
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

            const hasVisibleUserInfo = await this.hasLoggedInUserInfo();
            if (hasVisibleUserInfo) {
                return false;
            }

            const searchSurface = await this.detectSearchSurface();
            const hasSearchPageSurface = Object.values(searchSurface).some(Boolean);

            const {
                hasVisibleLoginContainer,
                hasVisibleQRCode,
                hasVisibleLoginButton,
                hasVisibleAlipayEntry,
            } = await this.detectLoginSurface();

            debugLog(
                `[DEBUG] checkLoginRequired: searchSurface input=${searchSurface.hasSearchInput}, button=${searchSurface.hasSearchButton}, result=${searchSurface.hasResultList}, pagination=${searchSurface.hasPagination}, total=${searchSurface.hasTotalCount}, advanced=${searchSurface.hasAdvancedSearch}, tree=${searchSurface.hasFilterTree}`,
            );
            debugLog(
                `[DEBUG] checkLoginRequired: loginSurface container=${hasVisibleLoginContainer}, qrcode=${hasVisibleQRCode}, button=${hasVisibleLoginButton}, alipay=${hasVisibleAlipayEntry}`,
            );

            if (hasVisibleQRCode) {
                return true;
            }

            if (hasSearchPageSurface) {
                return false;
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

        debugLog(`[DEBUG] searchDocuments: 开始搜索 keyword="${keyword}", page=${page}, pageSize=${pageSize}`);
        debugLog('[DEBUG] searchDocuments: 检查页面有效性');
        await this.ensurePageValid();

        debugLog(`[DEBUG] searchDocuments: 导航到 ${this.config.searchUrl}`);
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
        debugLog('[DEBUG] searchDocuments: 页面加载完成');

        if (await this.checkLoginRequired()) {
            debugLog('[DEBUG] searchDocuments: 需要登录');
            throw new AuthRequiredError('需要登录才能搜索文书');
        }
        debugLog('[DEBUG] searchDocuments: 已登录，继续搜索');

        debugLog('[DEBUG] searchDocuments: 输入关键词');
        await this.inputSearchKeyword(keyword);
        await this.page.keyboard.press('Escape');

        if (filters?.courtName) {
            debugLog('[DEBUG] searchDocuments: 打开高级检索面板');
            await this.openAdvancedSearch();

            debugLog(`[DEBUG] searchDocuments: 输入法院名称 "${filters.courtName}"`);
            await this.inputCourtName(filters.courtName);
        }

        if (filters) {
            debugLog('[DEBUG] searchDocuments: 应用筛选条件');
            await this.applyFilters(filters);
        }

        if (filters?.startDate || filters?.endDate) {
            debugLog('[DEBUG] searchDocuments: 应用日期范围筛选（高级检索）');
            await this.applyDateRangeFilter(filters.startDate, filters.endDate);
        }

        debugLog('[DEBUG] searchDocuments: 点击搜索按钮');
        await this.clickSearchButton();

        debugLog('[DEBUG] searchDocuments: 等待搜索结果');
        await this.waitForSearchResults();

        if (filters?.province) {
            debugLog(`[DEBUG] searchDocuments: 应用省份筛选 "${filters.province}"`);
            await this.applyProvinceFilter(filters.province);
            debugLog('[DEBUG] searchDocuments: 等待省份筛选结果刷新');
            await this.waitForSearchResults();
        }

        if (filters?.judgmentYear && !filters?.startDate && !filters?.endDate) {
            debugLog(`[DEBUG] searchDocuments: 应用裁判年份筛选 "${filters.judgmentYear}"`);
            await this.applyJudgmentYearFilter(filters.judgmentYear);
            debugLog('[DEBUG] searchDocuments: 等待年份筛选结果刷新');
            await this.waitForSearchResults();
        }

        const effectivePageSize = await this.applyPageSize(pageSize);

        if (page > 1) {
            debugLog(`[DEBUG] searchDocuments: 翻到第 ${page} 页`);
            await this.goToPage(page);
        }

        debugLog('[DEBUG] searchDocuments: 解析搜索结果');
        const documents = await this.parseSearchResults();
        const total = await this.getTotalCount();

        const limitedDocuments = documents.length > effectivePageSize
            ? documents.slice(0, effectivePageSize)
            : documents;
        debugLog(`[DEBUG] searchDocuments: 完成！total=${total}, documents.length=${limitedDocuments.length}, pageSize=${effectivePageSize}`);

        return {
            total,
            page,
            pageSize: effectivePageSize,
            documents: limitedDocuments,
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

    private failFilter(filterName: string, reason: string): never {
        throw new ServiceUnavailableError(`筛选条件"${filterName}"未能生效: ${reason}`);
    }

    private failFilterFromError(filterName: string, action: string, error: unknown): never {
        const detail = error instanceof Error ? error.message : String(error);
        this.failFilter(filterName, `${action}失败: ${sanitizeErrorMessage(detail)}`);
    }

    private async verifyAdvancedDropdownSelection(
        inputSelector: string,
        optionSelector: string,
        targetVal: string,
        filterName: string,
    ): Promise<void> {
        const input = await this.page.$(inputSelector);
        if (!input) {
            this.failFilter(filterName, `未找到选择框 ${inputSelector}`);
        }

        const value = await input.inputValue().catch(() => '');
        const text = (await input.textContent())?.trim() ?? '';
        const title = await input.getAttribute('title') ?? '';
        const combined = `${value}|${text}|${title}`;

        if (combined.includes(targetVal)) {
            return;
        }

        const option = this.page.locator(optionSelector).first();
        if (await option.count() === 0) {
            this.failFilter(filterName, `选项 val=${targetVal} 未能选中`);
        }

        const className = await option.getAttribute('class') ?? '';
        const optionSelected = /(?:^|\s)(?:selected|active|cur)(?:\s|$)/i.test(className);
        if (!optionSelected) {
            this.failFilter(filterName, `选项 val=${targetVal} 未能选中`);
        }
    }

    private async verifyDateInput(selector: string, expected: string, filterName: string): Promise<void> {
        const actual = await this.page.locator(selector).inputValue();
        if (actual !== expected) {
            this.failFilter(
                filterName,
                `日期输入框 ${selector} 回读值 "${actual}" 与期望 "${expected}" 不符`,
            );
        }
    }

    private resolvePageSize(requested: number): number {
        const supported = [5, 10, 15, 20, 50, 100];
        if (supported.includes(requested)) {
            return requested;
        }
        return supported.reduce((closest, size) =>
            Math.abs(size - requested) < Math.abs(closest - requested) ? size : closest,
        );
    }

    private async getCurrentPageSize(): Promise<number | null> {
        try {
            const selectors = PAGE_SELECTORS.pageSize.split(',').map((s) => s.trim());
            for (const selector of selectors) {
                const element = await this.page.$(selector);
                if (!element) {
                    continue;
                }

                const dataPageSize = await element.getAttribute('data-pagesize');
                if (dataPageSize) {
                    const parsed = parseInt(dataPageSize, 10);
                    if (!Number.isNaN(parsed)) {
                        return parsed;
                    }
                }

                const text = await element.textContent();
                const match = text?.match(/(\d+)/);
                if (match?.[1]) {
                    return parseInt(match[1], 10);
                }
            }

            const select = await this.page.$(PAGE_SELECTORS.pageSizeSelect);
            if (select) {
                const value = await select.inputValue();
                const parsed = parseInt(value, 10);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            }
        } catch {
            // 读取失败时返回 null
        }
        return null;
    }

    private async trySetPageSizeOnSite(targetSize: number): Promise<boolean> {
        try {
            const select = await this.page.$(PAGE_SELECTORS.pageSizeSelect);
            if (select) {
                await select.selectOption(String(targetSize)).catch(async () => {
                    await select.selectOption({ label: String(targetSize) });
                });
                await this.waitForSearchResults();
                return true;
            }

            const trigger = await this.page.$(PAGE_SELECTORS.pageSize);
            if (trigger) {
                await trigger.click();
                await this.page.waitForTimeout(300);

                const optionSelectors = [
                    `[data-pagesize="${targetSize}"]`,
                    `option[value="${targetSize}"]`,
                    `li:has-text("${targetSize}")`,
                    `a:has-text("${targetSize}")`,
                ];

                for (const selector of optionSelectors) {
                    const option = await this.page.$(selector);
                    if (option && await option.isVisible()) {
                        await option.click();
                        await this.waitForSearchResults();
                        return true;
                    }
                }
            }

            const directOption = await this.page.$(`[data-pagesize="${targetSize}"]`);
            if (directOption) {
                await directOption.click();
                await this.waitForSearchResults();
                return true;
            }
        } catch (error) {
            debugLog(`[DEBUG] trySetPageSizeOnSite: 设置失败 ${error}`);
        }

        return false;
    }

    private async applyPageSize(requestedSize: number): Promise<number> {
        const targetSize = this.resolvePageSize(requestedSize);
        const currentSize = await this.getCurrentPageSize();

        if (currentSize === targetSize) {
            debugLog(`[DEBUG] applyPageSize: 当前每页条数已是 ${targetSize}`);
            return targetSize;
        }

        const setSuccessfully = await this.trySetPageSizeOnSite(targetSize);
        if (setSuccessfully) {
            const verifiedSize = await this.getCurrentPageSize();
            if (verifiedSize === targetSize) {
                debugLog(`[DEBUG] applyPageSize: 已设置每页条数为 ${targetSize}`);
                return targetSize;
            }
        }

        if (requestedSize <= 20) {
            debugLog(`[DEBUG] applyPageSize: 网站分页控件不可用，降级为 slice(${requestedSize})`);
            return requestedSize;
        }

        throw new ServiceUnavailableError(`无法设置每页数量为 ${targetSize}，请尝试更小的 pageSize`);
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

        await this.openAdvancedSearch('案件类型');

        const dropdownTrigger = await this.page.$('#s8');
        if (!dropdownTrigger) {
            this.failFilter('案件类型', '未找到案件类型下拉框 #s8');
        }

        debugLog('[DEBUG] applyCaseTypeFilter: 点击案件类型下拉框 #s8');
        try {
            await dropdownTrigger.click();
        } catch (error) {
            this.failFilterFromError('案件类型', '点击下拉框', error);
        }
        await this.page.waitForTimeout(500);

        const targetVal = CASE_TYPE_MAP[caseType] || caseType;
        const selector = `#gjjs_ajlx li[data-val="${targetVal}"]`;

        try {
            await this.page.waitForSelector(selector, { state: 'visible', timeout: 2000 });
        } catch {
            this.failFilter('案件类型', `未找到选项 "${caseType}" (val=${targetVal})`);
        }

        const option = await this.page.$(selector);
        if (!option) {
            this.failFilter('案件类型', `未找到选项 "${caseType}" (val=${targetVal})`);
        }

        debugLog(`[DEBUG] applyCaseTypeFilter: 点击选项 val=${targetVal}`);
        try {
            await option.click();
        } catch (error) {
            this.failFilterFromError('案件类型', '点击选项', error);
        }
        await this.page.waitForTimeout(300);
        await this.verifyAdvancedDropdownSelection('#s8', selector, targetVal, '案件类型');
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

        await this.openAdvancedSearch('法院级别');

        const dropdownTrigger = await this.page.$('#s4');
        if (!dropdownTrigger) {
            this.failFilter('法院级别', '未找到法院层级下拉框 #s4');
        }

        debugLog('[DEBUG] applyCourtLevelFilter: 点击法院层级下拉框 #s4');
        try {
            await dropdownTrigger.click();
        } catch (error) {
            this.failFilterFromError('法院级别', '点击下拉框', error);
        }
        await this.page.waitForTimeout(500);

        const targetVal = COURT_LEVEL_MAP[courtLevel] || courtLevel;
        const selector = `#gjjs_fycj li[data-val="${targetVal}"]`;

        try {
            await this.page.waitForSelector(selector, { state: 'visible', timeout: 2000 });
        } catch {
            this.failFilter('法院级别', `未找到选项 "${courtLevel}" (val=${targetVal})`);
        }

        const option = await this.page.$(selector);
        if (!option) {
            this.failFilter('法院级别', `未找到选项 "${courtLevel}" (val=${targetVal})`);
        }

        debugLog(`[DEBUG] applyCourtLevelFilter: 点击选项 val=${targetVal}`);
        try {
            await option.click();
        } catch (error) {
            this.failFilterFromError('法院级别', '点击选项', error);
        }
        await this.page.waitForTimeout(300);
        await this.verifyAdvancedDropdownSelection('#s4', selector, targetVal, '法院级别');
    }

    /**
     * 打开高级检索面板
     */
    private async openAdvancedSearch(filterName = '高级检索'): Promise<void> {
        const s2Input = await this.page.$('#s2');
        if (s2Input && await s2Input.isVisible()) {
            debugLog('[DEBUG] openAdvancedSearch: 高级检索面板已展开');
            return;
        }

        const advancedBtn = this.page.locator('.advenced-search').first();
        if (await advancedBtn.count() > 0 && await advancedBtn.isVisible()) {
            debugLog('[DEBUG] openAdvancedSearch: 点击高级检索按钮');
            try {
                await advancedBtn.click();
            } catch (error) {
                this.failFilterFromError(filterName, '点击高级检索按钮', error);
            }
            await this.page.waitForTimeout(1000);
            return;
        }

        this.failFilter(filterName, '未找到高级检索按钮 (.advenced-search)');
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
            return;
        } catch {
            debugLog(`[DEBUG] inputCourtName: 无法找到法院输入框 ${selector}`);
        }

        const inputs = await this.page.$$('input[type="text"]');
        for (const input of inputs) {
            const placeholder = await input.getAttribute('placeholder');
            if (placeholder && placeholder.includes('法院')) {
                await input.fill(courtName);
                return;
            }
        }

        this.failFilter('审理法院', `无法找到法院输入框以填写 "${courtName}"`);
    }

    /**
     * 应用省份筛选 (后置筛选)
     */
    private async applyProvinceFilter(province: string): Promise<void> {
        debugLog(`[DEBUG] applyProvinceFilter: 尝试筛选省份 "${province}"`);

        const provinceNode = this.page.locator('.jstree-anchor').filter({ hasText: new RegExp(`^${province}$`) }).first();
        if (await provinceNode.count() > 0) {
            try {
                await provinceNode.scrollIntoViewIfNeeded();
                await provinceNode.click();
            } catch (error) {
                this.failFilterFromError('法院省份', '点击省份节点', error);
            }
            await this.waitForFilterTag(`法院省份：${province}`, '法院省份');
            return;
        }

        const roughNode = this.page.locator(`.jstree-anchor:has-text("${province}")`).first();
        if (await roughNode.count() > 0) {
            try {
                await roughNode.scrollIntoViewIfNeeded();
                await roughNode.click();
            } catch (error) {
                this.failFilterFromError('法院省份', '点击省份节点', error);
            }
            await this.waitForFilterTag(`法院省份：${province}`, '法院省份');
            return;
        }

        this.failFilter('法院省份', `未找到省份节点 "${province}"`);
    }

    /**
     * 应用裁判年份筛选 (后置筛选)
     */
    private async applyJudgmentYearFilter(year: string): Promise<void> {
        debugLog(`[DEBUG] applyJudgmentYearFilter: 尝试筛选年份 "${year}"`);

        const yearNode = this.page.locator('.jstree-anchor').filter({ hasText: new RegExp(`^${year}\(`) }).first();
        if (await yearNode.count() > 0) {
            debugLog('[DEBUG] applyJudgmentYearFilter: 找到年份节点，点击中...');
            try {
                await yearNode.scrollIntoViewIfNeeded();
                await yearNode.click();
            } catch (error) {
                this.failFilterFromError('裁判年份', '点击年份节点', error);
            }
            await this.waitForFilterTag(`裁判年份：${year}`, '裁判年份');
            return;
        }

        const exactNode = this.page.locator(`.jstree-anchor:has-text("${year}")`).first();
        if (await exactNode.count() > 0) {
            debugLog('[DEBUG] applyJudgmentYearFilter: 使用备选选择器找到年份节点');
            try {
                await exactNode.scrollIntoViewIfNeeded();
                await exactNode.click();
            } catch (error) {
                this.failFilterFromError('裁判年份', '点击年份节点', error);
            }
            await this.waitForFilterTag(`裁判年份：${year}`, '裁判年份');
            return;
        }

        this.failFilter('裁判年份', `未找到年份节点 "${year}"`);
    }

    /**
     * 应用日期范围筛选 (前置筛选)
     */
    private async applyDateRangeFilter(startDate?: string, endDate?: string): Promise<void> {
        if (!startDate && !endDate) {
            return;
        }

        debugLog(`[DEBUG] applyDateRangeFilter: 应用日期范围 ${startDate || ''} ~ ${endDate || ''}`);

        const wrapper = this.page.locator('.advencedWrapper');
        if (await wrapper.count() > 0) {
            await wrapper.evaluate((el) => {
                (el as { style: { display: string } }).style.display = 'block';
            });
        }
        await this.page.waitForTimeout(500);

        if (startDate) {
            const startInput = this.page.locator('#cprqStart');
            if (await startInput.count() === 0) {
                this.failFilter('裁判日期', `未找到开始日期输入框以设置 ${startDate}`);
            }
            try {
                await startInput.fill(startDate);
            } catch (error) {
                this.failFilterFromError('裁判日期', '设置开始日期', error);
            }
            await this.verifyDateInput('#cprqStart', startDate, '裁判日期');
            debugLog(`[DEBUG] applyDateRangeFilter: 已设置开始日期 ${startDate}`);
        }

        if (endDate) {
            const endInput = this.page.locator('#cprqEnd');
            if (await endInput.count() === 0) {
                this.failFilter('裁判日期', `未找到结束日期输入框以设置 ${endDate}`);
            }
            try {
                await endInput.fill(endDate);
            } catch (error) {
                this.failFilterFromError('裁判日期', '设置结束日期', error);
            }
            await this.verifyDateInput('#cprqEnd', endDate, '裁判日期');
            debugLog(`[DEBUG] applyDateRangeFilter: 已设置结束日期 ${endDate}`);
        }
    }

    /**
     * 等待筛选标签出现
     */
    private async waitForFilterTag(tagText: string, filterName: string): Promise<void> {
        debugLog(`[DEBUG] waitForFilterTag: 等待筛选标签 "${tagText}"`);
        try {
            await this.page.waitForSelector(`:text("${tagText}")`, {
                timeout: 8000,
                state: 'visible',
            });
            debugLog(`[DEBUG] waitForFilterTag: 筛选标签 "${tagText}" 已出现`);
            await this.page.waitForTimeout(500);
        } catch {
            this.failFilter(filterName, `筛选标签 "${tagText}" 未出现`);
        }
    }

    /**
     * 等待搜索结果加载
     */
    private async waitForSearchResults(): Promise<void> {
        await this.page.waitForLoadState('domcontentloaded', { timeout: this.config.loadTimeout });
        debugLog('[DEBUG] waitForSearchResults: domcontentloaded 完成');

        await this.page.waitForLoadState('networkidle', { timeout: this.config.loadTimeout }).catch(() => { });
        debugLog('[DEBUG] waitForSearchResults: networkidle 完成');

        const currentUrl = this.page.url();
        debugLog(`[DEBUG] waitForSearchResults: 当前URL = ${currentUrl}`);

        if (this.isLoginPageUrl(currentUrl) || await this.checkLoginRequired()) {
            throw new AuthRequiredError('搜索需要登录，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        try {
            debugLog(`[DEBUG] waitForSearchResults: 等待选择器 "${PAGE_SELECTORS.resultList}"`);
            await this.page.waitForSelector(PAGE_SELECTORS.resultList, {
                timeout: this.config.elementTimeout,
            });
            debugLog('[DEBUG] waitForSearchResults: 找到结果容器');
        } catch (error) {
            debugLog(`[DEBUG] waitForSearchResults: 等待结果容器失败 - ${error}`);
            try {
                await this.page.waitForSelector(':text("共检索到")', {
                    timeout: 3000,
                });
                debugLog('[DEBUG] waitForSearchResults: 找到总数文本');
            } catch {
                debugLog('[DEBUG] waitForSearchResults: 未找到总数文本');
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
            debugLog(`[WARN] validateDocId: docId 长度异常短 (${docId.length} 字符)，可能无效`);
            debugLog('[WARN] validateDocId: 有效的 docId 通常是 Base64 编码的长字符串（80-120字符）');
        }
    }

    /**
     * 获取文书详情
     */
    async getDocumentDetail(docId: string): Promise<DocumentDetail> {
        debugLog('[DEBUG] getDocumentDetail: 开始获取文书详情');
        debugLog(`[DEBUG] getDocumentDetail: docId 长度 = ${docId.length}`);

        this.validateDocId(docId);
        await this.ensurePageValid();

        const detailUrl = `${this.config.baseUrl}/website/wenshu/181107ANFZ0BXSK4/index.html?docId=${encodeURIComponent(docId)}`;
        debugLog('[DEBUG] getDocumentDetail: 正在访问文书详情页');

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
        debugLog('[DEBUG] getDocumentDetail: 页面加载完成');
        debugLog(`[DEBUG] getDocumentDetail: 当前URL = ${currentUrl}`);
        debugLog(`[DEBUG] getDocumentDetail: 页面标题 = ${pageTitle}`);

        if (this.isLoginPageUrl(currentUrl)) {
            debugLog('[DEBUG] getDocumentDetail: 检测到登录页重定向');
            throw new AuthRequiredError('获取文书详情需要登录，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        const hasVisibleUserInfo = await this.hasLoggedInUserInfo();
        debugLog(`[DEBUG] getDocumentDetail: 页面用户信息可见 = ${hasVisibleUserInfo}`);

        const {
            hasVisibleLoginContainer,
            hasVisibleQRCode,
            hasVisibleLoginButton,
            hasVisibleAlipayEntry,
        } = await this.detectLoginSurface();
        debugLog(
            `[DEBUG] getDocumentDetail: 登录表面特征 container=${hasVisibleLoginContainer}, qrcode=${hasVisibleQRCode}, button=${hasVisibleLoginButton}, alipay=${hasVisibleAlipayEntry}`,
        );

        if (!hasVisibleUserInfo && (hasVisibleQRCode || (hasVisibleLoginContainer && (hasVisibleLoginButton || hasVisibleAlipayEntry)))) {
            throw new AuthRequiredError('需要登录才能查看文书详情');
        }

        const hasVisibleDocumentContent = await this.waitForDocumentReady();
        if (!hasVisibleDocumentContent) {
            debugLog('[DEBUG] getDocumentDetail: 文书详情页未就绪，打印页面诊断信息');
            try {
                const bodyText = await this.page.$eval('body', (el) => el.innerText.substring(0, 500));
                debugLog(`[DEBUG] getDocumentDetail: 页面body内容（前500字符）= ${bodyText}`);
            } catch (error) {
                debugLog(`[DEBUG] getDocumentDetail: 无法获取页面body内容: ${error}`);
            }
            throw new NotFoundError(`未找到完整文书内容: ${docId}，请检查文书ID是否正确或当前登录态是否有效`);
        }

        return parseDocumentDetailFromPage(this.page, docId);
    }

    private async waitForDocumentReady(): Promise<boolean> {
        const readySelectors = Array.from(new Set([
            PAGE_SELECTORS.documentFullText,
            PAGE_SELECTORS.documentContent,
            PAGE_SELECTORS.documentCourt,
            PAGE_SELECTORS.documentCaseNo,
        ]));

        for (const selector of readySelectors) {
            try {
                debugLog(`[DEBUG] getDocumentDetail: 等待详情页选择器 = ${selector}`);
                await this.page.waitForSelector(selector, {
                    timeout: Math.min(this.config.elementTimeout, 5000),
                    state: 'visible',
                });

                const previewText = await this.page.locator(selector).first().innerText().catch(() => '');
                const normalizedPreview = previewText.replace(/\s+/g, ' ').trim();
                debugLog(`[DEBUG] getDocumentDetail: 详情页选择器命中，selector = ${selector}，preview = ${normalizedPreview.substring(0, 80)}`);

                if (normalizedPreview.length >= 20
                    || /判决书|裁定书|调解书|决定书|通知书|人民法院|案号|发布日期/.test(normalizedPreview)) {
                    return true;
                }
            } catch {
                // 继续尝试下一个选择器
            }
        }

        return false;
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
