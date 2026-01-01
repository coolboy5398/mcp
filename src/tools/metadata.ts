/**
 * 元数据MCP工具
 * 实现 list_case_types, list_court_levels 工具
 * 需求: 4.1, 4.2, 4.3
 */

import {
    CaseTypeInfo,
    CourtLevelInfo,
    getAllCaseTypes,
    getAllCourtLevels,
} from '../models/index.js';
import { createErrorResponse } from '../errors/index.js';

/**
 * 案件类型列表输出接口
 */
export interface ListCaseTypesOutput {
    案件类型列表: CaseTypeInfo[];
    总数: number;
}

/**
 * 法院级别列表输出接口
 */
export interface ListCourtLevelsOutput {
    法院级别列表: CourtLevelInfo[];
    总数: number;
}

/**
 * 元数据工具类
 * 封装所有元数据相关的MCP工具实现
 */
export class MetadataTools {
    /**
     * 列出所有案件类型
     * 需求 4.1: 文书服务器应提供列出所有可用案件类型的工具
     * 需求 4.3: 当列出选项时，文书服务器应同时包含中文名称和代码
     */
    listCaseTypes(): ListCaseTypesOutput {
        const caseTypes = getAllCaseTypes();
        return {
            案件类型列表: caseTypes,
            总数: caseTypes.length,
        };
    }

    /**
     * 列出所有法院级别
     * 需求 4.2: 文书服务器应提供列出所有可用法院级别的工具
     * 需求 4.3: 当列出选项时，文书服务器应同时包含中文名称和代码
     */
    listCourtLevels(): ListCourtLevelsOutput {
        const courtLevels = getAllCourtLevels();
        return {
            法院级别列表: courtLevels,
            总数: courtLevels.length,
        };
    }
}

/**
 * MCP工具定义 - list_case_types
 */
export const listCaseTypesToolDefinition = {
    name: 'list_case_types',
    description: '列出所有可用的案件类型。返回案件类型的代码、中文名称和描述。',
    inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] as string[],
    },
};

/**
 * MCP工具定义 - list_court_levels
 */
export const listCourtLevelsToolDefinition = {
    name: 'list_court_levels',
    description: '列出所有可用的法院级别。返回法院级别的代码、中文名称和描述。',
    inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [] as string[],
    },
};

/**
 * 所有元数据工具定义
 */
export const metadataToolDefinitions = [
    listCaseTypesToolDefinition,
    listCourtLevelsToolDefinition,
];

/**
 * 创建元数据工具处理器
 */
export function createMetadataToolHandlers() {
    const tools = new MetadataTools();

    return {
        list_case_types: async () => {
            try {
                const result = tools.listCaseTypes();
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

        list_court_levels: async () => {
            try {
                const result = tools.listCourtLevels();
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
 * 默认元数据工具实例（单例）
 */
let defaultMetadataTools: MetadataTools | null = null;

/**
 * 获取默认元数据工具实例
 */
export function getDefaultMetadataTools(): MetadataTools {
    if (!defaultMetadataTools) {
        defaultMetadataTools = new MetadataTools();
    }
    return defaultMetadataTools;
}
