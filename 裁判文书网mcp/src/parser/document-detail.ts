/**
 * 文书详情解析器模块
 * 解析裁判文书网文书详情页面，提取文书全文和元数据
 * 需求: 3.2
 */

import { Page, ElementHandle } from 'playwright';
import { DocumentDetail, PartyInfo, isValidDocumentDetail } from '../models/index.js';

/**
 * 文书详情页面选择器
 */
export const DOCUMENT_DETAIL_SELECTORS = {
    // 文书内容容器
    contentContainer: '.content, .ws-content, .document-content, #content, .PDF_box',

    // 基本信息
    title: '.title, h1, .ws-title, .PDF_title',
    caseNo: '.case-no, .ah, .caseNo, span.ah',
    court: '.court, .fy, .courtName, span.fy',
    date: '.date, .cprq, .judgeDate, span.cprq',
    cause: '.cause, .ay, .case-cause, span.ay',
    caseType: '.caseType, .ajlx, span.ajlx',

    // 当事人信息
    partiesContainer: '.parties, .dsr, .party-info, .litigant',
    partyItem: '.party, .dsr-item, li',

    // 审判人员
    judgesContainer: '.judges, .spry, .judge-info, .审判人员',
    judgeItem: '.judge, .spry-item, li',

    // 文书全文
    fullText: '.full-text, .ws-text, .document-body, .PDF_content, #contentText',

    // 其他元数据
    courtLevel: '.court-level, .fyji',
    documentType: '.doc-type, .wslx',
};

/**
 * 当事人角色类型
 */
export const PARTY_ROLES = {
    plaintiff: ['原告', '申请人', '上诉人', '原审原告', '再审申请人', '申请执行人'],
    defendant: ['被告', '被申请人', '被上诉人', '原审被告', '被执行人'],
    thirdParty: ['第三人', '有独立请求权第三人', '无独立请求权第三人'],
    other: ['当事人', '其他'],
};

/**
 * 解析结果接口
 */
export interface ParsedDocumentDetail {
    /** 解析出的文书详情 */
    document: DocumentDetail | null;
    /** 是否解析成功 */
    success: boolean;
    /** 解析错误信息 */
    errors: string[];
    /** 缺失的字段 */
    missingFields: string[];
}

/**
 * 文书详情解析器类
 * 负责从页面中提取文书全文和结构化元数据
 */
export class DocumentDetailParser {
    private readonly page: Page;
    private readonly selectors: typeof DOCUMENT_DETAIL_SELECTORS;

    constructor(page: Page, customSelectors?: Partial<typeof DOCUMENT_DETAIL_SELECTORS>) {
        this.page = page;
        this.selectors = { ...DOCUMENT_DETAIL_SELECTORS, ...customSelectors };
    }

    /**
     * 解析文书详情
     * 需求 3.2: 返回结构化的元数据（当事人、法院、法官、日期等）
     */
    async parseDocument(docId: string): Promise<ParsedDocumentDetail> {
        const errors: string[] = [];
        const missingFields: string[] = [];

        try {
            // 提取各个字段
            const 案件名称 = await this.extractTitle();
            const 案号 = await this.extractCaseNo();
            const 法院名称 = await this.extractCourt();
            const 裁判日期 = await this.extractDate();
            const 案由 = await this.extractCause();
            const 文书全文 = await this.extractFullText();
            const 当事人 = await this.extractParties();
            const 审判人员 = await this.extractJudges();

            // 推断法院级别和案件类型
            const 法院级别 = this.inferCourtLevel(法院名称);
            const 案件类型 = await this.extractCaseType() || this.inferCaseType(案号, 案件名称);

            // 检查必需字段
            if (!案件名称) missingFields.push('案件名称');
            if (!案号) missingFields.push('案号');
            if (!法院名称) missingFields.push('法院名称');
            if (!裁判日期) missingFields.push('裁判日期');

            const document: DocumentDetail = {
                文书ID: docId,
                案件名称: 案件名称 || '未知案件',
                案号: 案号 || '未知案号',
                法院名称: 法院名称 || '未知法院',
                法院级别: 法院级别 || '未知级别',
                裁判日期: this.normalizeDate(裁判日期) || '未知日期',
                案件类型: 案件类型 || '未知类型',
                当事人,
                审判人员,
                文书全文: 文书全文 || '',
                案由: 案由 || '未知案由',
            };

            const success = isValidDocumentDetail(document);

            return {
                document,
                success,
                errors,
                missingFields,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`解析文书详情失败: ${errorMsg}`);

            return {
                document: null,
                success: false,
                errors,
                missingFields,
            };
        }
    }

