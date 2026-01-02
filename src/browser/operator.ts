/**
 * 页面操作器模块
 * 实现搜索操作、翻页操作和文书详情获取
 * 需求: 1.1, 2.1, 2.2, 2.3, 3.1, 5.1
 */

import { Page } from 'playwright';
import {
    DocumentSummary,
    DocumentDetail,
    SearchResponse,
    CaseType,
    CourtLevel,
    PartyInfo,
} from '../models/index.js';
import {
    ServiceUnavailableError,
    NotFoundError,
    AuthRequiredError,
} from '../errors/index.js';

/**
 * 搜索筛选参数接口
 * 需求 2.1, 2.2, 2.3: 支持案件类型、法院级别和日期范围筛选
 */
export interface SearchFilters {
    /** 案件类型筛选 */
    caseType?: CaseType;
    /** 法院级别筛选 */
    courtLevel?: CourtLevel;
    /** 开始日期 (YYYY-MM-DD) */
    startDate?: string;
    /** 结束日期 (YYYY-MM-DD) */
    endDate?: string;
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
 * 默认配置
 */
const DEFAULT_CONFIG: Required<OperatorConfig> = {
    baseUrl: 'https://wenshu.court.gov.cn',
    searchUrl: 'https://wenshu.court.gov.cn/website/wenshu/181029CR4M5A62CH/index.html',
    loadTimeout: 30000,
    elementTimeout: 10000,
};

/**
 * 页面选择器常量
 * 根据裁判文书网实际页面结构定义（2026年1月实测）
 */
const SELECTORS = {
    // 搜索相关 - 基于实际页面快照分析
    // 页面搜索框 placeholder: "输入案由、关键词、法院、当事人、律师"
    searchInputPlaceholder: '输入案由、关键词、法院、当事人、律师',
    // 搜索按钮文本（是个div而非button）
    searchButtonText: '搜索',
    // 备选CSS选择器 - 基于实际页面结构
    searchInputFallback: 'input[placeholder*="案由"], input[placeholder*="关键词"]',
    // 通用搜索框选择器（最后备选）
    searchInputGeneric: '#suggestSource, input#searchInput',
    // 搜索按钮备选 - 裁判文书网的搜索按钮是div，不是button
    searchButtonFallback: 'div:text-is("搜索"), div.search-btn, .search-button',

    // 搜索结果 - 基于实际页面结构（2026年1月实测）
    // 每个结果项是一个包含 h4 标题的容器
    resultList: 'div:has(> h4 > a[href*="docId"])',
    resultTitle: 'h4 a',
    resultCaseNo: 'div:nth-child(2) > div:nth-child(2)',  // 案号在第二行第二个div
    resultCourt: 'div:nth-child(2) > div:first-child',   // 法院在第二行第一个div
    resultDate: 'div:nth-child(2) > div:nth-child(3)',    // 日期在第二行第三个div
    resultType: 'div:first-child > div:nth-child(2)',     // 类型标签

    // 分页 - 基于实际页面结构
    pagination: 'div:has(> a:text("下一页"))',
    pageNumber: 'a[href="javascript:;"]',
    nextPage: 'a:text("下一页")',
    prevPage: 'a:text("上一页")',
    totalCount: 'div:text-matches("共检索到.*篇文书")',

    // 筛选条件
    filterCaseType: '.case-type-filter, [data-filter="caseType"]',
    filterCourtLevel: '.court-level-filter, [data-filter="courtLevel"]',
    filterDateRange: '.date-range-filter, [data-filter="dateRange"]',

    // 文书详情
    documentContent: '.content, .ws-content, .document-content, #content',
    documentTitle: '.title, h1, .ws-title',
    documentCaseNo: '.case-no, .ah, .caseNo',
    documentCourt: '.court, .fy, .courtName',
    documentDate: '.date, .cprq, .judgeDate',
    documentParties: '.parties, .dsr, .party-info',
    documentJudges: '.judges, .spry, .judge-info',
    documentCause: '.cause, .ay, .case-cause',
    documentFullText: '.full-text, .ws-text, .document-body',

    // 登录检测
    loginRequired: '.login-tip, .need-login, [class*="login"]',
    loginButton: '.login-btn, button:has-text("登录")',
};

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
            baseUrl: config?.baseUrl ?? DEFAULT_CONFIG.baseUrl,
            searchUrl: config?.searchUrl ?? DEFAULT_CONFIG.searchUrl,
            loadTimeout: config?.loadTimeout ?? DEFAULT_CONFIG.loadTimeout,
            elementTimeout: config?.elementTimeout ?? DEFAULT_CONFIG.elementTimeout,
        };
    }

    /**
     * 检查是否需要登录
     */
    async checkLoginRequired(): Promise<boolean> {
        try {
            const loginTip = await this.page.$(SELECTORS.loginRequired);
            if (loginTip && await loginTip.isVisible()) {
                return true;
            }

            const loginButton = await this.page.$(SELECTORS.loginButton);
            if (loginButton && await loginButton.isVisible()) {
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

        // 导航到搜索页面
        await this.page.goto(this.config.searchUrl, { waitUntil: 'domcontentloaded' });
        await this.waitForPageLoad();

        // 检查是否需要登录
        if (await this.checkLoginRequired()) {
            throw new AuthRequiredError('需要登录才能搜索文书');
        }

        // 输入搜索关键词
        await this.inputSearchKeyword(keyword);

        // 应用筛选条件
        if (filters) {
            await this.applyFilters(filters);
        }

        // 点击搜索按钮
        await this.clickSearchButton();

        // 等待搜索结果加载
        await this.waitForSearchResults();

        // 如果不是第一页，翻到指定页
        if (page > 1) {
            await this.goToPage(page);
        }

        // 解析搜索结果
        const documents = await this.parseSearchResults();
        const total = await this.getTotalCount();

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
        // 策略1: 优先使用 getByPlaceholder 精确定位
        const searchInput = this.page.getByPlaceholder(SELECTORS.searchInputPlaceholder);
        
        try {
            await searchInput.waitFor({
                state: 'visible',
                timeout: 5000  // 缩短等待时间，快速降级
            });
            await searchInput.clear();
            await searchInput.fill(keyword);
            return;
        } catch {
            // 精确匹配失败，继续尝试备选方案
        }

        // 策略2: 尝试使用明确的CSS选择器
        const fallbackSelectors = [
            SELECTORS.searchInputFallback,
            SELECTORS.searchInputGeneric,
        ];

        for (const selector of fallbackSelectors) {
            const selectors = selector.split(',').map(s => s.trim());
            for (const sel of selectors) {
                try {
                    const element = await this.page.waitForSelector(sel, {
                        state: 'visible',
                        timeout: 2000
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

        // 策略3: 查找所有可见的text input，选择最合适的一个
        const allInputs = await this.page.$$('input[type="text"]:visible, input:not([type]):visible');
        for (const input of allInputs) {
            const isVisible = await input.isVisible();
            if (isVisible) {
                const placeholder = await input.getAttribute('placeholder');
                const id = await input.getAttribute('id');
                // 优先选择有搜索相关placeholder或id的输入框
                if (placeholder?.includes('搜索') || placeholder?.includes('关键词') ||
                    placeholder?.includes('案由') || id?.includes('search') || id?.includes('keyword')) {
                    await input.fill(keyword);
                    return;
                }
            }
        }

        // 策略4: 如果还是没找到，使用第一个可见的输入框
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
        // 策略1: 使用getByRole定位搜索区域附近的可点击元素
        try {
            // 搜索按钮紧邻搜索框，先定位搜索框再找相邻的搜索按钮
            const searchBtn = this.page.locator('div').filter({ hasText: /^搜索$/ }).first();
            await searchBtn.waitFor({ state: 'visible', timeout: 3000 });
            await searchBtn.click();
            return;
        } catch {
            // 继续尝试其他方法
        }

        // 策略2: 使用getByText精确匹配
        try {
            const searchButton = this.page.getByText(SELECTORS.searchButtonText, { exact: true }).first();
            await searchButton.waitFor({ state: 'visible', timeout: 3000 });
            await searchButton.click();
            return;
        } catch {
            // 继续尝试其他方法
        }

        // 策略3: 使用CSS选择器
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
                    timeout: 1000
                });
                if (btn) {
                    await btn.click();
                    return;
                }
            } catch {
                // 继续尝试下一个
            }
        }

        // 策略4: 最后尝试按回车键触发搜索
        await this.page.keyboard.press('Enter');
    }

    /**
     * 应用筛选条件
     * 需求 2.4: 组合多个筛选条件时使用AND逻辑
     */
    private async applyFilters(filters: SearchFilters): Promise<void> {
        // 应用案件类型筛选
        if (filters.caseType) {
            await this.applyCaseTypeFilter(filters.caseType);
        }

        // 应用法院级别筛选
        if (filters.courtLevel) {
            await this.applyCourtLevelFilter(filters.courtLevel);
        }

        // 应用日期范围筛选
        if (filters.startDate || filters.endDate) {
            await this.applyDateRangeFilter(filters.startDate, filters.endDate);
        }
    }

    /**
     * 应用案件类型筛选
     * 需求 2.1: 按案件类型筛选
     */
    private async applyCaseTypeFilter(caseType: CaseType): Promise<void> {
        try {
            const filterElement = await this.page.$(SELECTORS.filterCaseType);
            if (filterElement) {
                await filterElement.click();
                // 等待筛选选项出现
                await this.page.waitForTimeout(500);
                // 选择对应的案件类型
                const option = await this.page.$(`[data-value="${caseType}"], [value="${caseType}"]`);
                if (option) {
                    await option.click();
                }
            }
        } catch {
            // 筛选失败时忽略，继续搜索
        }
    }

    /**
     * 应用法院级别筛选
     * 需求 2.2: 按法院级别筛选
     */
    private async applyCourtLevelFilter(courtLevel: CourtLevel): Promise<void> {
        try {
            const filterElement = await this.page.$(SELECTORS.filterCourtLevel);
            if (filterElement) {
                await filterElement.click();
                await this.page.waitForTimeout(500);
                const option = await this.page.$(`[data-value="${courtLevel}"], [value="${courtLevel}"]`);
                if (option) {
                    await option.click();
                }
            }
        } catch {
            // 筛选失败时忽略
        }
    }

    /**
     * 应用日期范围筛选
     * 需求 2.3: 按日期范围筛选
     */
    private async applyDateRangeFilter(startDate?: string, endDate?: string): Promise<void> {
        try {
            const filterElement = await this.page.$(SELECTORS.filterDateRange);
            if (filterElement) {
                await filterElement.click();
                await this.page.waitForTimeout(500);

                if (startDate) {
                    const startInput = await this.page.$('input[name="startDate"], .start-date');
                    if (startInput) {
                        await startInput.fill(startDate);
                    }
                }

                if (endDate) {
                    const endInput = await this.page.$('input[name="endDate"], .end-date');
                    if (endInput) {
                        await endInput.fill(endDate);
                    }
                }
            }
        } catch {
            // 筛选失败时忽略
        }
    }

    /**
     * 等待搜索结果加载
     */
    private async waitForSearchResults(): Promise<void> {
        try {
            await this.page.waitForSelector(SELECTORS.resultList, {
                timeout: this.config.elementTimeout,
            });
        } catch {
            // 可能没有结果，不抛出错误
        }
    }

    /**
     * 解析搜索结果
     * 需求 1.2: 返回案件名称、案号、法院名称和裁判日期
     */
    private async parseSearchResults(): Promise<DocumentSummary[]> {
        const results: DocumentSummary[] = [];

        const items = await this.page.$$(SELECTORS.resultList);

        for (const item of items) {
            try {
                const summary = await this.parseResultItem(item);
                if (summary) {
                    results.push(summary);
                }
            } catch {
                // 解析单个结果失败时继续处理其他结果
            }
        }

        return results;
    }

    /**
     * 解析单个搜索结果项
     */
    private async parseResultItem(item: ReturnType<Page['$']> extends Promise<infer T> ? T : never): Promise<DocumentSummary | null> {
        if (!item) return null;

        const getText = async (selector: string): Promise<string> => {
            const element = await item.$(selector);
            if (element) {
                const text = await element.textContent();
                return text?.trim() ?? '';
            }
            return '';
        };

        const getDocId = async (): Promise<string> => {
            // 尝试从链接或data属性获取文书ID
            const link = await item.$('a[href*="docId"], a[data-docid]');
            if (link) {
                const href = await link.getAttribute('href');
                const docIdMatch = href?.match(/docId=([^&]+)/);
                if (docIdMatch && docIdMatch[1]) return docIdMatch[1];

                const dataDocId = await link.getAttribute('data-docid');
                if (dataDocId) return dataDocId;
            }

            // 尝试从item本身获取
            const dataId = await item.getAttribute('data-id') || await item.getAttribute('data-docid');
            if (dataId) return dataId;

            // 生成临时ID
            return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        };

        const 文书ID = await getDocId();
        const 案件名称 = await getText(SELECTORS.resultTitle);
        const 案号 = await getText(SELECTORS.resultCaseNo);
        const 法院名称 = await getText(SELECTORS.resultCourt);
        const 裁判日期 = await getText(SELECTORS.resultDate);
        const 案件类型 = await getText(SELECTORS.resultType);

        // 验证必需字段
        if (!案件名称 && !案号) {
            return null;
        }

        return {
            文书ID,
            案件名称: 案件名称 || '未知案件',
            案号: 案号 || '未知案号',
            法院名称: 法院名称 || '未知法院',
            裁判日期: 裁判日期 || '未知日期',
            案件类型: 案件类型 || '未知类型',
        };
    }

    /**
     * 获取搜索结果总数
     */
    private async getTotalCount(): Promise<number> {
        try {
            const totalElement = await this.page.$(SELECTORS.totalCount);
            if (totalElement) {
                const text = await totalElement.textContent();
                const match = text?.match(/\d+/);
                if (match) {
                    return parseInt(match[0], 10);
                }
            }
        } catch {
            // 获取总数失败
        }

        // 如果无法获取总数，返回当前页面结果数
        const items = await this.page.$$(SELECTORS.resultList);
        return items.length;
    }

    /**
     * 翻页操作
     * 需求 5.1: 支持分页参数
     */
    async goToPage(pageNumber: number): Promise<void> {
        if (pageNumber < 1) {
            throw new Error('页码必须大于0');
        }

        // 尝试直接点击页码
        const pageSelector = `${SELECTORS.pageNumber}:has-text("${pageNumber}"), [data-page="${pageNumber}"]`;
        const pageButton = await this.page.$(pageSelector);

        if (pageButton) {
            await pageButton.click();
            await this.waitForSearchResults();
            return;
        }

        // 如果找不到直接的页码按钮，使用下一页按钮逐页翻
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
        const nextButton = await this.page.$(SELECTORS.nextPage);
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
        const prevButton = await this.page.$(SELECTORS.prevPage);
        if (prevButton && await prevButton.isEnabled()) {
            await prevButton.click();
            await this.waitForSearchResults();
            return true;
        }
        return false;
    }

    /**
     * 获取文书详情
     * 需求 3.1: 根据文书ID获取完整内容
     * 需求 3.2: 返回结构化的元数据
     */
    async getDocumentDetail(docId: string): Promise<DocumentDetail> {
        // 构建文书详情页URL
        const detailUrl = `${this.config.baseUrl}/website/wenshu/181107ANFZ0BXSK4/index.html?docId=${docId}`;

        await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
        await this.waitForPageLoad();

        // 检查是否需要登录
        if (await this.checkLoginRequired()) {
            throw new AuthRequiredError('需要登录才能查看文书详情');
        }

        // 等待文书内容加载
        try {
            await this.page.waitForSelector(SELECTORS.documentContent, {
                timeout: this.config.elementTimeout,
            });
        } catch {
            throw new NotFoundError(`未找到文书: ${docId}`);
        }

        // 解析文书详情
        return this.parseDocumentDetail(docId);
    }

    /**
     * 解析文书详情
     */
    private async parseDocumentDetail(docId: string): Promise<DocumentDetail> {
        const getText = async (selector: string): Promise<string> => {
            const element = await this.page.$(selector);
            if (element) {
                const text = await element.textContent();
                return text?.trim() ?? '';
            }
            return '';
        };

        const 案件名称 = await getText(SELECTORS.documentTitle);
        const 案号 = await getText(SELECTORS.documentCaseNo);
        const 法院名称 = await getText(SELECTORS.documentCourt);
        const 裁判日期 = await getText(SELECTORS.documentDate);
        const 案由 = await getText(SELECTORS.documentCause);
        const 文书全文 = await getText(SELECTORS.documentFullText);

        // 解析当事人信息
        const 当事人 = await this.parseParties();

        // 解析审判人员
        const 审判人员 = await this.parseJudges();

        // 推断法院级别
        const 法院级别 = this.inferCourtLevel(法院名称);

        // 推断案件类型
        const 案件类型 = this.inferCaseType(案号, 案件名称);

        return {
            文书ID: docId,
            案件名称: 案件名称 || '未知案件',
            案号: 案号 || '未知案号',
            法院名称: 法院名称 || '未知法院',
            法院级别,
            裁判日期: 裁判日期 || '未知日期',
            案件类型,
            当事人,
            审判人员,
            文书全文: 文书全文 || '',
            案由: 案由 || '未知案由',
        };
    }

    /**
     * 解析当事人信息
     */
    private async parseParties(): Promise<PartyInfo[]> {
        const parties: PartyInfo[] = [];

        try {
            const partyElements = await this.page.$$(SELECTORS.documentParties);

            for (const element of partyElements) {
                const text = await element.textContent();
                if (text) {
                    // 尝试解析当事人角色和姓名
                    const parsed = this.parsePartyText(text);
                    if (parsed) {
                        parties.push(parsed);
                    }
                }
            }
        } catch {
            // 解析失败时返回空数组
        }

        return parties;
    }

    /**
     * 解析当事人文本
     */
    private parsePartyText(text: string): PartyInfo | null {
        // 常见的当事人角色模式
        const rolePatterns = [
            /^(原告|被告|上诉人|被上诉人|申请人|被申请人|原审原告|原审被告)[：:]\s*(.+)$/,
            /^(.+?)[（(](原告|被告|上诉人|被上诉人|申请人|被申请人)[）)]$/,
        ];

        for (const pattern of rolePatterns) {
            const match = text.trim().match(pattern);
            if (match && match[1]) {
                const role = match[1].includes('原告') || match[1].includes('申请人') || match[1].includes('上诉人')
                    ? match[1]
                    : (match[2] ?? match[1]);
                const name = match[2] ?? match[1];
                return {
                    角色: role,
                    姓名: name,
                };
            }
        }

        // 如果无法解析角色，返回未知角色
        if (text.trim()) {
            return {
                角色: '当事人',
                姓名: text.trim(),
            };
        }

        return null;
    }

    /**
     * 解析审判人员
     */
    private async parseJudges(): Promise<string[]> {
        const judges: string[] = [];

        try {
            const judgeElements = await this.page.$$(SELECTORS.documentJudges);

            for (const element of judgeElements) {
                const text = await element.textContent();
                if (text) {
                    // 提取法官姓名
                    const names = text.split(/[,，、\s]+/).filter(name => name.trim());
                    judges.push(...names);
                }
            }
        } catch {
            // 解析失败时返回空数组
        }

        return judges;
    }

    /**
     * 根据法院名称推断法院级别
     */
    private inferCourtLevel(courtName: string): string {
        if (courtName.includes('最高人民法院')) {
            return '最高人民法院';
        }
        if (courtName.includes('高级人民法院')) {
            return '高级人民法院';
        }
        if (courtName.includes('中级人民法院')) {
            return '中级人民法院';
        }
        if (courtName.includes('人民法院')) {
            return '基层人民法院';
        }
        return '未知级别';
    }

    /**
     * 根据案号和案件名称推断案件类型
     */
    private inferCaseType(caseNo: string, caseName: string): string {
        const combined = `${caseNo} ${caseName}`;

        if (combined.includes('刑') || combined.includes('刑事')) {
            return '刑事案件';
        }
        if (combined.includes('民') || combined.includes('民事')) {
            return '民事案件';
        }
        if (combined.includes('行') || combined.includes('行政')) {
            return '行政案件';
        }
        if (combined.includes('赔') || combined.includes('赔偿')) {
            return '赔偿案件';
        }
        if (combined.includes('执') || combined.includes('执行')) {
            return '执行案件';
        }

        return '未知类型';
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
