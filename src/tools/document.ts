/**
 * 文书详情MCP工具
 * 实现 get_document 工具
 * 需求: 3.1, 3.2, 3.3
 */

import { z } from 'zod';
import {
    DocumentDetail,
    PartyInfo,
} from '../models/index.js';
import {
    PageOperator,
} from '../browser/index.js';
import {
    AuthManager,
    getDefaultAuthManager,
} from '../auth/index.js';
import {
    createErrorResponse,
    InvalidParamsError,
    NotFoundError,
    AuthRequiredError,
} from '../errors/index.js';

/**
 * 获取文书详情输入Schema
 */
export const GetDocumentInputSchema = z.object({
    docId: z.string().min(1, '文书ID不能为空'),
});

export type GetDocumentInput = z.infer<typeof GetDocumentInputSchema>;

/**
 * 文书详情输出接口
 * 需求 3.2: 返回结构化的元数据
 */
export interface GetDocumentOutput {
    文书ID: string;
    案件名称: string;
    案号: string;
    法院名称: string;
    法院级别: string;
    裁判日期: string;
    案件类型: string;
    当事人: PartyInfo[];
    审判人员: string[];
    文书全文: string;
    案由: string;
}

/**
 * 文书详情工具类
 * 封装文书详情获取相关的MCP工具实现
 */
export class DocumentTools {
    private authManager: AuthManager;

    constructor(authManager?: AuthManager) {
        this.authManager = authManager ?? getDefaultAuthManager();
    }

    /**
     * 获取文书详情
     * 需求 3.1: 根据文书ID获取完整内容
     * 需求 3.2: 返回结构化的元数据
     * 需求 3.3: 无效ID返回错误消息
     *
     * 并发支持：使用页面池实现多个请求并发执行
     */
    async getDocument(input: GetDocumentInput): Promise<GetDocumentOutput> {
        // 验证输入
        if (!input.docId || input.docId.trim() === '') {
            throw new InvalidParamsError('文书ID不能为空');
        }

        // 检查登录状态
        const status = await this.authManager.checkLoginStatus();
        if (!status.已登录) {
            throw new AuthRequiredError('需要登录才能获取文书详情，请先调用 login_qrcode 获取二维码并扫码登录');
        }

        // 从页面池获取页面（支持并发）
        const page = await this.authManager.acquirePage();

        try {
            // 创建页面操作器
            const operator = new PageOperator(page);

            // 获取文书详情
            const detail: DocumentDetail = await operator.getDocumentDetail(input.docId);

            return {
                文书ID: detail.文书ID,
                案件名称: detail.案件名称,
                案号: detail.案号,
                法院名称: detail.法院名称,
                法院级别: detail.法院级别,
                裁判日期: detail.裁判日期,
                案件类型: detail.案件类型,
                当事人: detail.当事人,
                审判人员: detail.审判人员,
                文书全文: detail.文书全文,
                案由: detail.案由,
            };
        } catch (error) {
            // 需求 3.3: 无效ID返回适当的错误消息
            if (error instanceof NotFoundError) {
                throw new NotFoundError(`未找到文书: ${input.docId}，请检查文书ID是否正确`);
            }
            throw error;
        } finally {
            // 无论成功还是失败，都要归还页面到池中
            this.authManager.releasePage(page);
        }
    }

    /**
     * 关闭浏览器
     */
    async closeBrowser(): Promise<void> {
        await this.authManager.closeBrowser();
    }
}

/**
 * MCP工具定义 - get_document
 */
export const getDocumentToolDefinition = {
    name: 'get_document',
    description: `获取裁判文书的完整内容和详细信息。

使用前请确保已登录（调用 login_status 检查状态，未登录则调用 login_qrcode 获取二维码）。

返回的信息包括：
- 基本信息：文书ID、案件名称、案号、法院名称、法院级别、裁判日期、案件类型
- 当事人信息：姓名和角色（原告/被告/上诉人等）
- 审判人员：法官列表
- 文书全文：完整的判决书内容
- 案由：案件的法律案由`,
    inputSchema: {
        type: 'object' as const,
        properties: {
            docId: {
                type: 'string',
                description: '文书ID或案号，必填。可以从搜索结果中获取文书ID。',
            },
        },
        required: ['docId'],
    },
};

/**
 * 所有文书详情工具定义
 */
export const documentToolDefinitions = [
    getDocumentToolDefinition,
];

/**
 * 创建文书详情工具处理器
 */
export function createDocumentToolHandlers(authManager?: AuthManager) {
    const tools = new DocumentTools(authManager);

    return {
        get_document: async (args: unknown) => {
            try {
                const input = GetDocumentInputSchema.parse(args);
                const result = await tools.getDocument(input);
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
 * 默认文书详情工具实例
 */
let defaultDocumentTools: DocumentTools | null = null;

/**
 * 获取默认文书详情工具实例
 */
export function getDefaultDocumentTools(): DocumentTools {
    if (!defaultDocumentTools) {
        defaultDocumentTools = new DocumentTools();
    }
    return defaultDocumentTools;
}

/**
 * 重置默认文书详情工具实例
 */
export async function resetDefaultDocumentTools(): Promise<void> {
    if (defaultDocumentTools) {
        await defaultDocumentTools.closeBrowser();
        defaultDocumentTools = null;
    }
}