    /**
     * 提取文书标题/案件名称
     */
    private async extractTitle(): Promise<string> {
        return this.extractTextFromSelectors(this.selectors.title);
    }

    /**
     * 提取案号
     */
    private async extractCaseNo(): Promise<string> {
        const text = await this.extractTextFromSelectors(this.selectors.caseNo);
        return this.cleanCaseNo(text);
    }

    /**
     * 提取法院名称
     */
    private async extractCourt(): Promise<string> {
        return this.extractTextFromSelectors(this.selectors.court);
    }

    /**
     * 提取裁判日期
     */
    private async extractDate(): Promise<string> {
        const text = await this.extractTextFromSelectors(this.selectors.date);
        return this.normalizeDate(text);
    }

    /**
     * 提取案由
     */
    private async extractCause(): Promise<string> {
        return this.extractTextFromSelectors(this.selectors.cause);
    }

    /**
     * 提取案件类型
     */
    private async extractCaseType(): Promise<string> {
        return this.extractTextFromSelectors(this.selectors.caseType);
    }

    /**
     * 提取文书全文
     */
    private async extractFullText(): Promise<string> {
        try {
            const selectors = this.selectors.fullText.split(',').map(s => s.trim());

            for (const selector of selectors) {
                const element = await this.page.$(selector);
                if (element) {
                    // 获取完整的文本内容，保留段落结构
                    const text = await element.evaluate((el) => {
                        // 递归获取所有文本节点
                        const getTextContent = (node: any): string => {
                            if (node.nodeType === 3) { // TEXT_NODE
                                return node.textContent || '';
                            }

                            if (node.nodeType === 1) { // ELEMENT_NODE
                                const tagName = node.tagName.toLowerCase();

                                // 跳过脚本和样式
                                if (tagName === 'script' || tagName === 'style') {
                                    return '';
                                }

                                let text = '';
                                for (const child of node.childNodes) {
                                    text += getTextContent(child);
                                }

                                // 在块级元素后添加换行
                                if (['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
                                    text += '\n';
                                }

                                return text;
                            }

                            return '';
                        };

                        return getTextContent(el);
                    });

                    if (text?.trim()) {
                        return this.cleanFullText(text);
                    }
                }
            }
        } catch {
            // 提取失败
        }
        return '';
    }

    /**
     * 提取当事人信息
     */
    async extractParties(): Promise<PartyInfo[]> {
        const parties: PartyInfo[] = [];

        try {
            // 方法1: 从专门的当事人容器提取
            const container = await this.page.$(this.selectors.partiesContainer);
            if (container) {
                const items = await container.$$(this.selectors.partyItem);
                for (const item of items) {
                    const text = await item.textContent();
                    if (text) {
                        const party = this.parsePartyText(text);
                        if (party) {
                            parties.push(party);
                        }
                    }
                }
            }

            // 方法2: 从文书全文中提取当事人
            if (parties.length === 0) {
                const fullText = await this.extractFullText();
                const extractedParties = this.extractPartiesFromText(fullText);
                parties.push(...extractedParties);
            }
        } catch {
            // 提取失败
        }

        return parties;
    }

    /**
     * 从文本中解析当事人信息
     */
    private parsePartyText(text: string): PartyInfo | null {
        const cleanedText = text.trim();
        if (!cleanedText) return null;

        // 模式1: "角色：姓名" 或 "角色:姓名"
        const colonPattern = /^(原告|被告|上诉人|被上诉人|申请人|被申请人|第三人|原审原告|原审被告|再审申请人|被执行人|申请执行人)[：:]\s*(.+)$/;
        let match = cleanedText.match(colonPattern);
        if (match) {
            return {
                角色: match[1] || '当事人',
                姓名: this.cleanPartyName(match[2] || ''),
            };
        }

        // 模式2: "姓名（角色）" 或 "姓名(角色)"
        const parenPattern = /^(.+?)[（(](原告|被告|上诉人|被上诉人|申请人|被申请人|第三人)[）)]$/;
        match = cleanedText.match(parenPattern);
        if (match) {
            return {
                角色: match[2] || '当事人',
                姓名: this.cleanPartyName(match[1] || ''),
            };
        }

        // 模式3: 包含角色关键词
        for (const [, roles] of Object.entries(PARTY_ROLES)) {
            for (const role of roles) {
                if (cleanedText.includes(role)) {
                    const name = cleanedText.replace(role, '').replace(/[：:]/g, '').trim();
                    if (name) {
                        return {
                            角色: role,
                            姓名: this.cleanPartyName(name),
                        };
                    }
                }
            }
        }

        // 如果无法识别角色，返回未知角色
        if (cleanedText.length > 0 && cleanedText.length < 50) {
            return {
                角色: '当事人',
                姓名: this.cleanPartyName(cleanedText),
            };
        }

        return null;
    }

    /**
     * 从文书全文中提取当事人
     */
    private extractPartiesFromText(fullText: string): PartyInfo[] {
        const parties: PartyInfo[] = [];
        const seen = new Set<string>();

        // 匹配模式
        const patterns = [
            // 原告XXX，被告XXX
            /(原告|被告|上诉人|被上诉人|申请人|被申请人|第三人)[：:、]?\s*([^，。,\n]+)/g,
            // XXX（原告）
            /([^，。,\n（(]+)[（(](原告|被告|上诉人|被上诉人|申请人|被申请人|第三人)[）)]/g,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(fullText)) !== null) {
                const role = match[1]?.includes('原告') || match[1]?.includes('申请') || match[1]?.includes('上诉人')
                    ? match[1]
                    : (match[2] || match[1]);
                const name = match[2] || match[1];

                if (name && !seen.has(name)) {
                    seen.add(name);
                    parties.push({
                        角色: role || '当事人',
                        姓名: this.cleanPartyName(name),
                    });
                }
            }
        }

        return parties;
    }

