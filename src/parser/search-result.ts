/**
 * 搜索结果解析器模块
 * 解析裁判文书网搜索结果页面，提取文书摘要信息
 * 需求: 1.2
 */

import { Page, ElementHandle } from 'playwright';
import { DocumentSummary, isValidDocumentSummary } from '../models/index.js';

/**
 * 搜索结果页面选择器
 * 基于2026年1月3日实测页面结构更新
 */
export const SEARCH_RESULT_SELECTORS = {
    // 搜索结果列表容器 - .LM_list 是实际使用的容器
    resultContainer: '.LM_list, .dataItem, .result-item, .case-item, .list-item',

    // 单个结果项内的元素 - 基于实测结构
    title: 'h4 a.caseName, .caseName, .title, h3, .case-title',
    caseNo: '.ah, span.ah, .caseNo, .case-no',
    court: '.slfyName, .court, .courtName, .fy, span.fy',
    date: '.cprq, span.cprq, .date, .judgeDate',
    caseType: '.labelTwo, .caseType, .ajlx, .type, span.ajlx',

    // 文书ID相关
    docLink: 'a.caseName[href*="docId"], a[href*="docId"], a[data-docid]',
    docIdInput: 'input.ListSelect',  // docId 也在 data-value 属性中

    // 分页信息
    totalCount: '.total, .result-count, .total-count, .pageCount',
    currentPage: '.page-active, .current, [aria-current="page"], .active',
    pageSize: '.page-size, [data-pagesize]',
};

/**
 * 解析结果接口
 */
export interface ParsedSearchResults {
    /** 解析出的文书摘要列表 */
    documents: DocumentSummary[];
    /** 解析成功的数量 */
    successCount: number;
    /** 解析失败的数量 */
    failedCount: number;
    /** 解析错误信息 */
    errors: string[];
}

/**
 * 分页信息接口
 */
export interface ParsedPaginationInfo {
    /** 结果总数 */
    total: number;
    /** 当前页码 */
    currentPage: number;
    /** 每页数量 */
    pageSize: number;
    /** 总页数 */
    totalPages: number;
}

/**
 * 搜索结果解析器类
 * 负责从页面中提取文书摘要信息
 */
export class SearchResultParser {
    private readonly page: Page;
    private readonly selectors: typeof SEARCH_RESULT_SELECTORS;

    constructor(page: Page, customSelectors?: Partial<typeof SEARCH_RESULT_SELECTORS>) {
        this.page = page;
        this.selectors = { ...SEARCH_RESULT_SELECTORS, ...customSelectors };
    }

    /**
     * 解析搜索结果列表
     * 需求 1.2: 返回案件名称、案号、法院名称和裁判日期
     */
    async parseResults(): Promise<ParsedSearchResults> {
        const documents: DocumentSummary[] = [];
        const errors: string[] = [];
        let successCount = 0;
        let failedCount = 0;

        try {
            // 获取所有结果项
            const resultItems = await this.page.$$(this.selectors.resultContainer);

            for (let i = 0; i < resultItems.length; i++) {
                try {
                    const item = resultItems[i];
                    if (!item) continue;

                    const summary = await this.parseResultItem(item, i);

                    if (summary && isValidDocumentSummary(summary)) {
                        documents.push(summary);
                        successCount++;
                    } else {
                        failedCount++;
                        errors.push(`结果项 ${i + 1}: 缺少必需字段`);
                    }
                } catch (error) {
                    failedCount++;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push(`结果项 ${i + 1}: ${errorMsg}`);
                }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`解析结果列表失败: ${errorMsg}`);
        }

        return {
            documents,
            successCount,
            failedCount,
            errors,
        };
    }

