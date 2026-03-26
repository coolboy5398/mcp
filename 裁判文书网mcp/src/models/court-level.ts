/**
 * 法院级别枚举和映射
 * 需求: 4.1, 4.2, 4.3
 */

/** 法院级别枚举 */
export enum CourtLevel {
    最高 = "zuigao",
    高级 = "gaoji",
    中级 = "zhongji",
    基层 = "jiceng",
}

/** 法院级别信息接口 */
export interface CourtLevelInfo {
    代码: string;
    名称: string;
    描述: string;
}

/** 法院级别映射表 */
export const CourtLevelMap: Record<CourtLevel, CourtLevelInfo> = {
    [CourtLevel.最高]: {
        代码: "zuigao",
        名称: "最高人民法院",
        描述: "最高人民法院",
    },
    [CourtLevel.高级]: {
        代码: "gaoji",
        名称: "高级人民法院",
        描述: "省级高级人民法院",
    },
    [CourtLevel.中级]: {
        代码: "zhongji",
        名称: "中级人民法院",
        描述: "地市级中级人民法院",
    },
    [CourtLevel.基层]: {
        代码: "jiceng",
        名称: "基层人民法院",
        描述: "区县级基层人民法院",
    },
};

/** 获取所有法院级别列表 */
export function getAllCourtLevels(): CourtLevelInfo[] {
    return Object.values(CourtLevelMap);
}

/** 根据代码获取法院级别信息 */
export function getCourtLevelByCode(code: string): CourtLevelInfo | undefined {
    return Object.values(CourtLevelMap).find((info) => info.代码 === code);
}

/** 验证法院级别代码是否有效 */
export function isValidCourtLevel(code: string): boolean {
    return Object.values(CourtLevel).includes(code as CourtLevel);
}