    /**
     * 清理当事人姓名
     */
    private cleanPartyName(name: string): string {
        return name
            .trim()
            .replace(/^[：:、\s]+/, '')
            .replace(/[：:、\s]+$/, '')
            .replace(/\s+/g, '')
            .substring(0, 100);  // 限制长度
    }

    /**
     * 提取审判人员
     */
    async extractJudges(): Promise<string[]> {
        const judges: string[] = [];

        try {
            // 方法1: 从专门的审判人员容器提取
            const container = await this.page.$(this.selectors.judgesContainer);
            if (container) {
                const items = await container.$$(this.selectors.judgeItem);
                for (const item of items) {
                    const text = await item.textContent();
                    if (text) {
                        const names = this.parseJudgeText(text);
                        judges.push(...names);
                    }
                }
            }

            // 方法2: 从文书全文中提取
            if (judges.length === 0) {
                const fullText = await this.extractFullText();
                const extractedJudges = this.extractJudgesFromText(fullText);
                judges.push(...extractedJudges);
            }
        } catch {
            // 提取失败
        }

        // 去重
        return [...new Set(judges)];
    }

    /**
     * 解析审判人员文本
     */
    private parseJudgeText(text: string): string[] {
        const cleanedText = text.trim();
        if (!cleanedText) return [];

        // 移除职务前缀
        const withoutTitle = cleanedText
            .replace(/审判长|审判员|人民陪审员|代理审判员|书记员/g, '')
            .trim();

        // 按分隔符分割
        const names = withoutTitle
            .split(/[,，、\s]+/)
            .map(n => n.trim())
            .filter(n => n.length > 0 && n.length < 20);

        return names;
    }

