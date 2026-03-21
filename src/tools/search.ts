/**
 * 搜索MCP工具
 * 实现 search_documents 工具
 * 需求: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3
 */

import { z } from 'zod';
import {
    CaseType,
    CourtLevel,
    SearchResponse,
    isValidCaseType,
    isValidCourtLevel,
} from '../models/index.js';
import {
    PageOperator,
    SearchParams,
    SearchFilters,
} from '../browser/index.js';
import {
    AuthManager,
    getDefaultAuthManager,
} from '../auth/index.js';
import {
    createErrorResponse,
    InvalidParamsError,
    AuthRequiredError,
} from '../errors/index.js';

/**
 * 搜索文书输入Schema
 */
export const SearchDocumentsInputSchema = z.object({
    keyword: z.string()
        .min(1, '搜索关键词不能为空')
        .describe('搜索关键词（案由或关键词），必填。注意：不要在关键词中包含地区信息，地区应使用province参数'),
    caseType: z.enum(['xingshi', 'minshi', 'xingzheng', 'peichang', 'zhixing'])
        .optional()
        .describe('案件类型筛选。可选值: xingshi(刑事), minshi(民事), xingzheng(行政), peichang(赔偿), zhixing(执行)'),
    courtLevel: z.enum(['zuigao', 'gaoji', 'zhongji', 'jiceng'])
        .optional()
        .describe('法院级别筛选。可选值: zuigao(最高人民法院), gaoji(高级人民法院), zhongji(中级人民法院), jiceng(基层人民法院)'),
    province: z.string()
        .optional()
        .describe('法院省份筛选，如：北京市、河北省、黑龙江省'),
    courtName: z.string()
        .optional()
        .describe('审理法院名称筛选，如：北京市高级人民法院'),
    judgmentYear: z.string()
        .regex(/^\d{4}$/, '年份格式应为YYYY，如2024')
        .optional()
        .describe('裁判年份筛选，格式: YYYY（如2024）。通过结果页左侧树筛选'),
    startDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为YYYY-MM-DD')
        .optional()
        .describe('裁判日期范围起始，格式: YYYY-MM-DD（如2024-01-01）。通过高级检索实现'),
    endDate: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为YYYY-MM-DD')
        .optional()
        .describe('裁判日期范围结束，格式: YYYY-MM-DD（如2024-12-31）。通过高级检索实现'),
    page: z.number()
        .int()
        .min(1)
        .default(1)
        .describe('页码，默认1'),
    pageSize: z.number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('每页数量，默认20，最大100'),
});

export type SearchDocumentsInput = z.infer<typeof SearchDocumentsInputSchema>;

/**
 * 搜索文书输出接口
 */
export interface SearchDocumentsOutput {
    total: number;
    page: number;
    pageSize: number;
    documents: Array<{
        文书ID: string;
        案件名称: string;
        案号: string;
        法院名称: string;
        裁判日期: string;
        案件类型: string;
    }>;
    消息?: string;
}

/**
 * 搜索工具类
 * 封装文书搜索相关的MCP工具实现
 */
export class SearchTools {
    private authManager: AuthManager;

    constructor(authManager?: AuthManager) {
        this.authManager = authManager ?? getDefaultAuthManager();
    }

