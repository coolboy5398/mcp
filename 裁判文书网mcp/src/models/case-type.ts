/**
 * 案件类型枚举和映射
 * 需求: 4.1, 4.2, 4.3
 */

/** 案件类型枚举 */
export enum CaseType {
    刑事 = "xingshi",
    民事 = "minshi",
    行政 = "xingzheng",
    赔偿 = "peichang",
    执行 = "zhixing",
}

/** 案件类型信息接口 */
export interface CaseTypeInfo {
    代码: string;
    名称: string;
    描述: string;
}

/** 案件类型映射表 */
export const CaseTypeMap: Record<CaseType, CaseTypeInfo> = {
    [CaseType.刑事]: {
        代码: "xingshi",
        名称: "刑事案件",
        描述: "刑事诉讼案件",
    },
    [CaseType.民事]: {
        代码: "minshi",
        名称: "民事案件",
        描述: "民事诉讼案件",
    },
    [CaseType.行政]: {
        代码: "xingzheng",
        名称: "行政案件",
        描述: "行政诉讼案件",
    },
    [CaseType.赔偿]: {
        代码: "peichang",
        名称: "赔偿案件",
        描述: "国家赔偿案件",
    },
    [CaseType.执行]: {
        代码: "zhixing",
        名称: "执行案件",
        描述: "执行程序案件",
    },
};

/** 获取所有案件类型列表 */
export function getAllCaseTypes(): CaseTypeInfo[] {
    return Object.values(CaseTypeMap);
}

/** 根据代码获取案件类型信息 */
export function getCaseTypeByCode(code: string): CaseTypeInfo | undefined {
    return Object.values(CaseTypeMap).find((info) => info.代码 === code);
}

/** 验证案件类型代码是否有效 */
export function isValidCaseType(code: string): boolean {
    return Object.values(CaseType).includes(code as CaseType);
}