    /**
     * 从文书全文中提取审判人员
     */
    private extractJudgesFromText(fullText: string): string[] {
        const judges: string[] = [];

        // 匹配模式
        const patterns = [
            // 审判长XXX
            /审判长[：:、\s]*([^\n，。,]+)/g,
            // 审判员XXX
            /审判员[：:、\s]*([^\n，。,]+)/g,
            // 人民陪审员XXX
            /人民陪审员[：:、\s]*([^\n，。,]+)/g,
            // 代理审判员XXX
            /代理审判员[：:、\s]*([^\n，。,]+)/g,
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(fullText)) !== null) {
                if (match[1]) {
                    const names = match[1]
                        .split(/[,，、\s]+/)
                        .map(n => n.trim())
                        .filter(n => n.length > 0 && n.length < 20);
                    judges.push(...names);
                }
            }
        }

        return [...new Set(judges)];
    }

    /**
     * 从多个选择器中提取文本
     */
    private async extractTextFromSelectors(selectorString: string): Promise<string> {
        try {
            const selectors = selectorString.split(',').map(s => s.trim());

            for (const selector of selectors) {
                const element = await this.page.$(selector);
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
     * 清理文本
     */
    private cleanText(text: string): string {
        return text
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[\r\n]+/g, ' ')
            .trim();
    }

    /**
     * 清理案号
     */
    private cleanCaseNo(caseNo: string): string {
        if (!caseNo) return '';

        // 移除常见的前缀
        return caseNo
            .replace(/^案号[：:]\s*/, '')
            .replace(/^[：:]\s*/, '')
            .trim();
    }

    /**
     * 清理文书全文
     */
    private cleanFullText(text: string): string {
        return text
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')  // 最多保留两个换行
            .replace(/[ \t]+/g, ' ')  // 合并空格
            .trim();
    }

    /**
     * 标准化日期格式
     */
    private normalizeDate(dateStr: string): string {
        if (!dateStr) return '';

        const patterns = [
            /(\d{4})-(\d{1,2})-(\d{1,2})/,
            /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
            /(\d{4})年(\d{1,2})月(\d{1,2})日/,
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

        return dateStr;
    }

    /**
     * 根据法院名称推断法院级别
     */
    private inferCourtLevel(courtName: string): string {
        if (!courtName) return '未知级别';

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
     * 检查页面是否包含文书内容
     */
    async hasContent(): Promise<boolean> {
        try {
            const selectors = this.selectors.contentContainer.split(',').map(s => s.trim());

            for (const selector of selectors) {
                const element = await this.page.$(selector);
                if (element) {
                    const text = await element.textContent();
                    if (text && text.trim().length > 100) {
                        return true;
                    }
                }
            }
        } catch {
            // 检查失败
        }
        return false;
    }
}

/**
 * 创建文书详情解析器实例
 */
export function createDocumentDetailParser(
    page: Page,
    customSelectors?: Partial<typeof DOCUMENT_DETAIL_SELECTORS>
): DocumentDetailParser {
    return new DocumentDetailParser(page, customSelectors);
}

/**
 * 从HTML字符串解析文书详情（用于测试）
 */
export function parseDocumentDetailFromHtml(html: string, docId: string): DocumentDetail {
    // 简单的正则解析，用于单元测试
    const extractField = (pattern: RegExp): string => {
        const match = html.match(pattern);
        return match?.[1]?.trim() || '';
    };

    const 案件名称 = extractField(/class="(?:title|ws-title)"[^>]*>([^<]+)</);
    const 案号 = extractField(/class="(?:caseNo|ah)"[^>]*>([^<]+)</);
    const 法院名称 = extractField(/class="(?:court|fy)"[^>]*>([^<]+)</);
    const 裁判日期 = extractField(/class="(?:date|cprq)"[^>]*>([^<]+)</);
    const 案由 = extractField(/class="(?:cause|ay)"[^>]*>([^<]+)</);
    const 文书全文 = extractField(/class="(?:full-text|ws-text)"[^>]*>([\s\S]*?)<\/div>/);

    // 推断法院级别
    let 法院级别 = '未知级别';
    if (法院名称.includes('最高')) 法院级别 = '最高人民法院';
    else if (法院名称.includes('高级')) 法院级别 = '高级人民法院';
    else if (法院名称.includes('中级')) 法院级别 = '中级人民法院';
    else if (法院名称.includes('人民法院')) 法院级别 = '基层人民法院';

    // 推断案件类型
    let 案件类型 = '未知类型';
    const combined = `${案号} ${案件名称}`;
    if (combined.includes('刑')) 案件类型 = '刑事案件';
    else if (combined.includes('民')) 案件类型 = '民事案件';
    else if (combined.includes('行')) 案件类型 = '行政案件';
    else if (combined.includes('赔')) 案件类型 = '赔偿案件';
    else if (combined.includes('执')) 案件类型 = '执行案件';

    return {
        文书ID: docId,
        案件名称: 案件名称 || '未知案件',
        案号: 案号 || '未知案号',
        法院名称: 法院名称 || '未知法院',
        法院级别,
        裁判日期: 裁判日期 || '未知日期',
        案件类型,
        当事人: [],
        审判人员: [],
        文书全文: 文书全文 || '',
        案由: 案由 || '未知案由',
    };
}