    /**
     * 搜索文书
     * 需求 1.1: 通过关键词搜索裁判文书
     * 需求 1.2: 返回案件名称、案号、法院名称和裁判日期
     * 需求 1.3: 没有结果时返回空列表
     * 需求 2.1, 2.2, 2.3: 支持筛选条件
     * 需求 2.4: 组合筛选使用AND逻辑
     * 需求 5.1, 5.2, 5.3: 支持分页
     *
     * 并发支持：使用页面池实现多个搜索并发执行
     */
    async searchDocuments(input: SearchDocumentsInput): Promise<SearchDocumentsOutput> {
        // 验证筛选参数
        this.validateFilters(input);

        // 检查登录状态
        const status = await this.authManager.checkLoginStatus();
        if (!status.已登录) {
            throw new AuthRequiredError('需要登录才能搜索文书，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        // 从页面池获取页面（支持并发）
        const page = await this.authManager.acquirePage();

        try {
            // 创建页面操作器
            const operator = new PageOperator(page);

            // 构建搜索参数
            const searchParams: SearchParams = {
                keyword: input.keyword,
                page: input.page,
                pageSize: input.pageSize,
                filters: this.buildFilters(input),
            };

            // 执行搜索
            const result: SearchResponse = await operator.searchDocuments(searchParams);

            // 需求 1.3: 没有结果时返回空列表并附带描述性消息
            if (result.documents.length === 0) {
                return {
                    total: 0,
                    page: input.page ?? 1,
                    pageSize: input.pageSize ?? 20,
                    documents: [],
                    消息: `未找到与"${input.keyword}"相关的裁判文书`,
                };
            }

            return {
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                documents: result.documents,
            };
        } finally {
            // 无论成功还是失败，都要归还页面到池中
            this.authManager.releasePage(page);
        }
    }

    /**
     * 验证筛选参数
     */
    private validateFilters(input: SearchDocumentsInput): void {
        // 验证案件类型
        if (input.caseType && !isValidCaseType(input.caseType)) {
            throw new InvalidParamsError(`无效的案件类型: ${input.caseType}`, {
                validValues: Object.values(CaseType),
            });
        }

        // 验证法院级别
        if (input.courtLevel && !isValidCourtLevel(input.courtLevel)) {
            throw new InvalidParamsError(`无效的法院级别: ${input.courtLevel}`, {
                validValues: Object.values(CourtLevel),
            });
        }

        // 验证裁判年份
        if (input.judgmentYear) {
            const year = parseInt(input.judgmentYear, 10);
            const currentYear = new Date().getFullYear();
            if (year < 2000 || year > currentYear) {
                throw new InvalidParamsError(`无效的裁判年份: ${input.judgmentYear}，应在2000-${currentYear}之间`, {
                    validRange: `2000-${currentYear}`,
                });
            }
        }
    }

    /**
     * 构建筛选条件
     * 需求 2.4: 组合多个筛选条件时使用AND逻辑
     */
    private buildFilters(input: SearchDocumentsInput): SearchFilters | undefined {
        const hasFilters = input.caseType || input.courtLevel || input.judgmentYear || 
                          input.startDate || input.endDate || input.province || input.courtName;

        if (!hasFilters) {
            return undefined;
        }

        return {
            caseType: input.caseType as CaseType | undefined,
            courtLevel: input.courtLevel as CourtLevel | undefined,
            judgmentYear: input.judgmentYear,
            startDate: input.startDate,
            endDate: input.endDate,
            province: input.province,
            courtName: input.courtName,
        };
    }

    /**
     * 关闭浏览器
     */
    async closeBrowser(): Promise<void> {
        await this.authManager.closeBrowser();
    }
}

/**
 * MCP工具定义 - search_documents
 */
export const searchDocumentsToolDefinition = {
    name: 'search_documents',
    description: `搜索裁判文书。支持关键词搜索和多种筛选条件（案件类型、法院级别、裁判年份/日期范围、法院省份、审理法院）。
    
使用前请确保已登录（调用 login_status 检查状态，未登录则调用 login_qrcode 获取二维码）。

筛选条件使用AND逻辑组合，即返回的文书必须同时满足所有指定的筛选条件。

日期筛选说明：
- judgmentYear: 按整年筛选（如2024），通过结果页左侧树实现
- startDate/endDate: 按精确日期范围筛选（如2024-01-01至2024-06-30），通过高级检索实现
- 如果同时指定了judgmentYear和startDate/endDate，优先使用日期范围

注意：关键词应只包含案由或搜索词（如"劳动合同纠纷"），地区信息应通过province参数传递。`,
    inputSchema: SearchDocumentsInputSchema,
};

/**
 * 所有搜索工具定义
 */
export const searchToolDefinitions = [
    searchDocumentsToolDefinition,
];

/**
 * 创建搜索工具处理器
 */
export function createSearchToolHandlers(authManager?: AuthManager) {
    const tools = new SearchTools(authManager);

    return {
        search_documents: async (args: unknown) => {
            try {
                const input = SearchDocumentsInputSchema.parse(args);
                const result = await tools.searchDocuments(input);
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: JSON.stringify(result, null, 2),
                        },
                    ],
                };
            } catch (error) {
                return createErrorResponse(error);
            }
        },
    };
}

/**
 * 默认搜索工具实例
 */
let defaultSearchTools: SearchTools | null = null;

/**
 * 获取默认搜索工具实例
 */
export function getDefaultSearchTools(): SearchTools {
    if (!defaultSearchTools) {
        defaultSearchTools = new SearchTools();
    }
    return defaultSearchTools;
}

/**
 * 重置默认搜索工具实例
 */
export async function resetDefaultSearchTools(): Promise<void> {
    if (defaultSearchTools) {
        await defaultSearchTools.closeBrowser();
        defaultSearchTools = null;
    }
}
