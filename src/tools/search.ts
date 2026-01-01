/**
 * 搜索MCP工具
 * 实现 search_documents 工具
 * 需求: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3
 */

import { z } from 'zod';
import { Page } from 'playwright';
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
    keyword: z.string().min(1, '搜索关键词不能为空'),
    caseType: z.string().optional(),
    courtLevel: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为YYYY-MM-DD').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为YYYY-MM-DD').optional(),
    page: z.number().int().min(1).optional().default(1),
    pageSize: z.number().int().min(1).max(100).optional().default(20),
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
     */
    async searchDocuments(input: SearchDocumentsInput): Promise<SearchDocumentsOutput> {
        // 验证筛选参数
        this.validateFilters(input);

        // 检查登录状态
        const status = await this.authManager.checkLoginStatus();
        if (!status.已登录) {
            throw new AuthRequiredError('需要登录才能搜索文书，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        // 获取浏览器页面
        const page = await this.authManager.getPage();

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

        // 验证日期范围
        if (input.startDate && input.endDate) {
            const start = new Date(input.startDate);
            const end = new Date(input.endDate);
            if (start > end) {
                throw new InvalidParamsError('开始日期不能晚于结束日期', {
                    startDate: input.startDate,
                    endDate: input.endDate,
                });
            }
        }
    }

    /**
     * 构建筛选条件
     * 需求 2.4: 组合多个筛选条件时使用AND逻辑
     */
    private buildFilters(input: SearchDocumentsInput): SearchFilters | undefined {
        const hasFilters = input.caseType || input.courtLevel || input.startDate || input.endDate;

        if (!hasFilters) {
            return undefined;
        }

        return {
            caseType: input.caseType as CaseType | undefined,
            courtLevel: input.courtLevel as CourtLevel | undefined,
            startDate: input.startDate,
            endDate: input.endDate,
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
    description: `搜索裁判文书。支持关键词搜索和多种筛选条件（案件类型、法院级别、日期范围）。
    
使用前请确保已登录（调用 login_status 检查状态，未登录则调用 login_qrcode 获取二维码）。

筛选条件使用AND逻辑组合，即返回的文书必须同时满足所有指定的筛选条件。`,
    inputSchema: {
        type: 'object' as const,
        properties: {
            keyword: {
                type: 'string',
                description: '搜索关键词，必填',
            },
            caseType: {
                type: 'string',
                description: '案件类型筛选。可选值: xingshi(刑事), minshi(民事), xingzheng(行政), peichang(赔偿), zhixing(执行)',
                enum: ['xingshi', 'minshi', 'xingzheng', 'peichang', 'zhixing'],
            },
            courtLevel: {
                type: 'string',
                description: '法院级别筛选。可选值: zuigao(最高人民法院), gaoji(高级人民法院), zhongji(中级人民法院), jiceng(基层人民法院)',
                enum: ['zuigao', 'gaoji', 'zhongji', 'jiceng'],
            },
            startDate: {
                type: 'string',
                description: '开始日期，格式: YYYY-MM-DD',
                pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            },
            endDate: {
                type: 'string',
                description: '结束日期，格式: YYYY-MM-DD',
                pattern: '^\\d{4}-\\d{2}-\\d{2}$',
            },
            page: {
                type: 'number',
                description: '页码，默认1',
                default: 1,
            },
            pageSize: {
                type: 'number',
                description: '每页数量，默认20，最大100',
                default: 20,
            },
        },
        required: ['keyword'],
    },
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