    /**
     * 解析单个搜索结果项
     */
    async parseResultItem(item: ElementHandle, index: number): Promise<DocumentSummary | null> {
        const 文书ID = await this.extractDocId(item, index);
        const 案件名称 = await this.extractText(item, this.selectors.title);
        const 案号 = await this.extractText(item, this.selectors.caseNo);
        const 法院名称 = await this.extractText(item, this.selectors.court);
        const 裁判日期 = await this.extractText(item, this.selectors.date);
        const 案件类型 = await this.extractText(item, this.selectors.caseType);

        // 如果关键字段都为空，返回null
        if (!案件名称 && !案号) {
            return null;
        }

        return {
            文书ID: 文书ID || this.generateTempId(index),
            案件名称: 案件名称 || '未知案件',
            案号: 案号 || '未知案号',
            法院名称: 法院名称 || '未知法院',
            裁判日期: this.normalizeDate(裁判日期) || '未知日期',
            案件类型: 案件类型 || '未知类型',
        };
    }

    /**
     * 从元素中提取文书ID
     */
    private async extractDocId(item: ElementHandle, index: number): Promise<string> {
        try {
            // 方法1: 从链接href中提取
            const link = await item.$(this.selectors.docLink);
            if (link) {
                const href = await link.getAttribute('href');
                if (href) {
                    const docIdMatch = href.match(/docId=([^&]+)/);
                    if (docIdMatch?.[1]) {
                        return decodeURIComponent(docIdMatch[1]);
                    }
                }

                // 方法2: 从data-docid属性提取
                const dataDocId = await link.getAttribute('data-docid');
                if (dataDocId) {
                    return dataDocId;
                }
            }

            // 方法3: 从item本身的data属性提取
            const dataId = await item.getAttribute('data-id');
            if (dataId) return dataId;

            const dataDocId = await item.getAttribute('data-docid');
            if (dataDocId) return dataDocId;

        } catch {
            // 提取失败，返回空字符串
        }

        return '';
    }

    /**
     * 从元素中提取文本内容
     */
    private async extractText(parent: ElementHandle, selector: string): Promise<string> {
        try {
            // 尝试多个选择器（用逗号分隔）
            const selectors = selector.split(',').map(s => s.trim());

            for (const sel of selectors) {
                const element = await parent.$(sel);
                if (element) {
                    const text = await element.textContent();
                    if (text?.trim()) {
                        return this.cleanText(text);
                    }
                }
            }
        } catch {
            // 提取失败
        }
        return '';
    }

    /**
     * 清理文本内容
     */
    private cleanText(text: string): string {
        return text
            .trim()
            .replace(/\s+/g, ' ')  // 合并多个空白字符
            .replace(/[\r\n]+/g, ' ')  // 移除换行
            .trim();
    }

    /**
     * 标准化日期格式
     */
    private normalizeDate(dateStr: string): string {
        if (!dateStr) return '';

        // 尝试解析常见的日期格式
        const patterns = [
            // YYYY-MM-DD
            /(\d{4})-(\d{1,2})-(\d{1,2})/,
            // YYYY/MM/DD
            /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
            // YYYY年MM月DD日
            /(\d{4})年(\d{1,2})月(\d{1,2})日/,
            // YYYYMMDD
            /(\d{4})(\d{2})(\d{2})/,
        ];

        for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
                const year = match[1];
                const month = match[2]?.padStart(2, '0');
                const day = match[3]?.padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
        }

