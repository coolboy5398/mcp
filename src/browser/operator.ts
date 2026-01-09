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
 * 根据裁判文书网实际页面结构定义（2026年1月3日实测更新）
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

    // 搜索结果 - 基于2026年1月3日实测页面结构更新
    // 每个结果项是一个 .LM_list 容器
    resultList: '.LM_list',                     // 结果容器
    resultTitle: 'h4 a.caseName',               // 标题链接
    resultCourt: '.slfyName',                   // 法院名称（在 .list_subtitle 中）
    resultCaseNo: '.ah',                        // 案号
    resultDate: '.cprq',                        // 裁判日期
    resultType: '.labelTwo',                    // 案件类型（在 .List_label 中）
    resultDocIdInput: 'input.ListSelect',       // docId 在 data-value 属性中

    // 分页 - 基于实际页面结构
    pagination: '.pagination, .page-nav',
    pageNumber: 'a[href="javascript:;"]',
    nextPage: 'a:has-text("下一页")',
    prevPage: 'a:has-text("上一页")',
    totalCount: ':text("共检索到")',

    // 筛选条件 - 基于左侧筛选树结构
    filterCaseType: '.case-type-filter, [data-filter="caseType"]',
    filterCourtLevel: '.court-level-filter, [data-filter="courtLevel"]',
    filterDateRange: '.date-range-filter, [data-filter="dateRange"]',

    // 文书详情
    documentContent: '.content, .ws-content, .document-content, #content',
    documentTitle: '.title, h1, .ws-title',
    documentCaseNo: '.case-no, .ah, .caseNo',
    documentCourt: '.court, .fy, .courtName, .slfyName',
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
     * 检查页面是否仍然有效可用
     * 在执行任何操作前调用，防止 "Target page, context or browser has been closed" 错误
     */
    private async ensurePageValid(): Promise<void> {
        try {
            // 尝试获取页面URL来验证页面是否仍然有效
            this.page.url();
            
            // 检查页面是否已关闭
            if (this.page.isClosed()) {
                throw new ServiceUnavailableError(
                    '浏览器页面已关闭，请重新登录后再试。' +
                    '提示：如果刚刚执行了登录操作，请稍等片刻后重试。'
                );
            }
        } catch (error) {
            if (error instanceof ServiceUnavailableError) {
                throw error;
            }
            // 其他错误（如页面已被销毁）
            throw new ServiceUnavailableError(
                '浏览器页面已失效，请重新登录后再试。' +
                `原因：${error instanceof Error ? error.message : String(error)}`
            );
        }
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

        console.error(`[DEBUG] searchDocuments: 开始搜索 keyword="${keyword}", page=${page}, pageSize=${pageSize}`);

        // 在执行任何操作前，先检查页面是否有效
        console.error('[DEBUG] searchDocuments: 检查页面有效性');
        await this.ensurePageValid();

        // 导航到搜索页面（包含页面关闭错误处理）
        console.error(`[DEBUG] searchDocuments: 导航到 ${this.config.searchUrl}`);
        try {
            await this.page.goto(this.config.searchUrl, { waitUntil: 'domcontentloaded' });
        } catch (error) {
            // 捕获页面已关闭的错误，提供更友好的提示
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('Target page') ||
                errorMessage.includes('closed') ||
                errorMessage.includes('target closed') ||
                errorMessage.includes('browser has been closed')) {
                throw new ServiceUnavailableError(
                    '浏览器页面已失效，请稍后重试搜索操作。' +
                    '提示：如果刚刚执行了登录操作，请等待几秒后再尝试搜索。'
                );
            }
            throw error;
        }
        await this.waitForPageLoad();
        console.error('[DEBUG] searchDocuments: 页面加载完成');

        // 检查是否需要登录
        if (await this.checkLoginRequired()) {
            console.error('[DEBUG] searchDocuments: 需要登录');
            throw new AuthRequiredError('需要登录才能搜索文书');
        }
        console.error('[DEBUG] searchDocuments: 已登录，继续搜索');

        // 1. 输入搜索关键词 (最先执行，防止后续操作被重置)
        console.error('[DEBUG] searchDocuments: 输入关键词');
        await this.inputSearchKeyword(keyword);
        // 按 ESC 键以关闭可能出现的联想下拉框，避免遮挡
        await this.page.keyboard.press('Escape');

        // 2. 如果有法院名称或其他高级筛选，打开高级检索面板
        // 注意：法院名称现在作为高级筛选的一部分处理
        if (filters?.courtName) {
            console.error('[DEBUG] searchDocuments: 打开高级检索面板');
            await this.openAdvancedSearch();
            
            console.error(`[DEBUG] searchDocuments: 输入法院名称 "${filters.courtName}"`);
            await this.inputCourtName(filters.courtName);
        }

        // 3. 应用其他筛选条件 (包括法院层级等)
        if (filters) {
            console.error('[DEBUG] searchDocuments: 应用筛选条件');
            await this.applyFilters(filters);
        }

        // 4. [前置筛选] 如果有日期范围参数，通过高级检索面板设置
        // 注意：日期范围优先于年份筛选
        if (filters?.startDate || filters?.endDate) {
            console.error('[DEBUG] searchDocuments: 应用日期范围筛选（高级检索）');
            await this.applyDateRangeFilter(filters.startDate, filters.endDate);
        }

        // 5. 点击搜索按钮
        console.error('[DEBUG] searchDocuments: 点击搜索按钮');
        await this.clickSearchButton();

        // 5. 等待搜索结果加载
        console.error('[DEBUG] searchDocuments: 等待搜索结果');
        await this.waitForSearchResults();

        // [后置筛选] 如果有省份筛选，在结果页进行二次筛选
        if (filters?.province) {
            console.error(`[DEBUG] searchDocuments: 应用省份筛选 "${filters.province}"`);
            await this.applyProvinceFilter(filters.province);
            // 省份筛选后需要再次等待结果刷新
            console.error('[DEBUG] searchDocuments: 等待省份筛选结果刷新');
            await this.waitForSearchResults();
        }

        // [后置筛选] 如果有裁判年份筛选且没有日期范围，在结果页进行筛选
        // 注意：如果已经使用了日期范围，则跳过年份筛选（日期范围优先）
        if (filters?.judgmentYear && !filters?.startDate && !filters?.endDate) {
            console.error(`[DEBUG] searchDocuments: 应用裁判年份筛选 "${filters.judgmentYear}"`);
            await this.applyJudgmentYearFilter(filters.judgmentYear);
            // 年份筛选后需要再次等待结果刷新
            console.error('[DEBUG] searchDocuments: 等待年份筛选结果刷新');
            await this.waitForSearchResults();
        }

        // 如果不是第一页，翻到指定页
        if (page > 1) {
            console.error(`[DEBUG] searchDocuments: 翻到第 ${page} 页`);
            await this.goToPage(page);
        }

        // 解析搜索结果
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
        // Strategy 1: Use specific ID found in debug
        try {
            const searchBtn = this.page.locator('#searchBtn');
            if (await searchBtn.count() > 0 && await searchBtn.isVisible()) {
                await searchBtn.click();
                return;
            }
        } catch {}

        // Strategy 2: Use getByRole near search input定位搜索区域附近的可点击元素
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
        // 注意：裁判年份筛选在 searchDocuments 中作为后置筛选处理
    }

    /**
     * 应用案件类型筛选
     * 需求 2.1: 按案件类型筛选
     * 修复：网页案件类型下拉选项列表ID是 #gjjs_ajlx，触发器是 #s8
     * 数字代码: 02=刑事, 03=民事, 04=行政, 05=赔偿, 10=执行
     */
    private async applyCaseTypeFilter(caseType: CaseType): Promise<void> {
        const CASE_TYPE_MAP: Record<string, string> = {
            'xingshi': '02',   // 刑事案件
            'minshi': '03',    // 民事案件
            'xingzheng': '04', // 行政案件
            'peichang': '05',  // 国家赔偿与司法救助案件
            'zhixing': '10'    // 执行案件
        };

        try {
            // 确保面板已打开
            await this.openAdvancedSearch();

            // 1. 点击"案件类型"下拉框 (#s8) 以展开选项
            const dropdownTrigger = await this.page.$('#s8');
            if (dropdownTrigger) {
                console.error('[DEBUG] applyCaseTypeFilter: 点击案件类型下拉框 #s8');
                await dropdownTrigger.click();
                await this.page.waitForTimeout(500); // 等待下拉选项出现
            } else {
                console.error('[DEBUG] applyCaseTypeFilter: 未找到案件类型下拉框 #s8');
                return;
            }
            
            // 获取映射值
            const targetVal = CASE_TYPE_MAP[caseType] || caseType;
            
            // 2. 选择选项 (在案件类型专用的下拉列表 #gjjs_ajlx 中查找)
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
            } catch (err) {
                console.error(`[DEBUG] applyCaseTypeFilter: 等待选项超时或失败 - ${err}`);
            }
        } catch (e) {
            console.error(`[DEBUG] applyCaseTypeFilter: 筛选出错 - ${e}`);
        }
    }

    /**
     * 应用法院级别筛选
     * 需求 2.2: 按法院级别筛选
     * 修复：网页法院层级下拉选项列表ID是 #gjjs_fycj
     * 数字代码: 1=最高法院, 2=高级法院, 3=中级法院, 4=基层法院
     */
    private async applyCourtLevelFilter(courtLevel: CourtLevel): Promise<void> {
        const COURT_LEVEL_MAP: Record<string, string> = {
            'zuigao': '1',
            'gaoji': '2',
            'zhongji': '3',
            'jiceng': '4'
        };

        try {
            // 确保面板已打开
            await this.openAdvancedSearch();

            // 1. 点击"法院层级"下拉框 (#s4) 以展开选项
            const dropdownTrigger = await this.page.$('#s4');
            if (dropdownTrigger) {
                console.error('[DEBUG] applyCourtLevelFilter: 点击法院层级下拉框 #s4');
                await dropdownTrigger.click();
                await this.page.waitForTimeout(500); // 等待下拉选项出现
            } else {
                console.error('[DEBUG] applyCourtLevelFilter: 未找到法院层级下拉框 #s4');
                return;
            }
            
            // 获取映射值
            const targetVal = COURT_LEVEL_MAP[courtLevel] || courtLevel;
            
            // 2. 选择选项 (在法院层级专用的下拉列表 #gjjs_fycj 中查找)
            const selector = `#gjjs_fycj li[data-val="${targetVal}"]`;
            // 等待选项可见
            try {
                await this.page.waitForSelector(selector, { state: 'visible', timeout: 2000 });
                const option = await this.page.$(selector);
                
                if (option) {
                    console.error(`[DEBUG] applyCourtLevelFilter: 点击选项 val=${targetVal}`);
                    await option.click();
                    // 等待一下，让点击生效（有些UI可能需要一点反应时间）
                    await this.page.waitForTimeout(300);
                } else {
                    console.error(`[DEBUG] applyCourtLevelFilter: 未找到法院层级选项 "${courtLevel}" (val=${targetVal})`);
                }
            } catch (err) {
                 console.error(`[DEBUG] applyCourtLevelFilter: 等待选项超时或失败 - ${err}`);
            }
        } catch (e) {
            console.error(`[DEBUG] applyCourtLevelFilter: 筛选出错 - ${e}`);
        }
    }

    /**
     * 打开高级检索面板
     * 修复：网页使用的是 .advenced-search (拼写错误)
     */
    private async openAdvancedSearch(): Promise<void> {
        try {
            // 检查是否已经展开（如果有s2输入框且可见）
            const s2Input = await this.page.$('#s2');
            if (s2Input && await s2Input.isVisible()) {
                console.error('[DEBUG] openAdvancedSearch: 高级检索面板已展开');
                return;
            }

            // 使用修正后的选择器
            const advancedBtn = this.page.locator('.advenced-search').first();
            
            if (await advancedBtn.count() > 0 && await advancedBtn.isVisible()) {
                console.error('[DEBUG] openAdvancedSearch: 点击高级检索按钮');
                await advancedBtn.click();
                // 等待面板展开动画
                await this.page.waitForTimeout(1000);
            } else {
                 console.error('[DEBUG] openAdvancedSearch: 未找到高级检索按钮 (.advenced-search)');
            }
        } catch (e) {
            console.error(`[DEBUG] openAdvancedSearch: 打开面板失败 - ${e}`);
        }
    }

    /**
     * 输入法院名称 (高级检索)
     */
    private async inputCourtName(courtName: string): Promise<void> {
        const selector = '#s2'; // 确定的ID
        try {
            // 等待输入框出现
            await this.page.waitForSelector(selector, { state: 'visible', timeout: 3000 });
            await this.page.fill(selector, courtName);
            
            // 有时候可能会有联想下拉框遮挡，按一下Tab或者点击空白处
            await this.page.keyboard.press('Tab');
        } catch {
            console.error(`[DEBUG] inputCourtName: 无法找到法院输入框 ${selector}`);
            // 尝试备用
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
            // 省份通常在左侧树形结构中
            // 选择器可能需要调整以匹配实际页面结构
            // 优先尝试精确匹配 jstree-anchor
            const provinceNode = this.page.locator(`.jstree-anchor`).filter({ hasText: new RegExp(`^${province}$`) }).first();
            
            // 检查是否存在
            if (await provinceNode.count() > 0) {
                await provinceNode.scrollIntoViewIfNeeded();
                await provinceNode.click();
                // 等待筛选标签出现，确认筛选已生效
                await this.waitForFilterTag(`法院省份：${province}`);
                return;
            }

            // 模糊匹配
            const roughNode = this.page.locator(`.jstree-anchor:has-text("${province}")`).first();
            if (await roughNode.count() > 0) {
                await roughNode.scrollIntoViewIfNeeded();
                await roughNode.click();
                // 等待筛选标签出现，确认筛选已生效
                await this.waitForFilterTag(`法院省份：${province}`);
                return;
            }
            
            console.error(`[DEBUG] applyProvinceFilter: 未找到省份节点 "${province}"`);
        } catch (e) {
            console.error(`[DEBUG] applyProvinceFilter: 筛选出错 - ${e}`);
        }
    }

    /**
     * 应用裁判年份筛选 (后置筛选)
     * 在搜索结果页的左侧筛选栏中点击对应年份
     */
    private async applyJudgmentYearFilter(year: string): Promise<void> {
        console.error(`[DEBUG] applyJudgmentYearFilter: 尝试筛选年份 "${year}"`);
        try {
            // 年份在左侧树形结构中，格式类似 "2024(278)"
            // 使用 jstree-anchor 选择器，匹配以年份开头的文本
            const yearNode = this.page.locator(`.jstree-anchor`).filter({ hasText: new RegExp(`^${year}\\(`) }).first();
            
            // 检查是否存在
            if (await yearNode.count() > 0) {
                console.error(`[DEBUG] applyJudgmentYearFilter: 找到年份节点，点击中...`);
                await yearNode.scrollIntoViewIfNeeded();
                await yearNode.click();
                // 等待筛选标签出现，确认筛选已生效
                await this.waitForFilterTag(`裁判年份：${year}`);
                return;
            }

            // 备选：尝试精确匹配年份文本
            const exactNode = this.page.locator(`.jstree-anchor:has-text("${year}")`).first();
            if (await exactNode.count() > 0) {
                console.error(`[DEBUG] applyJudgmentYearFilter: 使用备选选择器找到年份节点`);
                await exactNode.scrollIntoViewIfNeeded();
                await exactNode.click();
                // 等待筛选标签出现，确认筛选已生效
                await this.waitForFilterTag(`裁判年份：${year}`);
                return;
            }
            
            console.error(`[DEBUG] applyJudgmentYearFilter: 未找到年份节点 "${year}"`);
        } catch (e) {
            console.error(`[DEBUG] applyJudgmentYearFilter: 筛选出错 - ${e}`);
        }
    }

    /**
     * 应用日期范围筛选 (前置筛选)
     * 通过高级检索面板的 cprqStart 和 cprqEnd 输入框实现
     * 需要在点击搜索按钮之前调用
     */
    private async applyDateRangeFilter(startDate?: string, endDate?: string): Promise<void> {
        if (!startDate && !endDate) {
            return;
        }
        
        console.error(`[DEBUG] applyDateRangeFilter: 应用日期范围 ${startDate || ''} ~ ${endDate || ''}`);
        
        try {
            // 1. 展开高级检索面板
            const wrapper = this.page.locator('.advencedWrapper');
            if (await wrapper.count() > 0) {
                await wrapper.evaluate(el => {
                    (el as { style: { display: string } }).style.display = 'block';
                });
            }
            await this.page.waitForTimeout(500);
            
            // 2. 填入开始日期
            if (startDate) {
                const startInput = this.page.locator('#cprqStart');
                if (await startInput.count() > 0) {
                    await startInput.fill(startDate);
                    console.error(`[DEBUG] applyDateRangeFilter: 已设置开始日期 ${startDate}`);
                }
            }
            
            // 3. 填入结束日期
            if (endDate) {
                const endInput = this.page.locator('#cprqEnd');
                if (await endInput.count() > 0) {
                    await endInput.fill(endDate);
                    console.error(`[DEBUG] applyDateRangeFilter: 已设置结束日期 ${endDate}`);
                }
            }
        } catch (e) {
            console.error(`[DEBUG] applyDateRangeFilter: 设置日期范围出错 - ${e}`);
        }
    }

    /**
     * 等待筛选标签出现
     * 筛选成功后，页面顶部会显示已选条件标签，如 "法院省份：北京市"
     * 通过等待这个标签出现来确认筛选已生效
     */
    private async waitForFilterTag(tagText: string): Promise<void> {
        console.error(`[DEBUG] waitForFilterTag: 等待筛选标签 "${tagText}"`);
        try {
            // 等待包含指定文本的标签出现
            // 标签格式通常是在 .searchCondition 或类似容器中
            await this.page.waitForSelector(`:text("${tagText}")`, {
                timeout: 8000,
                state: 'visible',
            });
            console.error(`[DEBUG] waitForFilterTag: 筛选标签 "${tagText}" 已出现`);
            
            // 额外等待一小段时间确保结果列表也刷新完成
            await this.page.waitForTimeout(500);
        } catch (e) {
            console.error(`[DEBUG] waitForFilterTag: 等待筛选标签超时 - ${e}`);
            // 即使标签没出现，也继续执行（可能是页面结构变化）
        }
    }

    /**
     * 等待搜索结果加载
     * 增加URL检测：如果被重定向到登录页，抛出认证错误
     */
    private async waitForSearchResults(): Promise<void> {
        // 等待页面导航完成
        await this.page.waitForLoadState('domcontentloaded', { timeout: this.config.loadTimeout });
        console.error('[DEBUG] waitForSearchResults: domcontentloaded 完成');
        
        // 等待网络空闲（搜索结果通常需要异步加载）
        await this.page.waitForLoadState('networkidle', { timeout: this.config.loadTimeout }).catch(() => { });
        console.error('[DEBUG] waitForSearchResults: networkidle 完成');
        
        // 检测是否被重定向到登录页
        const currentUrl = this.page.url();
        console.error(`[DEBUG] waitForSearchResults: 当前URL = ${currentUrl}`);
        
        if (currentUrl.includes('181010CARHS5BS3C')) {
            // 181010CARHS5BS3C 是登录页面的特征路径
            throw new AuthRequiredError('搜索需要登录，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        try {
            // 等待 .LM_list 结果容器出现
            console.error(`[DEBUG] waitForSearchResults: 等待选择器 "${SELECTORS.resultList}"`);
            await this.page.waitForSelector(SELECTORS.resultList, {
                timeout: this.config.elementTimeout,
            });
            console.error('[DEBUG] waitForSearchResults: 找到结果容器');
        } catch (error) {
            console.error(`[DEBUG] waitForSearchResults: 等待结果容器失败 - ${error}`);
            // 可能没有结果，检查是否显示了总数信息
            try {
                // 检查是否有 "共检索到" 文本
                await this.page.waitForSelector(':text("共检索到")', {
                    timeout: 3000,
                });
                console.error('[DEBUG] waitForSearchResults: 找到总数文本');
            } catch {
                console.error('[DEBUG] waitForSearchResults: 未找到总数文本');
                // 确实没有结果，不抛出错误
            }
        }
    }

    /**
     * 解析搜索结果
     * 需求 1.2: 返回案件名称、案号、法院名称和裁判日期
     */
    private async parseSearchResults(): Promise<DocumentSummary[]> {
        const results: DocumentSummary[] = [];

        console.error(`[DEBUG] parseSearchResults: 使用选择器 "${SELECTORS.resultList}"`);
        const items = await this.page.$$(SELECTORS.resultList);
        console.error(`[DEBUG] parseSearchResults: 找到 ${items.length} 个结果项`);

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item) {
                console.error(`[DEBUG] parseSearchResults: 结果 ${i + 1} 为 undefined，跳过`);
                continue;
            }
            try {
                const summary = await this.parseResultItem(item);
                if (summary) {
                    console.error(`[DEBUG] parseSearchResults: 结果 ${i + 1} 解析成功 - ${summary.案件名称.substring(0, 30)}...`);
                    results.push(summary);
                } else {
                    console.error(`[DEBUG] parseSearchResults: 结果 ${i + 1} 解析返回 null`);
                }
            } catch (error) {
                console.error(`[DEBUG] parseSearchResults: 结果 ${i + 1} 解析失败 - ${error}`);
                // 解析单个结果失败时继续处理其他结果
            }
        }

        console.error(`[DEBUG] parseSearchResults: 总共解析成功 ${results.length} 个结果`);
        return results;
    }

    /**
     * 解析单个搜索结果项
     * 基于2026年1月3日实测的页面结构：
     * - 每个结果项是 .LM_list 容器
     * - 包含：.List_label(类型)、.list_title(标题)、.list_subtitle(法院/案号/日期)、.list_reason(摘要)
     * - 详情页链接格式：../181107ANFZ0BXSK4/index.html?docId=xxx
     */
    private async parseResultItem(item: ReturnType<Page['$']> extends Promise<infer T> ? T : never): Promise<DocumentSummary | null> {
        if (!item) {
            console.error('[DEBUG] parseResultItem: item 为 null');
            return null;
        }

        const getDocId = async (): Promise<string> => {
            // 方法1: 从 input.ListSelect 的 data-value 属性获取
            const docIdInput = await item.$(SELECTORS.resultDocIdInput);
            if (docIdInput) {
                const dataValue = await docIdInput.getAttribute('data-value');
                if (dataValue) {
                    console.error(`[DEBUG] parseResultItem: docId from input = ${dataValue.substring(0, 30)}...`);
                    return dataValue;
                }
            }
            
            // 方法2: 从标题链接获取文书ID (链接格式: ../181107ANFZ0BXSK4/index.html?docId=xxx)
            const link = await item.$(SELECTORS.resultTitle);
            if (link) {
                const href = await link.getAttribute('href');
                if (href) {
                    const docIdMatch = href.match(/docId=([^&]+)/);
                    if (docIdMatch && docIdMatch[1]) {
                        console.error(`[DEBUG] parseResultItem: docId from href = ${docIdMatch[1].substring(0, 30)}...`);
                        return docIdMatch[1];
                    }
                }
            }
            // 生成临时ID
            console.error('[DEBUG] parseResultItem: 使用临时 docId');
            return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        };

        // 获取案件名称（标题）- 使用 h4 a.caseName
        const titleElement = await item.$(SELECTORS.resultTitle);
        const 案件名称 = titleElement ? (await titleElement.textContent())?.trim() ?? '' : '';
        console.error(`[DEBUG] parseResultItem: 标题选择器 "${SELECTORS.resultTitle}" -> "${案件名称.substring(0, 30)}..."`);

        // 获取案件类型 - 使用 .labelTwo
        const typeElement = await item.$(SELECTORS.resultType);
        const 案件类型 = typeElement ? (await typeElement.textContent())?.trim() ?? '' : '';
        console.error(`[DEBUG] parseResultItem: 类型选择器 "${SELECTORS.resultType}" -> "${案件类型}"`);

        // 获取法院名称 - 使用 .slfyName
        const courtElement = await item.$(SELECTORS.resultCourt);
        const 法院名称 = courtElement ? (await courtElement.textContent())?.trim() ?? '' : '';
        console.error(`[DEBUG] parseResultItem: 法院选择器 "${SELECTORS.resultCourt}" -> "${法院名称}"`);

        // 获取案号 - 使用 .ah
        const caseNoElement = await item.$(SELECTORS.resultCaseNo);
        const 案号 = caseNoElement ? (await caseNoElement.textContent())?.trim() ?? '' : '';
        console.error(`[DEBUG] parseResultItem: 案号选择器 "${SELECTORS.resultCaseNo}" -> "${案号}"`);

        // 获取裁判日期 - 使用 .cprq
        const dateElement = await item.$(SELECTORS.resultDate);
        const 裁判日期 = dateElement ? (await dateElement.textContent())?.trim() ?? '' : '';
        console.error(`[DEBUG] parseResultItem: 日期选择器 "${SELECTORS.resultDate}" -> "${裁判日期}"`);

        const 文书ID = await getDocId();

        // 验证必需字段
        if (!案件名称 && !案号) {
            console.error('[DEBUG] parseResultItem: 案件名称和案号都为空，返回 null');
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
     * 页面显示格式: "共检索到 56758461 篇文书，显示前600条"
     */
    private async getTotalCount(): Promise<number> {
        try {
            // 查找包含 "共检索到" 文本的元素
            const pageContent = await this.page.content();
            const match = pageContent.match(/共检索到\s*(\d+)/);
            if (match && match[1]) {
                return parseInt(match[1], 10);
            }
            
            // 备选：使用 locator 查找
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
        // 在执行任何操作前，先检查页面是否有效
        await this.ensurePageValid();

        // 构建文书详情页URL
        const detailUrl = `${this.config.baseUrl}/website/wenshu/181107ANFZ0BXSK4/index.html?docId=${docId}`;

        // 导航到详情页（包含页面关闭错误处理）
        try {
            await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
        } catch (error) {
            // 捕获页面已关闭的错误，提供更友好的提示
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('Target page') ||
                errorMessage.includes('closed') ||
                errorMessage.includes('target closed') ||
                errorMessage.includes('browser has been closed')) {
                throw new ServiceUnavailableError(
                    '浏览器页面已失效，请稍后重试获取文书详情操作。' +
                    '提示：如果刚刚执行了登录操作，请等待几秒后再尝试。'
                );
            }
            throw error;
        }
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