        // 如果无法解析，返回原始字符串
        return dateStr;
    }

    /**
     * 生成临时ID
     */
    private generateTempId(index: number): string {
        return `temp_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * 解析分页信息
     * 需求 5.2: 返回总数和当前页信息
     */
    async parsePaginationInfo(): Promise<ParsedPaginationInfo> {
        const total = await this.extractTotalCount();
        const currentPage = await this.extractCurrentPage();
        const pageSize = await this.extractPageSize();
        const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

        return {
            total,
            currentPage,
            pageSize,
            totalPages,
        };
    }

    /**
     * 提取结果总数
     */
    private async extractTotalCount(): Promise<number> {
        try {
            const selectors = this.selectors.totalCount.split(',').map(s => s.trim());

            for (const selector of selectors) {
                const element = await this.page.$(selector);
                if (element) {
                    const text = await element.textContent();
                    if (text) {
                        // 提取数字
                        const match = text.match(/(\d+)/);
                        if (match && match[1]) {
                            return parseInt(match[1], 10);
                        }
                    }
                }
            }
        } catch {
            // 提取失败
        }
        return 0;
    }

    /**
     * 提取当前页码
     */
    private async extractCurrentPage(): Promise<number> {
        try {
            const selectors = this.selectors.currentPage.split(',').map(s => s.trim());

            for (const selector of selectors) {
                const element = await this.page.$(selector);
                if (element) {
                    const text = await element.textContent();
                    if (text) {
                        const match = text.match(/(\d+)/);
                        if (match && match[1]) {
                            return parseInt(match[1], 10);
                        }
                    }
                }
            }
        } catch {
            // 提取失败
        }
        return 1;
    }

    /**
     * 提取每页数量
     */
    private async extractPageSize(): Promise<number> {
        try {
            const selectors = this.selectors.pageSize.split(',').map(s => s.trim());

            for (const selector of selectors) {
                const element = await this.page.$(selector);
                if (element) {
                    const text = await element.textContent();
                    if (text) {
                        const match = text.match(/(\d+)/);
                        if (match && match[1]) {
                            return parseInt(match[1], 10);
                        }
                    }

                    // 尝试从属性获取
                    const dataPageSize = await element.getAttribute('data-pagesize');
                    if (dataPageSize) {
                        return parseInt(dataPageSize, 10);
                    }
                }
            }
        } catch {
            // 提取失败
        }
        // 默认每页20条
        return 20;
    }

    /**
     * 检查是否有搜索结果
     */
    async hasResults(): Promise<boolean> {
        try {
            const results = await this.page.$$(this.selectors.resultContainer);
            return results.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * 获取结果数量
     */
    async getResultCount(): Promise<number> {
        try {
            const results = await this.page.$$(this.selectors.resultContainer);
            return results.length;
        } catch {
            return 0;
        }
    }
}

/**
 * 创建搜索结果解析器实例
 */
export function createSearchResultParser(
    page: Page,
    customSelectors?: Partial<typeof SEARCH_RESULT_SELECTORS>
): SearchResultParser {
    return new SearchResultParser(page, customSelectors);
}

/**
 * 从HTML字符串解析搜索结果（用于测试）
 */
export function parseSearchResultsFromHtml(html: string): DocumentSummary[] {
    // 简单的正则解析，用于单元测试
    const results: DocumentSummary[] = [];

    // 匹配文书ID
    const docIdPattern = /docId=([^"&]+)/g;
    // 匹配案件名称
    const titlePattern = /class="caseName"[^>]*>([^<]+)</g;
    // 匹配案号
    const caseNoPattern = /class="(?:caseNo|ah)"[^>]*>([^<]+)</g;
    // 匹配法院
    const courtPattern = /class="(?:court|fy)"[^>]*>([^<]+)</g;
    // 匹配日期
    const datePattern = /class="(?:date|cprq)"[^>]*>([^<]+)</g;
    // 匹配案件类型
    const typePattern = /class="(?:caseType|ajlx)"[^>]*>([^<]+)</g;

    const docIds = [...html.matchAll(docIdPattern)].map(m => m[1]);
    const titles = [...html.matchAll(titlePattern)].map(m => m[1]);
    const caseNos = [...html.matchAll(caseNoPattern)].map(m => m[1]);
    const courts = [...html.matchAll(courtPattern)].map(m => m[1]);
    const dates = [...html.matchAll(datePattern)].map(m => m[1]);
    const types = [...html.matchAll(typePattern)].map(m => m[1]);

    const count = Math.max(docIds.length, titles.length, caseNos.length);

    for (let i = 0; i < count; i++) {
        results.push({
            文书ID: docIds[i] || `temp_${i}`,
            案件名称: titles[i] || '未知案件',
            案号: caseNos[i] || '未知案号',
            法院名称: courts[i] || '未知法院',
            裁判日期: dates[i] || '未知日期',
            案件类型: types[i] || '未知类型',
        });
    }

    return results;
}
